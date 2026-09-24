import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { Keypair } from '@solana/web3.js';
import { Store } from '../src/store.js';
import { registerRoutes } from '../src/routes.js';
import { AuditLog, auditEvent } from '../src/audit.js';
import { RateLimiter, rateLimitsFromEnv, DEFAULT_RATE_LIMITS } from '../src/rate-limit.js';
import { sign, signedAdminFetch } from './helpers.js';

const ADMIN = Keypair.generate();
const ADMIN_WALLET = ADMIN.publicKey.toBase58();

type Ctx = { url: string; store: Store; close: () => Promise<void> };

async function server(
  opts: { rateLimits?: Record<string, { limit: number; windowMs: number }> } = {}
): Promise<Ctx> {
  const store = new Store();
  const app = Fastify();
  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie);
  await registerRoutes(app, {
    store,
    adminWallets: new Set([ADMIN_WALLET]),
    ...(opts.rateLimits ? { rateLimits: opts.rateLimits } : {})
  });
  await app.listen({ port: 0 });
  const port = (app.server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, store, close: () => app.close().then(() => void 0) };
}

async function signIn(ctx: Ctx, kp: Keypair): Promise<string> {
  const wallet = kp.publicKey.toBase58();
  const ch = await (
    await fetch(`${ctx.url}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet })
    })
  ).json();
  const res = await fetch(`${ctx.url}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, message: ch.message, signature: sign(kp, ch.message) })
  });
  return (await res.json()).token;
}

describe('P3 — audit log', () => {
  it('redacts secret-shaped meta fields', () => {
    const event = auditEvent({
      type: 'auth.signin',
      outcome: 'success',
      actor: 'wallet',
      meta: { token: 'super-secret', csrfToken: 'nope', signature: 'sig', wallet: 'ok', nested: 'kept' }
    });
    expect(event.meta).toEqual({ wallet: 'ok', nested: 'kept' });
    expect(JSON.stringify(event)).not.toMatch(/super-secret|csrfToken|signature|"nope"/);
  });

  it('is bounded and newest-first', () => {
    const log = new AuditLog(3);
    for (let i = 0; i < 5; i++) log.record({ type: 'auth.challenge', outcome: 'success', meta: { i } });
    expect(log.size).toBe(3);
    expect(log.list()[0]?.meta?.i).toBe(4);
  });

  it('filters by type and outcome', () => {
    const log = new AuditLog();
    log.record({ type: 'auth.signin', outcome: 'success' });
    log.record({ type: 'admin.action', outcome: 'denied' });
    expect(log.list({ type: 'admin.action' })).toHaveLength(1);
    expect(log.list({ outcome: 'denied' })).toHaveLength(1);
  });

  it('records sign-in, bind denial and admin denial with reasons', async () => {
    const ctx = await server();
    try {
      const token = await signIn(ctx, ADMIN);
      expect(ctx.store.audit.list({ type: 'auth.signin', outcome: 'success' })).not.toHaveLength(0);

      // bind without proof -> denied + reason
      await fetch(`${ctx.url}/api/bind`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ githubUsername: 'octocat', wallet: ADMIN_WALLET })
      });
      const bindDenials = ctx.store.audit.list({ type: 'bind.attempt', outcome: 'denied' });
      expect(bindDenials[0]?.reason).toBe('proof_required');

      // admin action without a proof -> denied + reason
      await fetch(`${ctx.url}/api/invite`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ listingId: 'x', githubHandle: 'y' })
      });
      const adminDenials = ctx.store.audit.list({ type: 'admin.action', outcome: 'denied' });
      expect(adminDenials[0]?.reason).toBe('action_proof_required');
    } finally {
      await ctx.close();
    }
  });

  it('never stores a session token in an audit event', async () => {
    const ctx = await server();
    try {
      const token = await signIn(ctx, ADMIN);
      const dump = JSON.stringify(ctx.store.audit.list());
      expect(dump).not.toContain(token);
    } finally {
      await ctx.close();
    }
  });

  it('exposes the trail to admins and hides it from users', async () => {
    const ctx = await server();
    try {
      const adminToken = await signIn(ctx, ADMIN);
      const userToken = await signIn(ctx, Keypair.generate());

      const asAdmin = await fetch(`${ctx.url}/api/admin/audit`, { headers: { authorization: `Bearer ${adminToken}` } });
      expect(asAdmin.status).toBe(200);
      const body = await asAdmin.json();
      expect(Array.isArray(body.events)).toBe(true);
      expect(body.capacity).toBe(1000);

      const asUser = await fetch(`${ctx.url}/api/admin/audit`, { headers: { authorization: `Bearer ${userToken}` } });
      expect(asUser.status).toBe(403);

      const anon = await fetch(`${ctx.url}/api/admin/audit`);
      expect(anon.status).toBe(401);
    } finally {
      await ctx.close();
    }
  });
});

describe('P4 — rate limiting', () => {
  it('allows up to the limit, then returns 429 with Retry-After', () => {
    const limiter = new RateLimiter({ 'POST /x': { limit: 3, windowMs: 1000 } });
    const rule = { limit: 3, windowMs: 1000 };
    expect(limiter.consume('k', rule).ok).toBe(true);
    expect(limiter.consume('k', rule).ok).toBe(true);
    expect(limiter.consume('k', rule).ok).toBe(true);
    const blocked = limiter.consume('k', rule);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('resets after the window and isolates keys', () => {
    let now = 0;
    const limiter = new RateLimiter({ 'POST /x': { limit: 1, windowMs: 1000 } }, () => now);
    const rule = { limit: 1, windowMs: 1000 };
    expect(limiter.consume('a', rule).ok).toBe(true);
    expect(limiter.consume('a', rule).ok).toBe(false);
    expect(limiter.consume('b', rule).ok).toBe(true); // different key unaffected
    now = 1001;
    expect(limiter.consume('a', rule).ok).toBe(true); // window rolled
  });

  it('sweeps expired buckets', () => {
    let now = 0;
    const limiter = new RateLimiter({ 'POST /x': { limit: 1, windowMs: 100 } }, () => now);
    limiter.consume('a', { limit: 1, windowMs: 100 });
    expect(limiter.size).toBe(1);
    now = 200;
    limiter.sweep();
    expect(limiter.size).toBe(0);
  });

  it('parses env overrides and the kill switch', () => {
    const rules = rateLimitsFromEnv({ RATE_LIMIT_ANALYZE: '5/30s', RATE_LIMIT_RESET: '2/1h' });
    expect(rules['POST /api/analyze']).toEqual({ limit: 5, windowMs: 30_000 });
    expect(rules['POST /api/reset']).toEqual({ limit: 2, windowMs: 3_600_000 });
    expect(rateLimitsFromEnv({ RATE_LIMIT_DISABLED: '1' })).toEqual({});
    // defaults exist for every sensitive route
    for (const r of ['POST /api/auth/challenge', 'POST /api/auth/verify', 'POST /api/bind', 'POST /api/analyze']) {
      expect(DEFAULT_RATE_LIMITS[r]).toBeDefined();
    }
  });

  it('enforces the limit on a live route and records it in the audit log', async () => {
    const ctx = await server({ rateLimits: { 'POST /api/auth/challenge': { limit: 2, windowMs: 60_000 } } });
    try {
      const post = () =>
        fetch(`${ctx.url}/api/auth/challenge`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ wallet: Keypair.generate().publicKey.toBase58() })
        });
      expect((await post()).status).toBe(200);
      expect((await post()).status).toBe(200);
      const blocked = await post();
      expect(blocked.status).toBe(429);
      expect(blocked.headers.get('retry-after')).toBeTruthy();
      expect((await blocked.json()).error).toBe('rate_limited');
      const events = ctx.store.audit.list({ type: 'rate_limited' });
      expect(events.length).toBeGreaterThan(0);
    } finally {
      await ctx.close();
    }
  });

  it('does not let one client starve another', async () => {
    const ctx = await server({ rateLimits: { 'POST /api/reset': { limit: 1, windowMs: 60_000 } } });
    try {
      const a = Keypair.generate();
      const b = Keypair.generate();
      const ta = await signIn(ctx, a);
      const tb = await signIn(ctx, b);
      const reset = (t: string) =>
        signedAdminFetch(ctx.url, t, a, 'POST', '/api/reset').then((r) => r.status);
      // a is not admin -> 403, but the limiter still counted it; b unaffected on its own key
      expect(await reset(ta)).toBe(403);
      expect(await reset(tb)).toBe(403);
    } finally {
      await ctx.close();
    }
  });
});
