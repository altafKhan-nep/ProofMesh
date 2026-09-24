import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthSession, SseEvent } from '@proofmesh/shared-types';
import { SKILLS, LEVEL_INFO } from '@proofmesh/shared-types';
import { validateAttestationRecord, deriveCredentialPda } from '@proofmesh/verifier-sdk';
import type { Store } from './store.js';
import { runAnalysis } from './pipeline.js';
import { hydrateSeededRuns } from './hydrate.js';
import {
  bearerTokenFromHeader,
  isValidPubkey,
  newChallenge,
  newSession,
  validateVerifyAgainstChallenge,
  verifySiwsSignature
} from './auth.js';

export interface RouteContext {
  store: Store;
  adminWallets: Set<string>;
}

type RequestWithAuth = FastifyRequest & { auth?: AuthSession };

/** Fastify preHandler: require a signed-in session (token from Authorization header). */
function requireAuth(store: Store) {
  return (req: RequestWithAuth, reply: FastifyReply, done: () => void): void => {
    const token = bearerTokenFromHeader(req.headers.authorization);
    const session = token ? store.sessionFor(token) : undefined;
    if (!session) {
      reply.code(401).send({ error: 'auth_required', message: 'Sign in with your Solana wallet first.' });
      return done();
    }
    req.auth = session;
    done();
  };
}

/** Fastify preHandler: require an admin wallet (must also pass requireAuth semantics). */
function requireAdmin(store: Store, adminWallets: Set<string>) {
  return (req: RequestWithAuth, reply: FastifyReply, done: () => void): void => {
    const token = bearerTokenFromHeader(req.headers.authorization);
    const session = token ? store.sessionFor(token) : undefined;
    if (!session) {
      reply.code(401).send({ error: 'auth_required', message: 'Sign in with your Solana wallet first.' });
      return done();
    }
    if (!adminWallets.has(session.wallet)) {
      reply.code(403).send({ error: 'admin_required', message: 'This action is limited to admin wallets (ADMIN_WALLETS).' });
      return done();
    }
    req.auth = session;
    done();
  };
}

export async function registerRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const store = ctx.store;
  const adminWallets = ctx.adminWallets;
  app.decorateRequest('auth', null as AuthSession | null);

  // ------------------------------------------------------------------ health
  app.get('/health', async () => ({
    status: 'ok',
    sourceOfTruth: 'docs/stitch_proofmesh_design_system_components',
    store: { developers: store.listDevelopers().length, jobs: store.jobs.size },
    deterministicOnly: !process.env.ANTHROPIC_API_KEY
  }));

  // ------------------------------------------------------------------ auth
  const auth = { preHandler: requireAuth(store) };
  const admin = { preHandler: requireAdmin(store, adminWallets) };

  app.post('/api/auth/challenge', async (req, reply) => {
    const body = (req.body ?? {}) as { wallet?: string; purpose?: string; subject?: string };
    const wallet = (body.wallet ?? '').trim();
    if (!isValidPubkey(wallet)) {
      return reply.code(400).send({ error: 'invalid_wallet', message: 'Provide a valid base58 Solana public key.' });
    }
    const purpose = body.purpose === 'bind' ? 'bind' : 'signin';
    const subject = (body.subject ?? '').trim();
    if (purpose === 'bind' && !/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(subject)) {
      return reply.code(400).send({ error: 'invalid_subject', message: 'A valid GitHub handle is required to bind.' });
    }
    const challenge = newChallenge(wallet, purpose === 'bind' ? { purpose, subject } : {});
    const issued = store.issueChallenge(challenge);
    if (!issued.ok) {
      return reply.code(429).send({ error: issued.reason, message: 'Too many open challenges for this wallet.' });
    }
    return challenge;
  });

  app.post('/api/auth/verify', async (req, reply) => {
    const body = (req.body ?? {}) as { wallet?: string; message?: string; signature?: string };
    const wallet = (body.wallet ?? '').trim();
    const { message, signature } = body as { message: string; signature: string };
    if (!wallet || !message || !signature) {
      return reply.code(400).send({ error: 'missing_verify_fields' });
    }
    const nonce = /^Nonce:\s*(.+)$/m.exec(message)?.[1];
    if (!nonce) return reply.code(400).send({ error: 'malformed_message' });

    // Single-use: consume the challenge now, before signature work.
    const challenge = store.consumeChallenge(nonce);
    if (!challenge) return reply.code(401).send({ error: 'challenge_not_found', message: 'Nonce unknown or already used.' });

    const invalid = validateVerifyAgainstChallenge({ wallet, message, signature }, challenge);
    if (invalid) return reply.code(401).send({ error: invalid });

    if (!verifySiwsSignature(message, signature, wallet)) {
      return reply.code(401).send({ error: 'invalid_signature' });
    }

    const role = adminWallets.has(wallet) ? 'admin' : 'user';
    const session = newSession(wallet, role);
    store.createSession(session);
    return { token: session.token, wallet, role, expiresAt: session.expiresAt };
  });

  app.get('/api/auth/me', auth, async (req) => {
    const session = (req as RequestWithAuth).auth!;
    return { wallet: session.wallet, role: session.role, expiresAt: session.expiresAt };
  });

  app.post('/api/auth/logout', auth, async (req, reply) => {
    const token = bearerTokenFromHeader((req as RequestWithAuth).headers.authorization);
    if (token) store.revokeSession(token);
    return { ok: true };
  });

  // --------------------------------------------------------------- developers
  app.get('/api/developers', async () => store.listDevelopers());
  app.get('/api/developers/:handle', async (req, reply) => {
    const { handle } = req.params as { handle: string };
    const dev = store.findDeveloper(handle);
    if (!dev) return reply.code(404).send({ error: 'developer_not_found' });
    return dev;
  });

  // ----------------------------------------------------------------- listings
  app.get('/api/listings', async () => store.listings);
  app.delete('/api/listings/:id', admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const idx = store.listings.findIndex((l) => l.id === id);
    if (idx === -1) return reply.code(404).send({ error: 'listing_not_found' });
    const [removed] = store.listings.splice(idx, 1);
    return { removed: !!removed };
  });

  // ---------------------------------------------------------------- bind wallet
  app.post('/api/bind', auth, async (req, reply) => {
    const body = (req.body ?? {}) as {
      githubUsername?: string;
      githubHandle?: string;
      wallet?: string;
      message?: string;
      signature?: string;
    };
    const handle = body.githubUsername ?? body.githubHandle ?? '';
    const wallet = (body.wallet ?? '').trim();
    if (!handle) return reply.code(400).send({ error: 'developer_required' });
    if (!wallet) return reply.code(400).send({ error: 'wallet_required' });

    // A binding is a claim that THIS wallet controls THIS GitHub account, so it
    // must be proven by the session wallet. Accepting a bare handle+wallet pair
    // would let any signed-in wallet claim someone else's identity.
    const session = (req as RequestWithAuth).auth!;
    if (session.wallet !== wallet) {
      return reply.code(403).send({
        error: 'wallet_mismatch',
        message: 'A binding must be signed by the wallet that owns it — sign in with the wallet you are binding.'
      });
    }
    const { message, signature } = body;
    if (!message || !signature) {
      return reply.code(400).send({
        error: 'proof_required',
        message: 'Sign a bind challenge (purpose=bind) with this wallet to prove the binding.'
      });
    }
    const nonce = /^Nonce:\s*(.+)$/m.exec(message)?.[1];
    if (!nonce) return reply.code(400).send({ error: 'malformed_message' });
    const bindChallenge = store.consumeChallenge(nonce);
    if (!bindChallenge) {
      return reply.code(401).send({ error: 'challenge_not_found', message: 'Bind challenge unknown or already used.' });
    }
    // Audience binding: a sign-in challenge must never authorise a bind, and the
    // challenge must name this exact GitHub account.
    if (bindChallenge.purpose !== 'bind' || bindChallenge.subject?.toLowerCase() !== handle.toLowerCase()) {
      return reply.code(401).send({ error: 'challenge_audience_mismatch' });
    }
    if (bindChallenge.wallet !== wallet) {
      return reply.code(401).send({ error: 'challenge_wallet_mismatch' });
    }
    if (new Date(bindChallenge.expirationTime).getTime() < Date.now()) {
      return reply.code(401).send({ error: 'challenge_expired' });
    }
    if (!verifySiwsSignature(bindChallenge.message, signature, wallet)) {
      return reply.code(401).send({ error: 'invalid_signature' });
    }

    let dev = store.findDeveloper(handle);
    if (!dev) {
      try {
        const { ingestGitHub } = await import('./github.js');
        const ingested = await ingestGitHub(store, handle, { maxDetailRepos: 1 });
        if (!store.developers.has(ingested.developer.id)) {
          store.developers.set(ingested.developer.id, ingested.developer);
          store.repos.set(ingested.developer.id, ingested.repos);
          store.evidence.set(ingested.developer.id, ingested.evidence);
        }
        dev = store.findDeveloper(handle);
      } catch (err) {
        if (err instanceof Error && err.message === 'github_user_not_found') {
          return reply.code(404).send({ error: 'developer_not_found', githubHandle: handle });
        }
        if (err instanceof Error && err.name === 'GitHubRateLimitedError') {
          return reply.code(429).send({ error: 'github_rate_limited', message: err.message });
        }
        return reply.code(502).send({
          error: 'github_ingest_failed',
          message: err instanceof Error ? err.message : String(err)
        });
      }
    }
    if (!dev) return reply.code(404).send({ error: 'developer_not_found', githubHandle: handle });

    const binding = store.bindWallet(dev.id, wallet, {
      signedMessage: bindChallenge.message,
      nonce: bindChallenge.nonce,
      domain: bindChallenge.domain
    });
    return { developer: dev, binding };
  });

  // ------------------------------------------------------------------- analyze
  app.post('/api/analyze', auth, async (req, reply) => {
    const body = (req.body ?? {}) as {
      githubHandle?: string;
      githubUsername?: string;
      skillId?: string;
      llmEnabled?: boolean;
      wallet?: string;
    };
    const skillId = (body.skillId ?? 'solana-anchor') as keyof typeof SKILLS;
    if (!SKILLS[skillId]) return reply.code(400).send({ error: 'unknown_skill' });

    const handle = body.githubHandle ?? body.githubUsername ?? '';
    if (!handle) return reply.code(400).send({ error: 'developer_required' });

    // A caller may only direct a credential at a wallet they control: either the
    // session wallet, or a wallet already bound to this developer with a verified
    // proof. Otherwise anyone could mint a credential into someone else's wallet.
    const session = (req as RequestWithAuth).auth!;
    const requestedWallet = (body.wallet ?? '').trim();
    if (requestedWallet) {
      const target = store.findDeveloper(handle);
      const bound = target?.linkedWallets.find((b) => b.wallet === requestedWallet);
      const allowed = requestedWallet === session.wallet || (bound?.verified?.wallet === true && bound.verified.github === 'proven');
      if (!allowed) {
        return reply.code(403).send({
          error: 'mint_target_not_proven',
          message:
            'Mint target must be the signed-in wallet or a fully verified binding for this developer.'
        });
      }
    }

    let dev = store.findDeveloper(handle) ?? store.findDeveloperByWallet(handle);

    // Not a seeded developer? Try live GitHub ingestion (tautology-free: only
    // signals the public API can attest become evidence).
    if (!dev && body.skillId && (skillId in SKILLS)) {
      try {
        const { ingestGitHub } = await import('./github.js');
        const ingested = await ingestGitHub(store, handle, { maxDetailRepos: 4 });
        if (!store.developers.has(ingested.developer.id)) {
          store.developers.set(ingested.developer.id, ingested.developer);
          store.repos.set(ingested.developer.id, ingested.repos);
          store.evidence.set(ingested.developer.id, ingested.evidence);
        }
        dev = store.findDeveloper(handle);
      } catch (err) {
        if (err instanceof Error && err.message === 'github_user_not_found') {
          return reply.code(404).send({ error: 'developer_not_found', githubHandle: handle });
        }
        if (err instanceof Error && err.name === 'GitHubRateLimitedError') {
          return reply.code(429).send({ error: 'github_rate_limited', message: err.message });
        }
        return reply.code(502).send({
          error: 'github_ingest_failed',
          message: err instanceof Error ? err.message : String(err)
        });
      }
    }

    if (!dev) return reply.code(404).send({ error: 'developer_not_found', githubHandle: handle });

    // NOTE: analyze never creates a binding. Binding a wallet to a GitHub account
    // is an explicit, signature-proven operation (POST /api/bind); implicitly
    // binding here would let any signed-in caller claim someone else's identity.
    // An unverified wallet simply receives a score, never a minted credential.

    const job = store.createJob({
      developerId: dev.id,
      githubUsername: dev.githubHandle,
      skillId,
      llmEnabled: !!body.llmEnabled && !!process.env.ANTHROPIC_API_KEY,
      mintWallet: requestedWallet || null
    });

    const emit = (e: SseEvent) => emitFact(job.id, e);
    void runAnalysis(store, job, emit).catch((err: unknown) => {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : String(err);
      emitFact(job.id, { type: 'error', message: job.error });
    });

    return { job };
  });

  app.get('/api/analyze/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = store.jobs.get(id);
    if (!job) return reply.code(404).send({ error: 'job_not_found' });
    const score = job.scoreId ? store.scores.get(job.scoreId) : undefined;
    return { job, score };
  });

  // ---------------------------------------------------------------------- SSE
  app.get('/api/analyze/:id/stream', async (req, reply) => {
    const { id } = req.params as { id: string };
    const job = store.jobs.get(id);
    if (!job) return reply.code(404).send({ error: 'job_not_found' });

    reply.hijack();
    const raw = reply.raw;
    const origin = req.headers.origin ?? '*';
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin'
    });
    raw.write(`data: ${JSON.stringify({ type: 'hello', jobId: job.id })}\n\n`);

    // Replay any facts already recorded, then live-follow.
    for (const e of drain(job.id)) raw.write(`data: ${JSON.stringify(e)}\n\n`);
    const sub = (e: SseEvent) => {
      try {
        raw.write(`data: ${JSON.stringify(e)}\n\n`);
      } catch {
        /* client gone */
      }
    };
    subscribe(job.id, sub);
    raw.on('close', () => {
      unsubscribe(job.id, sub);
      raw.end();
    });
  });

  // ----------------------------------------------------------------- evidence
  app.get('/api/evidence/:handle', async (req, reply) => {
    const { handle } = req.params as { handle: string };
    const dev = store.findDeveloper(handle);
    if (!dev) return reply.code(404).send({ error: 'developer_not_found' });
    const score = store.scoreFor(dev.id, 'solana-anchor') ?? store.scoreFor(dev.id, 'typescript');
    const credential = score ? store.credentialFor(dev.id, score.skillId) : undefined;
    return {
      developer: dev,
      repos: store.reposFor(dev.id),
      evidence: store.evidenceFor(dev.id),
      score,
      credential
    };
  });

  // ------------------------------------------------------------- public verify
  app.get('/api/verify/:wallet/:skill', async (req, reply) => {
    const { wallet, skill } = req.params as { wallet: string; skill: string };
    const skillId = skill as keyof typeof SKILLS;
    if (!SKILLS[skillId]) return reply.code(404).send({ error: 'unknown_skill' });
    const dev = store.findDeveloperByWallet(wallet);
    const score = dev && store.scoreFor(dev.id, skillId);
    const credential = dev && store.credentialFor(dev.id, skillId);
    if (!dev || !score || !credential || credential.wallet !== wallet) {
      return reply.code(404).send({ valid: false, reason: 'credential_not_found', wallet, skillId });
    }

    // Authoritative on-chain PDA (deterministic from wallet + skill) — the
    // stored attestationAddress may predate an SDK derivation fix.
    const pda = await deriveCredentialPda(wallet, skillId);

    // Constraint-check through the shared SDK logic (RPC-grade, Off-chain mirror).
    const grade = validateAttestationRecord(
      {
        wallet,
        skillId: credential.skillId,
        skillScore: credential.skillScore,
        confidencePercent: credential.confidencePercent,
        level: credential.level,
        issuerAddress: credential.issuerAddress,
        expiresAt: credential.expiresAt,
        status: credential.status
      },
      { minScore: 0, minConfidence: 0 }
    );

    return grade.valid
      ? {
          valid: true,
          wallet,
          skillId: credential.skillId,
          skillLabel: SKILLS[skillId].label,
          score: credential.skillScore,
          confidence: credential.confidencePercent,
          level: credential.level,
          levelLabel: LEVEL_INFO[credential.level].label,
          issuerAddress: credential.issuerAddress,
          schema: credential.schema,
          analyzerVersion: credential.analyzerVersion,
          attestationAddress: pda.address,
          evidenceRoot: credential.evidenceRoot,
          reportUri: credential.reportUri,
          dev: { handle: dev.githubHandle, githubUsername: dev.githubUsername, avatarUrl: dev.avatarUrl },
          evidence: store.evidenceFor(dev.id),
          repos: store.reposFor(dev.id),
          issuedAt: credential.issuedAt,
          expiresAt: credential.expiresAt,
          status: credential.status
        }
      : reply.code(404).send({ valid: false, reasons: grade.reasons, wallet, skillId });
  });

  // --------------------------------------------------------------------- badge
  app.get('/api/badge/:wallet/:skill.svg', async (req, reply) => {
    const { wallet, skill } = req.params as { wallet: string; skill: string };
    const skillId = skill as keyof typeof SKILLS;
    const dev = store.findDeveloperByWallet(wallet);
    const credential = dev && store.credentialFor(dev.id, skillId);
    if (!dev || !credential || credential.wallet !== wallet) {
      reply.type('image/svg+xml').send(
        renderFallbackBadge('INSUFFICIENT EVIDENCE')
      );
      return;
    }
    const { renderBadgeSvg } = await import('./badge.js');
    reply
      .type('image/svg+xml')
      .header('Cache-Control', 'public, max-age=3600')
      .send(
        renderBadgeSvg({
          skillLabel: SKILLS[skillId].label,
          score: credential.skillScore,
          confidencePercent: credential.confidencePercent,
          levelLabel: LEVEL_INFO[credential.level].label,
          wallet,
          verifyUrl: credential.reportUri
        })
      );
  });

  // ------------------------------------------------------------- search
  app.post('/api/search', async (req) => {
    const body = (req.body ?? {}) as {
      skills?: string[];
      minScore?: number;
      minConfidence?: number;
      minLevel?: number;
      activeWithinDays?: number;
      limit?: number;
    };
    return store.search({
      skills: body.skills as never,
      minScore: body.minScore,
      minConfidence: body.minConfidence,
      minLevel: body.minLevel,
      activeWithinDays: body.activeWithinDays,
      limit: body.limit
    });
  });

  // ----------------------------------------------------------------- invite
  app.post('/api/invite', admin, async (req, reply) => {
    const body = (req.body ?? {}) as { listingId?: string; githubHandle?: string; message?: string };
    const listing = store.listings.find((l) => l.id === body.listingId);
    if (!listing) return reply.code(404).send({ error: 'listing_not_found' });
    const dev = body.githubHandle ? store.findDeveloper(body.githubHandle) : undefined;
    const inv = {
      id: `inv-${crypto.randomUUID()}`,
      listingId: listing.id,
      developerId: dev?.id ?? null,
      wallet: dev?.linkedWallets[0]?.wallet ?? null,
      status: 'sent' as const,
      message: body.message ?? `Invite — ${listing.title}`,
      createdAt: new Date().toISOString()
    };
    store.invites.push(inv);
    return { invite: inv };
  });

  // ------------------------------------------------------- verified link
  app.post('/api/listings/:id/verified-link', admin, async (req, reply) => {
    const { id } = req.params as { id: string };
    const listing = store.listings.find((l) => l.id === id);
    if (!listing) return reply.code(404).send({ error: 'listing_not_found' });
    const token = crypto.randomUUID().slice(0, 12);
    listing.inviteUrl = `https://proofmesh.xyz/get-verified?ref=${token}&listing=${listing.id}`;
    return { listing };
  });

  // ------------------------------------------------------------- CLI/demo
  app.post('/api/reset', admin, async () => {
    store.reset();
    await hydrateSeededRuns(store);
    return { ok: true };
  });
}

// ---------------------------------------------------------------------------
// Tiny per-job fact bus (SSE): facts are buffered per job id, then replayed
// to late subscribers. Production swap: Redis pub/sub + BullMQ job state.
// ---------------------------------------------------------------------------

const buffers = new Map<string, SseEvent[]>();
const subscribers = new Map<string, Set<(e: SseEvent) => void>>();

function emitFact(jobId: string, e: SseEvent): void {
  const buf = buffers.get(jobId) ?? [];
  buf.push(e);
  buffers.set(jobId, buf);
  for (const sub of subscribers.get(jobId) ?? []) sub(e);
}

function drain(jobId: string): SseEvent[] {
  const buf = buffers.get(jobId) ?? [];
  buffers.set(jobId, []);
  return buf;
}

function subscribe(jobId: string, fn: (e: SseEvent) => void): void {
  const set = subscribers.get(jobId) ?? new Set();
  set.add(fn);
  subscribers.set(jobId, set);
}

function unsubscribe(jobId: string, fn: (e: SseEvent) => void): void {
  subscribers.get(jobId)?.delete(fn);
}

function renderFallbackBadge(label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="96" viewBox="0 0 320 96">
  <rect width="320" height="96" rx="14" fill="#FFFFFF" stroke="#E8E6DF" stroke-width="1.5"/>
  <text x="160" y="52" text-anchor="middle" font-family="monospace" font-size="12" fill="#7A827E">${label}</text>
</svg>`;
}