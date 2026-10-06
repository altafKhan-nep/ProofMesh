import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  AuditEventType,
  AuditOutcome,
  AuthSession,
  CredentialLevel,
  SseEvent,
  SkillId
} from '@proofmesh/shared-types';
import { ISSUANCE_GATE, SKILLS, LEVEL_INFO, isSkillId } from '@proofmesh/shared-types';
import { validateAttestationRecord, deriveCredentialPda, readAttestationFromRpc } from '@proofmesh/verifier-sdk';
import type { Store } from './store.js';
import { RateLimiter, rateLimitsFromEnv } from './rate-limit.js';
import {
  attestationEvidence,
  attestationId,
  buildAttestationStatement,
  isSelfAttestation,
  repoExists,
  repoOwnedBy,
  type AttestationRecord
} from './attestation.js';
import {
  authorizeUrl,
  exchangeCode,
  isPendingLive,
  newPendingOAuth,
  oauthConfigured,
  stateHash,
  stateMatches,
  type OAuthEndpoints,
  type PendingOAuth
} from './github-oauth.js';
import type { RateLimitRules } from './rate-limit.js';
import { queueAnalysisJob, queueMode } from './queue.js';
import { llmConfigured } from './llm.js';
import { emitFact, drain, subscribe, unsubscribe, sweepFactBus } from './fact-bus.js';
import { hydrateSeededRuns } from './hydrate.js';
import { predictCredential } from './pipeline.js';
import { originAllowed } from './cors.js';
import {
  CSRF_COOKIE,
  CSRF_HEADER,
  SESSION_COOKIE,
  bearerTokenFromHeader,
  csrfCookieOpts,
  isValidPubkey,
  newActionChallenge,
  newChallenge,
  newSession,
  safeEqual,
  sessionCookieOpts,
  siwsOrigin,
  touchSession,
  validateVerifyAgainstChallenge,
  verifyActionProof,
  verifySiwsSignature
} from './auth.js';

export interface RouteContext {
  store: Store;
  adminWallets: Set<string>;
  /** P4: per-route limits; defaults to rateLimitsFromEnv(). Tests may override. */
  rateLimits?: RateLimitRules;
  limiter?: RateLimiter;
  /** GitHub OAuth (GitHub-side proof of a binding). */
  githubOAuth?: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    endpoints?: Partial<OAuthEndpoints>;
    fetchImpl?: typeof fetch;
  };
}

type RequestWithAuth = FastifyRequest & { auth?: AuthSession; authVia?: 'bearer' | 'cookie' };

/**
 * The canonical ProofMesh issuer.
 *
 * `verifyConstraints` treats a supplied allowlist as authoritative, including
 * the empty array, so this must always be non-empty — an unset variable must
 * not degrade into "trust everyone".
 */
const ISSUER_ADDRESS = '6TGUP796erCCpxhosXToA4YNv4dxwz1yc7rmTvZEYagZ';

function issuerAllowlist(): string[] {
  const extra = (process.env.ISSUER_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return [ISSUER_ADDRESS, ...extra.filter((a) => a !== ISSUER_ADDRESS)];
}

/** Credential levels arrive from storage/chain; clamp before indexing. */
function clampLevel(level: number): CredentialLevel {
  if (!Number.isFinite(level)) return 0;
  return Math.min(3, Math.max(0, Math.trunc(level))) as CredentialLevel;
}

/** Hard ceiling on how many rows one search may return, regardless of input. */
const SEARCH_MAX_LIMIT = 100;

/**
 * Validate `POST /api/search`. The endpoint is unauthenticated, so the body is
 * untrusted: every field is range-checked instead of cast. Returning
 * `{ ok: false }` (rather than throwing) lets the route emit a 400.
 */
function parseSearchQuery(
  body: unknown
):
  | { ok: true; value: { skills?: SkillId[]; minScore?: number; minConfidence?: number; minLevel?: number; activeWithinDays?: number; limit: number } }
  | { ok: false; issues: string[] } {
  const issues: string[] = [];
  const src = (body ?? {}) as Record<string, unknown>;

  const num = (key: string, min: number, max: number): number | undefined => {
    const v = src[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      issues.push(`${key} must be a finite number`);
      return undefined;
    }
    if (v < min || v > max) {
      issues.push(`${key} must be between ${min} and ${max}`);
      return undefined;
    }
    return v;
  };

  let skills: SkillId[] | undefined;
  const rawSkills = src.skills;
  if (rawSkills !== undefined && rawSkills !== null) {
    if (!Array.isArray(rawSkills)) {
      issues.push('skills must be an array of skill ids');
    } else {
      const bad = rawSkills.filter((s) => !isSkillId(s));
      if (bad.length > 0) issues.push(`unknown skill(s): ${bad.map(String).join(', ')}`);
      else skills = rawSkills as SkillId[];
    }
  }

  const minScore = num('minScore', 0, 100);
  const minConfidence = num('minConfidence', 0, 1);
  const minLevel = num('minLevel', 1, 3);
  const activeWithinDays = num('activeWithinDays', 1, 3650);
  // Default and clamp the limit here; `store.search` also clamps defensively.
  const rawLimit = num('limit', 1, SEARCH_MAX_LIMIT);
  const limit = rawLimit ?? 20;

  if (issues.length > 0) return { ok: false, issues };
  return {
    ok: true,
    value: { skills, minScore, minConfidence, minLevel, activeWithinDays, limit }
  };
}

/** Read Fastify's parsed cookies without adding a plugin dependency. */
function readCookie(req: FastifyRequest, name: string): string | undefined {
  const jar = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies;
  if (jar && typeof jar[name] === 'string') return jar[name];
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/**
 * Browser session transport: httpOnly session cookie + readable CSRF cookie.
 * Guarded because @fastify/cookie is registered by the server entrypoint; a
 * bare app (e.g. an isolated test harness) simply has no cookie transport and
 * keeps using the bearer header.
 */
function setSessionCookies(reply: FastifyReply, session: AuthSession, req: FastifyRequest): void {
  if (typeof reply.setCookie !== 'function') return;
  reply.setCookie(SESSION_COOKIE, session.token, sessionCookieOpts(req));
  reply.setCookie(CSRF_COOKIE, session.csrfToken ?? '', csrfCookieOpts(req));
}

function clearSessionCookies(reply: FastifyReply): void {
  if (typeof reply.clearCookie !== 'function') return;
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
  reply.clearCookie(CSRF_COOKIE, { path: '/' });
}

/**
 * Resolve a session from either transport:
 *   - `Authorization: Bearer <token>` — API clients, scripts, tests. No CSRF
 *     check is possible or needed: a cross-origin page cannot set this header.
 *   - `pm_session` httpOnly cookie — browsers. Mutating requests additionally
 *     require the double-submit `x-pm-csrf` header to match the session token,
 *     so a stolen cookie alone is not enough from another origin.
 */
async function resolveSession(
  req: RequestWithAuth,
  store: Store
): Promise<{ session?: AuthSession; via?: 'bearer' | 'cookie'; token?: string }> {
  const bearer = bearerTokenFromHeader(req.headers.authorization);
  if (bearer) {
    const session = await store.sessionFor(bearer);
    return session ? { session, via: 'bearer', token: bearer } : {};
  }
  const cookieToken = readCookie(req, SESSION_COOKIE);
  if (cookieToken) {
    const session = await store.sessionFor(cookieToken);
    if (!session) return {};
    const mutating = isMutating(req);
    if (mutating) {
      const header = req.headers[CSRF_HEADER];
      const presented = Array.isArray(header) ? header[0] : header;
      if (!safeEqual(presented, session.csrfToken)) return { session, via: 'cookie', token: cookieToken };
    }
    return { session, via: 'cookie', token: cookieToken };
  }
  return {};
}

function isMutating(req: FastifyRequest): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase());
}

/**
 * Authenticate the request, sending the failure reply itself. Returns the session
 * on success, or null once a 401/403 has been sent.
 */
async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
  store: Store
): Promise<AuthSession | null> {
  const req = request as RequestWithAuth;
  const { session, via } = await resolveSession(req, store);
  if (!session) {
    await reply.code(401).send({ error: 'auth_required', message: 'Sign in with your Solana wallet first.' });
    return null;
  }
  if (via === 'cookie' && isMutating(req) && !safeEqual(headerValue(req, CSRF_HEADER), session.csrfToken)) {
    await reply.code(403).send({ error: 'csrf_failed', message: 'Missing or invalid CSRF token.' });
    return null;
  }
  req.auth = session;
  req.authVia = via;
  return session;
}

/** Require a signed-in session (bearer header, or cookie + CSRF header). */
function requireAuth(store: Store) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await authenticate(request, reply, store);
  };
}

/** Map a concrete path to its declared route pattern (for limiter keys). */
function routePattern(req: FastifyRequest): string {
  const path = req.url.split('?')[0] ?? req.url;
  if (/^\/api\/listings\/[^/]+\/verified-link$/.test(path)) return '/api/listings/:id/verified-link';
  if (/^\/api\/listings\/[^/]+$/.test(path)) return '/api/listings/:id';
  if (/^\/api\/analyze\/[^/]+$/.test(path)) return '/api/analyze/:id';
  if (/^\/api\/developers\/[^/]+$/.test(path)) return '/api/developers/:handle';
  if (/^\/api\/evidence\/[^/]+$/.test(path)) return '/api/evidence/:handle';
  if (/^\/api\/verify\/[^/]+\/[^/]+$/.test(path)) return '/api/verify/:wallet/:skill';
  if (/^\/api\/badge\/[^/]+\/[^/]+\.svg$/.test(path)) return '/api/badge/:wallet/:skill.svg';
  return path;
}

function headerValue(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/** Admin role check (no action signature) — used by reads and as a guard stage. */
function requireAdminRole(store: Store, adminWallets: Set<string>) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const session = await authenticate(request, reply, store);
    if (!session) return;
    if (!adminWallets.has(session.wallet)) {
      await reply.code(403).send({
        error: 'admin_required',
        message: 'This action is limited to admin wallets (ADMIN_WALLETS).'
      });
    }
  };
}

/**
 * P2: privileged admin actions additionally require a fresh per-request wallet
 * signature. Runs after authentication + rate limiting, so the limiter can key
 * on the real wallet and a throttled request never burns an action nonce.
 */
function requireActionProof(store: Store) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const req = request as RequestWithAuth;
    const session = req.auth;
    if (!session) return;
    const deny = async (reason: string, error: string, message: string) => {
      store.audit.record({
        type: 'admin.action',
        outcome: 'denied',
        actor: session.wallet,
        role: session.role,
        method: req.method,
        route: routePattern(req),
        ip: req.ip,
        reason
      });
      await reply.code(401).send({ error, message });
    };

    const nonce = headerValue(req, 'x-pm-action-nonce');
    const signature = headerValue(req, 'x-pm-action-signature');
    if (!nonce || !signature) {
      return deny(
        'action_proof_required',
        'action_proof_required',
        'Privileged actions require a fresh wallet signature over this request.'
      );
    }
    const challenge = store.consumeActionChallenge(nonce);
    if (!challenge) {
      return deny('action_challenge_not_found', 'action_challenge_not_found', 'Action challenge unknown or already used.');
    }
    const invalid = verifyActionProof(challenge, signature, {
      wallet: session.wallet,
      method: req.method,
      path: req.url.split('?')[0] ?? req.url,
      body: req.body
    });
    store.audit.record({
      type: 'admin.action',
      outcome: invalid ? 'denied' : 'success',
      actor: session.wallet,
      role: session.role,
      method: req.method,
      route: routePattern(req),
      ip: req.ip,
      ...(invalid ? { reason: invalid } : {})
    });
    if (invalid) await reply.code(401).send({ error: invalid });
  };
}

export async function registerRoutes(app: FastifyInstance, ctx: RouteContext): Promise<void> {
  const store = ctx.store;
  const adminWallets = ctx.adminWallets;
  const rateLimitRules = ctx.rateLimits ?? rateLimitsFromEnv();
  const limiter = ctx.limiter ?? new RateLimiter(rateLimitRules);
  const rules = rateLimitRules;

  /** Client identity for rate limiting: IP always, wallet when authenticated. */
  const rateKey = (req: RequestWithAuth): string =>
    `${req.ip ?? 'unknown'}|${(req.auth?.wallet ?? 'anon').slice(0, 12)}`;

  /** P4 preHandler: fixed-window limit per (client, route). */
  const limit = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const req = request as RequestWithAuth;
    const route = routePattern(req);
    const rule = rules[`${req.method.toUpperCase()} ${route}`];
    const decision = limiter.consume(rateKey(req), rule);
    if (!decision.ok) {
      store.audit.record({
        type: 'rate_limited',
        outcome: 'blocked',
        method: req.method,
        route,
        ip: req.ip,
        reason: 'rate_limited',
        meta: { limit: decision.limit }
      });
      reply.header('retry-after', String(decision.retryAfterSec));
      await reply.code(429).send({
        error: 'rate_limited',
        message: `Too many requests. Retry in ${decision.retryAfterSec}s.`
      });
      return;
    }
  };

  /** Compose guards into one preHandler (array form trips Fastify's hook typing). */
  const chain =
    (...guards: Array<(request: FastifyRequest, reply: FastifyReply) => Promise<void>>) =>
    async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
      for (const guard of guards) {
        if (reply.sent) return; // a previous guard already answered
        await guard(request, reply);
      }
    };

  // Order matters: authenticate first so the limiter can key on the real wallet,
  // then throttle, then (for admin writes) verify role and the action signature.
  const authLimited = chain(requireAuth(store), limit);
  const adminLimited = chain(
    requireAdminRole(store, adminWallets),
    limit,
    requireActionProof(store)
  );
  const adminRead = requireAdminRole(store, adminWallets);

  /** P3: append a redacted security event. */
  const audit = (req: RequestWithAuth, event: Omit<Parameters<Store['audit']['record']>[0], 'ip'>) =>
    store.audit.record({ ...event, ip: req.ip });
  app.decorateRequest('auth', null as AuthSession | null);
  app.decorateRequest('authVia', null as 'bearer' | 'cookie' | null);

  // ------------------------------------------------------------------ health
  app.get('/health', async () => ({
    status: 'ok',
    sourceOfTruth: 'docs/stitch_proofmesh_design_system_components',
    store: { developers: store.listDevelopers().length, jobs: store.jobs.size },
    // Report the mode that is actually in effect. This previously read
    // ANTHROPIC_API_KEY while the code calls Gemini, so /health claimed
    // `deterministicOnly: false` on a server with no usable LLM key.
    llm: llmConfigured(),
    deterministicOnly: !llmConfigured(),
    queue: queueMode(),
    issuer: ISSUER_ADDRESS
  }));


  // ------------------------------------------------------- GitHub App webhook
  /**
   * GitHub App webhook.
   *
   * Fails CLOSED. The previous guard was `if (secret && sig)`, so an unset
   * secret OR an omitted header both skipped verification entirely and the
   * endpoint answered `{ok:true}` to anyone. It also wrote a fresh
   * `Date.now()`-keyed entry into `store.metadata` on every hit — an unbounded,
   * unauthenticated write into the map that gets serialised to Postgres every
   * five seconds, i.e. a durable write-amplification DoS.
   */
  const WEBHOOK_EVENTS = new Set(['push', 'ping', 'installation', 'installation_repositories']);
  app.post('/api/github/webhook', { preHandler: limit }, async (req, reply) => {
    const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;
    if (!secret) {
      // Refuse to run an unauthenticated public endpoint.
      return reply.code(503).send({ error: 'webhook_disabled_no_secret' });
    }
    const sig = req.headers['x-hub-signature-256'];
    if (typeof sig !== 'string' || sig.length === 0) {
      return reply.code(401).send({ error: 'missing_signature' });
    }
    const raw = (req as unknown as { rawBody?: string }).rawBody ?? '';
    if (!raw) return reply.code(400).send({ error: 'raw_body_unavailable' });

    const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
    // Constant-time: a plain `!==` leaks the expected digest byte by byte.
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return reply.code(401).send({ error: 'invalid_signature' });
    }

    const event = req.headers['x-github-event'];
    const eventName = typeof event === 'string' ? event : 'unknown';
    if (!WEBHOOK_EVENTS.has(eventName)) {
      return reply.code(202).send({ ok: true, ignored: eventName });
    }

    // Bounded, fixed-key accounting instead of one growing key per request.
    const key = 'github-webhook:last';
    store.metadata.set(key, JSON.stringify({ event: eventName, at: new Date().toISOString() }));

    audit(req, {
      type: 'webhook.received',
      outcome: 'success',
      method: req.method,
      route: '/api/github/webhook',
      meta: { event: eventName }
    });
    return { ok: true, event: eventName };
  });

  // ------------------------------------------------------------------ auth
  const auth = { preHandler: requireAuth(store) };
  /** Single-use OAuth `state` values, bound to the session wallet. */
  const pendingOAuth = new Map<string, PendingOAuth>();
  const oauthCfg = ctx.githubOAuth;
  const oauthReady = Boolean(oauthCfg && oauthConfigured(oauthCfg));

  /** The origin the calling page runs on, so SIWS messages pass wallet validation. */
  const originFor = (req: FastifyRequest): { domain: string; uri: string } =>
    siwsOrigin({
      origin: req.headers.origin ?? null,
      protocol: req.protocol,
      hostname: req.hostname
    });

  app.post('/api/auth/challenge', { preHandler: limit }, async (req, reply) => {
    const body = (req.body ?? {}) as {
      wallet?: string;
      purpose?: string;
      subject?: string;
      repo?: string;
      skill?: string;
    };
    const wallet = (body.wallet ?? '').trim();
    if (!isValidPubkey(wallet)) {
      return reply.code(400).send({ error: 'invalid_wallet', message: 'Provide a valid base58 Solana public key.' });
    }
    const purpose = body.purpose === 'bind' || body.purpose === 'attest' ? body.purpose : 'signin';
    const subject = (body.subject ?? '').trim();
    const repo = (body.repo ?? '').trim();
    const skill = (body.skill ?? '').trim();
    if (purpose !== 'signin' && !/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(subject)) {
      return reply.code(400).send({ error: 'invalid_subject', message: 'A valid GitHub handle is required.' });
    }
    if (purpose === 'attest') {
      if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
        return reply.code(400).send({ error: 'invalid_repo', message: 'Repository must be owner/name.' });
      }
      if (!skill || !/^[a-z0-9-]{2,40}$/.test(skill)) {
        return reply.code(400).send({ error: 'invalid_skill' });
      }
    }
    const challenge = newChallenge(
      wallet,
      purpose === 'signin'
        ? { origin: originFor(req) }
        : { purpose, subject, ...(purpose === 'attest' ? { repo, skill } : {}), origin: originFor(req) }
    );
    const issued = store.issueChallenge(challenge);
    audit(req, {
      type: 'auth.challenge',
      outcome: issued.ok ? 'success' : 'denied',
      method: req.method,
      route: '/api/auth/challenge',
      reason: issued.ok ? undefined : issued.reason,
      meta: { purpose: challenge.purpose ?? 'signin' }
    });
    if (!issued.ok) {
      return reply.code(429).send({ error: issued.reason, message: 'Too many open challenges for this wallet.' });
    }
    return challenge;
  });

  app.post('/api/auth/verify', { preHandler: limit }, async (req, reply) => {
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
      audit(req, {
        type: 'auth.signin',
        outcome: 'denied',
        method: req.method,
        route: '/api/auth/verify',
        reason: 'invalid_signature',
        meta: { wallet }
      });
      return reply.code(401).send({ error: 'invalid_signature' });
    }

    const role = adminWallets.has(wallet) ? 'admin' : 'user';
    const session = newSession(wallet, role);
    store.createSession(session);
    // Browser transport: httpOnly session cookie + readable CSRF cookie. The
    // token is still returned for API clients that prefer the bearer header.
    setSessionCookies(reply, session, req);
    audit(req, {
      type: 'auth.signin',
      outcome: 'success',
      actor: wallet,
      role,
      method: req.method,
      route: '/api/auth/verify'
    });
    return {
      token: session.token,
      csrfToken: session.csrfToken,
      wallet,
      role,
      expiresAt: session.expiresAt
    };
  });

  app.get('/api/auth/me', auth, async (req) => {
    const session = (req as RequestWithAuth).auth!;
    touchSession(session);
    return { wallet: session.wallet, role: session.role, expiresAt: session.expiresAt };
  });

  /**
   * P2: issue a single-use proof challenge for a privileged action. The wallet
   * signs the exact method+path+body, so the resulting signature cannot be
   * replayed against a different admin action.
   */
  app.post('/api/auth/action-challenge', { preHandler: authLimited }, async (req, reply) => {
    const session = (req as RequestWithAuth).auth!;
    const body = (req.body ?? {}) as { method?: string; path?: string; action?: unknown };
    const method = (body.method ?? '').toUpperCase();
    const path = body.path ?? '';
    if (!method || !path.startsWith('/api/')) {
      return reply.code(400).send({ error: 'invalid_action', message: 'method and an /api/... path are required.' });
    }
    // The body that will be signed is supplied by the client as `action`; the
    // server binds its hash into the message and re-checks it at use time.
    const challenge = newActionChallenge({
      wallet: session.wallet,
      method,
      path,
      body: body.action ?? {},
      origin: originFor(req)
    });
    store.issueActionChallenge(challenge);
    return challenge;
  });

  // ------------------------------------------------------- GitHub OAuth (proof)
  /**
   * Step 1 of the GitHub-side proof: mint a single-use state bound to this
   * session's wallet and return the authorize URL. No scopes are requested —
   * public repository data needs none.
   */
  app.get('/api/auth/github/start', auth, async (req) => {
    if (!oauthReady || !oauthCfg) {
      return { configured: false, authorizeUrl: null, message: 'GitHub OAuth is not configured on this server.' };
    }
    const session = (req as RequestWithAuth).auth!;
    const returnTo = (req.query as { returnTo?: string })?.returnTo ?? null;
    const pending = newPendingOAuth(session.wallet, returnTo);
    pendingOAuth.set(pending.stateHash, pending);
    store.audit.record({
      type: 'auth.github_oauth',
      outcome: 'success',
      actor: session.wallet,
      role: session.role,
      method: req.method,
      route: '/api/auth/github/start'
    });
    return {
      configured: true,
      authorizeUrl: authorizeUrl(
        { clientId: oauthCfg.clientId, clientSecret: oauthCfg.clientSecret, endpoints: oauthCfg.endpoints },
        pending,
        oauthCfg.redirectUri
      )
    };
  });

  /** Current GitHub proof on this session. */
  app.get('/api/auth/github/status', auth, async (req) => {
    const session = (req as RequestWithAuth).auth!;
    return { proven: Boolean(session.githubLogin), login: session.githubLogin ?? null };
  });

  /**
   * Step 2: GitHub redirects here with code+state. The state is consumed, the
   * code exchanged server-side, and the verified login attached to the session.
   * From here a bind can be created with BOTH legs proven.
   */
  app.get('/api/auth/github/callback', auth, async (req, reply) => {
    const session = (req as RequestWithAuth).auth!;
    const q = (req.query ?? {}) as { code?: string; state?: string; error?: string };
    const deny = async (reason: string, error: string, message: string) => {
      store.audit.record({
        type: 'auth.github_oauth',
        outcome: 'denied',
        actor: session.wallet,
        role: session.role,
        method: req.method,
        route: '/api/auth/github/callback',
        reason
      });
      return reply.code(401).send({ error, message });
    };

    if (q.error) return deny('oauth_provider_error', 'github_oauth_denied', `GitHub returned: ${q.error}`);
    if (!oauthReady || !oauthCfg) return deny('oauth_not_configured', 'github_oauth_not_configured', 'OAuth is not configured.');
    if (!q.code || !q.state) return deny('missing_params', 'github_oauth_missing_params', 'code and state are required.');

    const pending = pendingOAuth.get(stateHash(q.state));
    if (!pending) return deny('state_unknown', 'github_oauth_state_invalid', 'Unknown or already-used state.');
    pendingOAuth.delete(pending.stateHash); // single use
    if (!stateMatches(pending, q.state)) return deny('state_mismatch', 'github_oauth_state_invalid', 'State mismatch.');
    if (!isPendingLive(pending)) return deny('state_expired', 'github_oauth_state_expired', 'Sign-in request expired.');
    if (pending.wallet !== session.wallet) {
      return deny('state_wallet_mismatch', 'github_oauth_state_invalid', 'State was issued to a different wallet.');
    }

    let identity;
    try {
      identity = await exchangeCode(
        {
          clientId: oauthCfg.clientId,
          clientSecret: oauthCfg.clientSecret,
          endpoints: oauthCfg.endpoints,
          fetchImpl: oauthCfg.fetchImpl
        },
        q.code,
        oauthCfg.redirectUri
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'oauth_exchange_failed';
      return deny(reason, 'github_oauth_exchange_failed', 'Could not complete the GitHub authorization.');
    }

    session.githubLogin = identity.login;
    store.audit.record({
      type: 'auth.github_oauth',
      outcome: 'success',
      actor: session.wallet,
      role: session.role,
      method: req.method,
      route: '/api/auth/github/callback',
      meta: { github: identity.login }
    });
    return { proven: true, login: identity.login, avatarUrl: identity.avatarUrl, returnTo: pending.returnTo };
  });

  /**
   * P3: read the security audit trail. Admin-only, and a read (no per-action
   * signature needed). Every privileged write is already recorded by the guard.
   */
  app.get('/api/admin/audit', { preHandler: adminRead }, async (req) => {
    const q = req.query as { limit?: string; type?: string; outcome?: string };
    const limitN = Math.min(200, Math.max(1, Number(q.limit ?? 50) || 50));
    return {
      capacity: 1000,
      total: store.audit.size,
      events: store.audit.list({
        limit: limitN,
        ...(q.type ? { type: q.type as AuditEventType } : {}),
        ...(q.outcome ? { outcome: q.outcome as AuditOutcome } : {})
      })
    };
  });

  app.post('/api/auth/logout', auth, async (req, reply) => {
    const r = req as RequestWithAuth;
    const session = r.auth!;
    // Revoke by the token the client presented: a session restored from
    // persistence has no token of its own.
    const presented = bearerTokenFromHeader(r.headers.authorization) ?? readCookie(r, SESSION_COOKIE);
    if (presented) await store.revokeSession(presented);
    clearSessionCookies(reply);
    audit(req, {
      type: 'auth.signout',
      outcome: 'success',
      actor: session.wallet,
      role: session.role,
      method: req.method,
      route: '/api/auth/logout'
    });
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
  app.delete('/api/listings/:id', { preHandler: adminLimited }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const idx = store.listings.findIndex((l) => l.id === id);
    if (idx === -1) return reply.code(404).send({ error: 'listing_not_found' });
    const [removed] = store.listings.splice(idx, 1);
    return { removed: !!removed };
  });

  // ---------------------------------------------------------------- bind wallet
  app.post('/api/bind', { preHandler: authLimited }, async (req, reply) => {
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
      audit(req, { type: 'bind.attempt', outcome: 'denied', actor: session.wallet, reason: 'wallet_mismatch', method: req.method, route: '/api/bind', meta: { handle } });
      return reply.code(403).send({
        error: 'wallet_mismatch',
        message: 'A binding must be signed by the wallet that owns it — sign in with the wallet you are binding.'
      });
    }
    const { message, signature } = body;
    if (!message || !signature) {
      audit(req, { type: 'bind.attempt', outcome: 'denied', actor: session.wallet, reason: 'proof_required', method: req.method, route: '/api/bind', meta: { handle } });
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

    // Second leg: the session must carry a GitHub identity proven via OAuth, and
    // it must be the account being bound. One leg alone never creates a binding.
    const provenLogin = session.githubLogin;
    if (!provenLogin) {
      audit(req, { type: 'bind.attempt', outcome: 'denied', actor: session.wallet, reason: 'github_proof_required', method: req.method, route: '/api/bind', meta: { handle } });
      return reply.code(403).send({
        error: 'github_proof_required',
        message: 'Connect GitHub (OAuth) to prove you own this account before binding.'
      });
    }
    if (provenLogin.toLowerCase() !== handle.toLowerCase()) {
      audit(req, { type: 'bind.attempt', outcome: 'denied', actor: session.wallet, reason: 'github_identity_mismatch', method: req.method, route: '/api/bind', meta: { handle, proven: provenLogin } });
      return reply.code(403).send({
        error: 'github_identity_mismatch',
        message: `This session is authorized as @${provenLogin}, not @${handle}.`
      });
    }

    let dev = store.findDeveloper(handle);
    if (!dev) {
      try {
        const { ingestGitHub } = await import('./github.js');
        // Must match the analyze depth, or bind/analyze order decides how much
        // evidence the scoring engine sees (they previously disagreed: 1 vs 4).
        const ingested = await ingestGitHub(store, handle);
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

    audit(req, { type: 'bind.attempt', outcome: 'success', actor: session.wallet, method: req.method, route: '/api/bind', meta: { handle } });
    const binding = store.bindWallet(dev.id, wallet, {
      signedMessage: bindChallenge.message,
      nonce: bindChallenge.nonce,
      domain: bindChallenge.domain,
      // Both legs proven: wallet signature (checked above) and GitHub OAuth.
      github: 'proven'
    });
    return { developer: dev, binding };
  });

  // ------------------------------------------------------------------- analyze
  app.post('/api/analyze', { preHandler: authLimited }, async (req, reply) => {
    const body = (req.body ?? {}) as {
      githubHandle?: string;
      githubUsername?: string;
      skillId?: string;
      llmEnabled?: boolean;
      wallet?: string;
    };
    const skillId = body.skillId ?? 'solana-anchor';
    // `SKILLS['toString']` is a truthy inherited member, so a bare lookup test
    // would pass and then crash the pipeline on `FAMILY[skillId].includes`.
    if (!isSkillId(skillId)) return reply.code(400).send({ error: 'unknown_skill' });

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
        const ingested = await ingestGitHub(store, handle);
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

    audit(req, {
      type: 'analyze.request',
      outcome: 'success',
      actor: session.wallet,
      method: req.method,
      route: '/api/analyze',
      meta: { github: handle, skill: skillId }
    });
    const job = store.createJob({
      developerId: dev.id,
      githubUsername: dev.githubHandle,
      skillId,
      // Was gated on ANTHROPIC_API_KEY while llm.ts reads GEMINI_API_KEY,
      // so with the documented setup the reviewer/skeptic never ran at all.
      llmEnabled: !!body.llmEnabled && llmConfigured(),
      mintWallet: requestedWallet || null
    });

    // Must be caught: an unhandled rejection here terminates the process
    // (Node's default since v15) and turns one Redis blip into an outage.
    void queueAnalysisJob(store, job).catch((err: unknown) => {
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
    const origin = originAllowed(req.headers.origin) ? req.headers.origin ?? '*' : undefined;
    raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {})
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

    // `?skill=` selects a specific skill pack. Without it we fall back to the
    // historical default, but a caller asking for `rust` must never be handed
    // the solana-anchor breakdown.
    const wanted = (req.query as { skill?: string } | undefined)?.skill;
    let score: ReturnType<Store['scoreFor']>;
    if (wanted !== undefined) {
      if (!isSkillId(wanted)) return reply.code(400).send({ error: 'unknown_skill' });
      score = store.scoreFor(dev.id, wanted);
    } else {
      score = store.scoreFor(dev.id, 'solana-anchor') ?? store.scoreFor(dev.id, 'typescript');
    }
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
    const skillId = skill;
    if (!isSkillId(skillId)) return reply.code(404).send({ error: 'unknown_skill' });
    const dev = store.findDeveloperByWallet(wallet);
    const score = dev && store.scoreFor(dev.id, skillId);
    const credential = dev && store.credentialFor(dev.id, skillId);
    if (!dev || !score || !credential || credential.wallet !== wallet) {
      return reply.code(404).send({ valid: false, reason: 'credential_not_found', wallet, skillId });
    }

    // Authoritative on-chain PDA (deterministic from wallet + skill) — the
    // stored attestationAddress may predate an SDK derivation fix.
    const pda = await deriveCredentialPda(wallet, skillId);

    // Constraint-check through the shared SDK logic (RPC-grade, off-chain mirror).
    //
    // These thresholds were `minScore: 0, minConfidence: 0` with NO issuer
    // allowlist, so `verifyConstraints` reduced to "not revoked, not expired,
    // level >= 1" — i.e. `valid: true` meant only "a row exists in Postgres",
    // while the README markets this SDK as trustless. It now enforces the same
    // issuance gate as the pipeline and requires the canonical issuer.
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
      {
        minScore: ISSUANCE_GATE.minShownScore,
        minConfidence: ISSUANCE_GATE.minConfidence,
        issuerAllowlist: issuerAllowlist()
      }
    );

    if (!grade.valid) {
      return reply.code(404).send({ valid: false, reasons: grade.reasons, wallet, skillId });
    }

    // Reconcile against chain. If the on-chain record disagrees with the
    // off-chain one, say so instead of silently serving the DB row.
    let onChain: { status: string; skillScore: number; confidencePercent: number; level: number; evidenceRoot: string } | null = null;
    let onChainMismatch: string[] = [];
    try {
      const rpcUrl = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
      const att = await readAttestationFromRpc({ wallet, skillId, rpcUrl });
      if (!att) {
        onChainMismatch.push('No on-chain credential found at the derived PDA (mint pending or never submitted).');
      } else {
        onChain = {
          status: att.status,
          skillScore: att.skillScore,
          confidencePercent: att.confidencePercent,
          level: att.level,
          evidenceRoot: att.evidenceRoot
        };
        if (att.status !== 'ISSUED') onChainMismatch.push(`On-chain status is ${att.status}.`);
        if (att.skillScore !== credential.skillScore)
          onChainMismatch.push(`On-chain score ${att.skillScore} ≠ record ${credential.skillScore}.`);
        if (att.confidencePercent !== credential.confidencePercent)
          onChainMismatch.push(`On-chain confidence ${att.confidencePercent}% ≠ record ${credential.confidencePercent}%.`);
      }
    } catch (err) {
      // RPC unreachable must not make the page unusable; report it explicitly.
      onChainMismatch.push(`On-chain check failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      valid: true,
      wallet,
      skillId: credential.skillId,
      skillLabel: SKILLS[skillId].label,
      score: credential.skillScore,
      confidence: credential.confidencePercent,
      level: credential.level,
      levelLabel: LEVEL_INFO[clampLevel(credential.level)].label,
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
      status: credential.status,
      onChain,
      onChainMismatch
    };
  });

  // --------------------------------------------------------------------- badge
  app.get('/api/badge/:wallet/:skill.svg', async (req, reply) => {
    const { wallet, skill } = req.params as { wallet: string; skill: string };
    const skillId = skill;
    if (!isSkillId(skillId)) {
      reply.type('image/svg+xml').send(renderFallbackBadge('UNKNOWN SKILL'));
      return;
    }
    const dev = store.findDeveloperByWallet(wallet);
    // `credentialFor` now enforces expiry and status, so an expired or revoked
    // credential falls through to the fallback badge. Previously it ignored
    // `expiresAt` entirely: `/api/verify` would 404 while this endpoint happily
    // served a green VERIFIED badge (cached for an hour) for the same pair.
    const credential = dev && store.credentialFor(dev.id, skillId);
    if (!dev || !credential || credential.wallet !== wallet) {
      reply
        .type('image/svg+xml')
        .header('Cache-Control', 'public, max-age=300')
        .send(renderFallbackBadge('INSUFFICIENT EVIDENCE'));
      return;
    }
    // A badge is a public claim; do not mint one for a credential that fails
    // the same issuance gate `/api/verify` enforces.
    const badgeGrade = validateAttestationRecord(
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
      {
        minScore: ISSUANCE_GATE.minShownScore,
        minConfidence: ISSUANCE_GATE.minConfidence,
        issuerAllowlist: issuerAllowlist()
      }
    );
    if (!badgeGrade.valid) {
      reply
        .type('image/svg+xml')
        .header('Cache-Control', 'public, max-age=300')
        .send(renderFallbackBadge('NOT CURRENTLY VERIFIED'));
      return;
    }
    const { renderBadgeSvg } = await import('./badge.js');
    reply
      .type('image/svg+xml')
      // Short TTL: revocation must become visible quickly.
      .header('Cache-Control', 'public, max-age=300')
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

  // ------------------------------------------------------------- stats
  app.get('/api/stats', { preHandler: limit }, async () => store.stats());

  // ------------------------------------------------------------- search
  app.post('/api/search', { preHandler: limit }, async (req, reply) => {
    // Unauthenticated, therefore untrusted: validate every field rather than
    // casting. An unchecked `limit: -1` previously made `slice(0, -1)` return
    // the entire candidate set.
    const parsed = parseSearchQuery(req.body);
    if (!parsed.ok) return reply.code(400).send({ error: 'invalid_query', issues: parsed.issues });
    return store.search(parsed.value);
  });

  // --------------------------------------------------------- Tier-2 attestation
  /**
   * Independent maintainer attestation (Tier-2). Unlocks Expert/L3, which today is
   * unreachable because nothing produces MAINTAINER_ATTESTATION evidence.
   *
   * Requires, in order: a signed-in wallet, an OAuth-proven GitHub identity, that
   * identity owning the repository, the attester not being the developer being
   * vouched for, and a fresh single-use signature over the whole claim.
   */
  app.post('/api/attest', { preHandler: authLimited }, async (req, reply) => {
    const session = (req as RequestWithAuth).auth!;
    const body = (req.body ?? {}) as {
      githubUsername?: string;
      repo?: string;
      skill?: string;
      message?: string;
      signature?: string;
    };
    const handle = (body.githubUsername ?? '').trim();
    const repo = (body.repo ?? '').trim();
    const skill = (body.skill ?? '').trim();
    const deny = async (reason: string, error: string, message: string, code = 403) => {
      audit(req, { type: 'attest.attempt', outcome: 'denied', actor: session.wallet, role: session.role, method: req.method, route: '/api/attest', reason, meta: { handle, repo } });
      return reply.code(code).send({ error, message });
    };

    if (!handle || !repo || !skill) {
      return deny('missing_fields', 'missing_fields', 'githubUsername, repo and skill are required.', 400);
    }
    if (!body.message || !body.signature) {
      return deny('proof_required', 'proof_required', 'Sign an attest challenge with your wallet.', 400);
    }

    // Rule 1: the attester must have proven their GitHub identity.
    const attesterLogin = session.githubLogin;
    if (!attesterLogin) {
      return deny(
        'github_proof_required',
        'github_proof_required',
        'Connect GitHub (OAuth) first: only a proven GitHub identity can attest.'
      );
    }

    const subject = store.findDeveloper(handle);
    if (!subject) {
      return deny('developer_not_found', 'developer_not_found', `No developer @${handle} in the store.`, 404);
    }

    // Rule 2: no self-attestation — the whole value of Tier-2 is independence.
    if (isSelfAttestation(handle, attesterLogin)) {
      return deny(
        'self_attestation',
        'self_attestation',
        'You cannot attest your own work; Tier-2 requires an independent maintainer.'
      );
    }

    const repos = store.reposFor(subject.id);
    // Rule 3: the attester must own the repository being vouched for.
    if (!repoExists(repos, repo)) {
      return deny('repo_not_in_evidence', 'repo_not_in_evidence', `${repo} is not part of @${handle}'s analysed repositories.`, 404);
    }
    if (!repoOwnedBy(repos, repo, attesterLogin)) {
      return deny(
        'not_repo_owner',
        'not_repo_owner',
        `Your GitHub identity @${attesterLogin} does not own ${repo}.`
      );
    }

    // Rule 4 (liveness): a fresh single-use challenge bound to this exact claim.
    const nonce = /^Nonce:\s*(.+)$/m.exec(body.message)?.[1];
    if (!nonce) return deny('malformed_message', 'malformed_message', 'Could not read the challenge nonce.', 400);
    const challenge = store.consumeChallenge(nonce);
    if (!challenge) {
      return deny('challenge_not_found', 'challenge_not_found', 'Attest challenge unknown or already used.', 401);
    }
    if (challenge.purpose !== 'attest' || challenge.subject?.toLowerCase() !== handle.toLowerCase()) {
      return deny('challenge_audience_mismatch', 'challenge_audience_mismatch', 'That challenge was not issued for this attestation.', 401);
    }
    if (challenge.wallet !== session.wallet) {
      return deny('challenge_wallet_mismatch', 'challenge_wallet_mismatch', 'Challenge was issued to a different wallet.', 401);
    }
    if (challenge.repo?.toLowerCase() !== repo.toLowerCase() || challenge.skill !== skill) {
      return deny('challenge_claim_mismatch', 'challenge_claim_mismatch', 'Challenge was issued for a different repo or skill.', 401);
    }
    if (new Date(challenge.expirationTime).getTime() < Date.now()) {
      return deny('challenge_expired', 'challenge_expired', 'Attest challenge expired — request a new one.', 401);
    }
    if (!verifySiwsSignature(challenge.message, body.signature, session.wallet)) {
      return deny('invalid_signature', 'invalid_signature', 'Signature did not verify.', 401);
    }

    const record: AttestationRecord = {
      id: attestationId(session.wallet, handle, repo, challenge.nonce),
      subjectHandle: handle,
      subjectDeveloperId: subject.id,
      attesterLogin,
      attesterWallet: session.wallet,
      repo,
      skill,
      statement: buildAttestationStatement({ subjectHandle: handle, repo, skill }),
      signedMessage: challenge.message,
      signature: body.signature,
      nonce: challenge.nonce,
      domain: challenge.domain,
      issuedAt: challenge.issuedAt,
      expiresAt: challenge.expirationTime,
      createdAt: new Date().toISOString()
    };
    const existing = store.findAttestation(record.id);
    if (existing) {
      return { attestation: existing, duplicate: true };
    }
    store.addAttestation(record);

    // Feed the scoring engine: Tier-2 evidence on the subject's evidence set.
    const evidence = store.evidenceFor(subject.id);
    store.evidence.set(subject.id, [...evidence, attestationEvidence(record)]);

    // Re-score immediately. Appending evidence without re-running the pipeline
    // meant a Tier-2 attestation had NO observable effect: `predictCredential`
    // would compute a different score, but every stored score, the stored
    // credential and the public verify page all kept the pre-attestation values
    // — so the whole Expert tier was unreachable in practice. The background
    // job re-runs the full pipeline, which also re-mints via `update_credential`
    // so the on-chain record follows.
    const rescored = predictCredential(
      record.skill as SkillId,
      store.reposFor(subject.id),
      store.evidenceFor(subject.id),
      { accountType: subject.accountType ?? 'User' }
    );
    const reanalysis = store.createJob({
      developerId: subject.id,
      githubUsername: subject.githubHandle,
      skillId: record.skill as SkillId,
      llmEnabled: false,
      mintWallet: rescored.issued ? (subject.linkedWallets[0]?.wallet ?? null) : null
    });
    void queueAnalysisJob(store, reanalysis).catch((err: unknown) => {
      // Never let the attestation request fail because a re-analysis could not
      // be queued; the attestation itself is already durable.
      app.log.warn(`post-attestation re-analysis not queued: ${String(err)}`);
    });

    audit(req, {
      type: 'attest.attempt',
      outcome: 'success',
      actor: session.wallet,
      role: session.role,
      method: req.method,
      route: '/api/attest',
      meta: { handle, repo, skill, attester: attesterLogin }
    });
    return { attestation: record, duplicate: false };
  });

  /** Public, independently verifiable attestation list for a developer. */
  app.get('/api/attestations/:handle', async (req, reply) => {
    const handle = (req.params as { handle?: string }).handle ?? '';
    const subject = store.findDeveloper(handle);
    if (!subject) return reply.code(404).send({ error: 'developer_not_found' });
    return {
      developer: subject.githubHandle,
      attestations: store.attestationsFor(subject.id).map((a) => ({
        id: a.id,
        subjectHandle: a.subjectHandle,
        attesterLogin: a.attesterLogin,
        attesterWallet: a.attesterWallet,
        repo: a.repo,
        skill: a.skill,
        statement: a.statement,
        signedMessage: a.signedMessage,
        signature: a.signature,
        nonce: a.nonce,
        issuedAt: a.issuedAt,
        createdAt: a.createdAt
      }))
    };
  });

  // ----------------------------------------------------------------- invite
  app.post('/api/invite', { preHandler: adminLimited }, async (req, reply) => {
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
  app.post('/api/listings/:id/verified-link', { preHandler: adminLimited }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const listing = store.listings.find((l) => l.id === id);
    if (!listing) return reply.code(404).send({ error: 'listing_not_found' });
    const token = crypto.randomUUID().slice(0, 12);
    listing.inviteUrl = `https://proofmesh.xyz/get-verified?ref=${token}&listing=${listing.id}`;
    return { listing };
  });

  // ------------------------------------------------------------- CLI/demo
  app.post('/api/reset', { preHandler: adminLimited }, async (req) => {
    audit(req, {
      type: 'admin.action',
      outcome: 'success',
      actor: (req as RequestWithAuth).auth?.wallet,
      role: (req as RequestWithAuth).auth?.role,
      method: req.method,
      route: '/api/reset'
    });
    store.reset();
    await hydrateSeededRuns(store);
    return { ok: true };
  });
}


function renderFallbackBadge(label: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="96" viewBox="0 0 320 96">
  <rect width="320" height="96" rx="14" fill="#FFFFFF" stroke="#E8E6DF" stroke-width="1.5"/>
  <text x="160" y="52" text-anchor="middle" font-family="monospace" font-size="12" fill="#7A827E">${label}</text>
</svg>`;
}