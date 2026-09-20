import type { FastifyInstance } from 'fastify';
import type { SseEvent } from '@proofmesh/shared-types';
import { SKILLS, LEVEL_INFO } from '@proofmesh/shared-types';
import { validateAttestationRecord } from '@proofmesh/verifier-sdk';
import type { Store } from './store.js';
import { runAnalysis } from './pipeline.js';
import { hydrateSeededRuns } from './hydrate.js';

export interface RouteContext {
  store: Store;
}

export async function registerRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const store = ctx.store;

  // ------------------------------------------------------------------ health
  app.get('/health', async () => ({
    status: 'ok',
    sourceOfTruth: 'docs/stitch_proofmesh_design_system_components',
    store: { developers: store.listDevelopers().length, jobs: store.jobs.size },
    deterministicOnly: !process.env.ANTHROPIC_API_KEY
  }));

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
  app.delete('/api/listings/:id', async (req, reply) => {
    const { id } = req.params as { id: string };
    const idx = store.listings.findIndex((l) => l.id === id);
    if (idx === -1) return reply.code(404).send({ error: 'listing_not_found' });
    const [removed] = store.listings.splice(idx, 1);
    return { removed: !!removed };
  });

  // ---------------------------------------------------------------- bind wallet
  app.post('/api/bind', async (req, reply) => {
    const body = (req.body ?? {}) as { githubUsername?: string; githubHandle?: string; wallet?: string };
    const handle = body.githubUsername ?? body.githubHandle ?? '';
    const wallet = (body.wallet ?? '').trim();
    if (!handle) return reply.code(400).send({ error: 'developer_required' });
    if (!wallet) return reply.code(400).send({ error: 'wallet_required' });

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

    const binding = store.bindWallet(dev.id, wallet);
    return { developer: dev, binding };
  });

  // ------------------------------------------------------------------- analyze
  app.post('/api/analyze', async (req, reply) => {
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

    // Optional wallet binding at analyze time: caller's wallet becomes the
    // credential recipient (honest live-user flow — no seeded wallet needed).
    const wallet = (body.wallet ?? '').trim();
    if (wallet) {
      try {
        store.bindWallet(dev.id, wallet);
      } catch (err) {
        if (err instanceof Error && err.message === 'developer_not_found') {
          return reply.code(404).send({ error: 'developer_not_found' });
        }
        return reply.code(400).send({ error: 'wallet_invalid' });
      }
    }

    const job = store.createJob({
      developerId: dev.id,
      githubUsername: dev.githubHandle,
      skillId,
      llmEnabled: !!body.llmEnabled && !!process.env.ANTHROPIC_API_KEY,
      mintWallet: wallet || null
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
  app.post('/api/invite', async (req, reply) => {
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
  app.post('/api/listings/:id/verified-link', async (req, reply) => {
    const { id } = req.params as { id: string };
    const listing = store.listings.find((l) => l.id === id);
    if (!listing) return reply.code(404).send({ error: 'listing_not_found' });
    const token = crypto.randomUUID().slice(0, 12);
    listing.inviteUrl = `https://proofmesh.xyz/get-verified?ref=${token}&listing=${listing.id}`;
    return { listing };
  });

  // ------------------------------------------------------------- CLI/demo
  app.post('/api/reset', async () => {
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