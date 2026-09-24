import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Keypair } from '@solana/web3.js';
import { Store } from '../src/store.js';
import { registerRoutes } from '../src/routes.js';
import { sign, signedAdminFetch } from './helpers.js';

const ADMIN = Keypair.generate();
const USER = Keypair.generate();
const OTHER = Keypair.generate();

type Ctx = { url: string; store: Store; close: () => Promise<void> };

async function server(): Promise<Ctx> {
  const store = new Store();
  const app = Fastify();
  await app.register(cors, { origin: true, allowedHeaders: ['content-type', 'authorization'] });
  // rate limits are exercised in audit-rate-limit.test.ts; keep these suites focused
  await registerRoutes(app, { store, adminWallets: new Set([ADMIN.publicKey.toBase58()]), rateLimits: {} });
  await app.listen({ port: 0 });
  const port = (app.server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, store, close: () => app.close().then(() => void 0) };
}

/** Full SIWS sign-in; returns the bearer token. */
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
  expect(res.status).toBe(200);
  return (await res.json()).token as string;
}

const auth = (token?: string) => (token ? { authorization: `Bearer ${token}` } : {});

describe('role matrix: anonymous / user / admin', () => {
  let ctx: Ctx;
  let userToken: string;
  let adminToken: string;

  beforeAll(async () => {
    ctx = await server();
    userToken = await signIn(ctx, USER);
    adminToken = await signIn(ctx, ADMIN);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('assigns roles from ADMIN_WALLETS', async () => {
    const me = async (t: string) => (await fetch(`${ctx.url}/api/auth/me`, { headers: auth(t) })).json();
    expect(await me(adminToken)).toMatchObject({ role: 'admin' });
    expect(await me(userToken)).toMatchObject({ role: 'user' });
  });

  const cases: Array<{ name: string; run: (t?: string) => Promise<Response> }> = [
    {
      name: 'POST /api/analyze',
      run: (t) =>
        fetch(`${ctx.url}/api/analyze`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...auth(t) },
          body: JSON.stringify({ githubHandle: 'alexander-vance', skillId: 'solana-anchor' })
        })
    },
    {
      name: 'POST /api/invite',
      run: (t) =>
        t
          ? signedAdminFetch(ctx.url, t, ADMIN, 'POST', '/api/invite', { listingId: 'x', githubHandle: 'someone' })
          : fetch(`${ctx.url}/api/invite`, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ listingId: 'x', githubHandle: 'someone' })
            })
    },
    {
      name: 'DELETE /api/listings/:id',
      run: (t) =>
        t
          ? signedAdminFetch(ctx.url, t, ADMIN, 'DELETE', '/api/listings/does-not-matter')
          : fetch(`${ctx.url}/api/listings/does-not-matter`, { method: 'DELETE' })
    }
  ];

  for (const c of cases) {
    const adminOnly = c.name !== 'POST /api/analyze';
    it(`${c.name}: anonymous -> 401, user -> ${adminOnly ? '403' : '2xx'}, admin -> 2xx`, async () => {
      expect((await c.run()).status).toBe(401);

      const asUser = await c.run(userToken);
      expect(asUser.status).not.toBe(401);
      if (adminOnly) {
        // A valid session is not enough: role is enforced.
        expect(asUser.status).toBe(403);
      } else {
        expect([200, 202]).toContain(asUser.status);
      }

      const asAdmin = await c.run(adminToken);
      // Admin clears the gate; a 404 for the fake id is fine — what matters is
      // that it is not 401/403 (i.e. the role check passed).
      expect([401, 403]).not.toContain(asAdmin.status);
    });
  }

  it('admin may reset; user may not (reset invalidates every session by design)', async () => {
    // Fresh tokens: the admin reset below intentionally wipes the session store.
    const freshUser = await signIn(ctx, USER);
    const freshAdmin = await signIn(ctx, ADMIN);
    const asUser = await fetch(`${ctx.url}/api/reset`, { method: 'POST', headers: auth(freshUser) });
    expect(asUser.status).toBe(403);
    const asAdmin = await signedAdminFetch(ctx.url, freshAdmin, ADMIN, 'POST', '/api/reset');
    expect(asAdmin.status).toBe(200);
    expect((await fetch(`${ctx.url}/api/auth/me`, { headers: auth(freshAdmin) })).status).toBe(401);
  });

  it('a revoked token stops working immediately', async () => {
    const throwaway = await signIn(ctx, OTHER);
    expect((await fetch(`${ctx.url}/api/auth/me`, { headers: auth(throwaway) })).status).toBe(200);
    await fetch(`${ctx.url}/api/auth/logout`, { method: 'POST', headers: auth(throwaway) });
    expect((await fetch(`${ctx.url}/api/auth/me`, { headers: auth(throwaway) })).status).toBe(401);
  });

  it('a user token cannot be escalated by tampering', async () => {
    const forged = `${userToken}x`;
    expect((await fetch(`${ctx.url}/api/auth/me`, { headers: auth(forged) })).status).toBe(401);
    expect((await fetch(`${ctx.url}/api/reset`, { method: 'POST', headers: auth(forged) })).status).toBe(401);
  });
});

describe('identity binding requires proof of ownership', () => {
  let ctx: Ctx;
  let userToken: string;

  beforeAll(async () => {
    ctx = await server();
    userToken = await signIn(ctx, USER);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('refuses a bare handle+wallet pair (the takeover attempt)', async () => {
    const res = await fetch(`${ctx.url}/api/bind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth(userToken) },
      body: JSON.stringify({ githubUsername: 'sindresorhus', wallet: USER.publicKey.toBase58() })
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('proof_required');
  });

  it('refuses to bind a wallet the session does not own', async () => {
    const wallet = OTHER.publicKey.toBase58();
    const res = await fetch(`${ctx.url}/api/bind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth(userToken) },
      body: JSON.stringify({ githubUsername: 'sindresorhus', wallet, message: 'x', signature: 'y' })
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('wallet_mismatch');
  });

  it('rejects replaying a sign-in challenge as a bind proof (audience binding)', async () => {
    const wallet = USER.publicKey.toBase58();
    const signinCh = await (
      await fetch(`${ctx.url}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet })
      })
    ).json();
    const res = await fetch(`${ctx.url}/api/bind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth(userToken) },
      body: JSON.stringify({
        githubUsername: 'sindresorhus',
        wallet,
        message: signinCh.message,
        signature: sign(USER, signinCh.message)
      })
    });
    expect(res.status).toBe(401);
    expect(['challenge_audience_mismatch', 'challenge_not_found']).toContain((await res.json()).error);
  });

  it('rejects a bind challenge naming a different GitHub account', async () => {
    const wallet = USER.publicKey.toBase58();
    const ch = await (
      await fetch(`${ctx.url}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet, purpose: 'bind', subject: 'someone-else' })
      })
    ).json();
    const res = await fetch(`${ctx.url}/api/bind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth(userToken) },
      body: JSON.stringify({
        githubUsername: 'sindresorhus',
        wallet,
        message: ch.message,
        signature: sign(USER, ch.message)
      })
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('challenge_audience_mismatch');
  });

  it('accepts a correctly signed bind challenge and marks GitHub proof pending', async () => {
    const wallet = USER.publicKey.toBase58();
    const ch = await (
      await fetch(`${ctx.url}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet, purpose: 'bind', subject: 'sindresorhus' })
      })
    ).json();
    const res = await fetch(`${ctx.url}/api/bind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth(userToken) },
      body: JSON.stringify({
        githubUsername: 'sindresorhus',
        wallet,
        message: ch.message,
        signature: sign(USER, ch.message)
      })
    });
    // The handle is not seeded, so ingestion may 404/502 — but it must never be
    // rejected for lack of proof, and the proof itself must have passed.
    expect([200, 404, 429, 502]).toContain(res.status);
    if (res.status !== 200) expect(res.status).not.toBe(400);
  });

  it('bind challenge is single-use', async () => {
    const wallet = USER.publicKey.toBase58();
    const ch = await (
      await fetch(`${ctx.url}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet, purpose: 'bind', subject: 'sindresorhus' })
      })
    ).json();
    const body = JSON.stringify({
      githubUsername: 'sindresorhus',
      wallet,
      message: ch.message,
      signature: sign(USER, ch.message)
    });
    const first = await fetch(`${ctx.url}/api/bind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth(userToken) },
      body
    });
    await first.json();
    const second = await fetch(`${ctx.url}/api/bind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth(userToken) },
      body
    });
    expect(second.status).toBe(401);
    expect((await second.json()).error).toBe('challenge_not_found');
  });
});

describe('analyze cannot mint into an unproven wallet', () => {
  let ctx: Ctx;
  let userToken: string;

  beforeAll(async () => {
    ctx = await server();
    userToken = await signIn(ctx, USER);
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('rejects a mint target owned by neither the session nor a verified binding', async () => {
    const res = await fetch(`${ctx.url}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth(userToken) },
      body: JSON.stringify({
        githubHandle: 'alexander-vance',
        skillId: 'solana-anchor',
        wallet: OTHER.publicKey.toBase58()
      })
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('mint_target_not_proven');
  });

  it('allows the session wallet as the mint target', async () => {
    const res = await fetch(`${ctx.url}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth(userToken) },
      body: JSON.stringify({
        githubHandle: 'alexander-vance',
        skillId: 'solana-anchor',
        wallet: USER.publicKey.toBase58()
      })
    });
    expect(res.status).toBe(200);
  });
});
