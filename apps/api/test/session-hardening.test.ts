import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { Keypair } from '@solana/web3.js';
import { Store } from '../src/store.js';
import { registerRoutes } from '../src/routes.js';
import { sign, signedAdminFetch } from './helpers.js';

const ADMIN = Keypair.generate();
const USER = Keypair.generate();

const ADMIN_WALLET = ADMIN.publicKey.toBase58();
const USER_WALLET = USER.publicKey.toBase58();

type Ctx = { url: string; store: Store; close: () => Promise<void> };

async function server(): Promise<Ctx> {
  const store = new Store();
  const app = Fastify();
  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie);
  // rate limits are exercised in audit-rate-limit.test.ts; keep this suite focused
  await registerRoutes(app, { store, adminWallets: new Set([ADMIN_WALLET]), rateLimits: {} });
  await app.listen({ port: 0 });
  const port = (app.server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, store, close: () => app.close().then(() => void 0) };
}

interface Browser {
  cookieHeader: string;
  csrf: string;
}

async function signIn(ctx: Ctx, kp: Keypair): Promise<{ token: string; browser: Browser }> {
  const wallet = kp.publicKey.toBase58();
  const chRes = await fetch(`${ctx.url}/api/auth/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet })
  });
  const ch = await chRes.json();
  const res = await fetch(`${ctx.url}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, message: ch.message, signature: sign(kp, ch.message) })
  });
  const json = await res.json();
  const setCookies = res.headers.getSetCookie?.() ?? [];
  const pick = (name: string) => {
    const raw = setCookies.find((c) => c.startsWith(`${name}=`));
    return raw ? raw.split(';')[0]! : ''; // keep "name=value"
  };
  return {
    token: json.token,
    browser: { cookieHeader: `${pick('pm_session')}; ${pick('pm_csrf')}`, csrf: decodeURIComponent(pick('pm_csrf').split('=').slice(1).join('=')) }
  };
}

describe('P1 — session cookies', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await server();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('sets an httpOnly session cookie and a readable CSRF cookie', async () => {
    const kp = Keypair.generate();
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
    const cookies = res.headers.getSetCookie();
    const session = cookies.find((c) => c.startsWith('pm_session='))!;
    const csrf = cookies.find((c) => c.startsWith('pm_csrf='))!;
    // The whole point of P1: the credential is unreachable from JavaScript.
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(csrf).not.toMatch(/HttpOnly/i);
  });

  it('authenticates a read from the cookie alone', async () => {
    const { browser } = await signIn(ctx, USER);
    const res = await fetch(`${ctx.url}/api/auth/me`, { headers: { cookie: browser.cookieHeader } });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ wallet: USER_WALLET, role: 'user' });
  });

  it('rejects a cookie-authenticated write with no CSRF header (CSRF blocked)', async () => {
    const { browser } = await signIn(ctx, USER);
    const res = await fetch(`${ctx.url}/api/analyze`, {
      method: 'POST',
      headers: { cookie: browser.cookieHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ githubHandle: 'alexander-vance', skillId: 'solana-anchor' })
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('csrf_failed');
  });

  it('rejects a forged CSRF header', async () => {
    const { browser } = await signIn(ctx, USER);
    const res = await fetch(`${ctx.url}/api/analyze`, {
      method: 'POST',
      headers: {
        cookie: browser.cookieHeader,
        'content-type': 'application/json',
        'x-pm-csrf': 'attacker-guess'
      },
      body: JSON.stringify({ githubHandle: 'alexander-vance', skillId: 'solana-anchor' })
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('csrf_failed');
  });

  it('accepts the write with the matching CSRF header', async () => {
    const { browser } = await signIn(ctx, USER);
    const res = await fetch(`${ctx.url}/api/analyze`, {
      method: 'POST',
      headers: {
        cookie: browser.cookieHeader,
        'content-type': 'application/json',
        'x-pm-csrf': browser.csrf
      },
      body: JSON.stringify({ githubHandle: 'alexander-vance', skillId: 'solana-anchor' })
    });
    expect(res.status).toBe(200);
  });

  it('keeps bearer auth working for API clients (no CSRF needed)', async () => {
    const { token } = await signIn(ctx, USER);
    const res = await fetch(`${ctx.url}/api/analyze`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ githubHandle: 'alexander-vance', skillId: 'solana-anchor' })
    });
    expect(res.status).toBe(200);
  });
});

describe('P2 — per-request wallet proof for admin actions', () => {
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await server();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('refuses an admin action with only a session (stolen-cookie scenario)', async () => {
    const { token } = await signIn(ctx, ADMIN);
    const res = await fetch(`${ctx.url}/api/invite`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ listingId: 'l', githubHandle: 'someone' })
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('action_proof_required');
  });

  it('accepts a correctly signed admin action', async () => {
    const { token } = await signIn(ctx, ADMIN);
    const listing = (await (await fetch(`${ctx.url}/api/listings`)).json())[0];
    const res = await signedAdminFetch(ctx.url, token, ADMIN, 'POST', '/api/invite', {
      listingId: listing.id,
      githubHandle: 'octocat'
    });
    expect(res.status).toBe(200);
  });

  it('will not reuse a proof on a different action (replay across endpoints)', async () => {
    const { token } = await signIn(ctx, ADMIN);
    const ch = await (
      await fetch(`${ctx.url}/api/auth/action-challenge`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'POST', path: '/api/invite', action: { listingId: 'l' } })
      })
    ).json();
    const signature = sign(ADMIN, ch.message);
    // Same nonce, different endpoint.
    const res = await fetch(`${ctx.url}/api/reset`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-pm-action-nonce': ch.nonce,
        'x-pm-action-signature': signature
      },
      body: JSON.stringify({})
    });
    expect(res.status).toBe(401);
    expect(['action_path_mismatch', 'action_body_mismatch', 'action_challenge_not_found']).toContain(
      (await res.json()).error
    );
  });

  it('binds the proof to the exact body (tampered payload rejected)', async () => {
    const { token } = await signIn(ctx, ADMIN);
    const body = { listingId: 'l', githubHandle: 'someone' };
    const ch = await (
      await fetch(`${ctx.url}/api/auth/action-challenge`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'POST', path: '/api/invite', action: body })
      })
    ).json();
    const res = await fetch(`${ctx.url}/api/invite`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-pm-action-nonce': ch.nonce,
        'x-pm-action-signature': sign(ADMIN, ch.message)
      },
      body: JSON.stringify({ ...body, githubHandle: 'attacker' })
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('action_body_mismatch');
  });

  it('rejects a proof signed by a different wallet', async () => {
    const { token } = await signIn(ctx, ADMIN);
    const body = { listingId: 'l', githubHandle: 'someone' };
    const ch = await (
      await fetch(`${ctx.url}/api/auth/action-challenge`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'POST', path: '/api/invite', action: body })
      })
    ).json();
    const res = await fetch(`${ctx.url}/api/invite`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-pm-action-nonce': ch.nonce,
        'x-pm-action-signature': sign(USER, ch.message) // wrong signer
      },
      body: JSON.stringify(body)
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('invalid_signature');
  });

  it('admin proofs do not help a non-admin session', async () => {
    const { token } = await signIn(ctx, USER);
    const body = { listingId: 'l', githubHandle: 'someone' };
    const ch = await (
      await fetch(`${ctx.url}/api/auth/action-challenge`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ method: 'POST', path: '/api/invite', action: body })
      })
    ).json();
    const res = await fetch(`${ctx.url}/api/invite`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'x-pm-action-nonce': ch.nonce,
        'x-pm-action-signature': sign(USER, ch.message)
      },
      body: JSON.stringify(body)
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('admin_required');
  });
});
