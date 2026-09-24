import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Keypair } from '@solana/web3.js';
import { Store } from '../src/store.js';
import { registerRoutes } from '../src/routes.js';
import { FileSessionStore, InMemorySessionStore, sessionKey } from '../src/session-store.js';
import { newPendingOAuth, isPendingLive, stateMatches, stateHash } from '../src/github-oauth.js';
import { sign } from './helpers.js';

const USER = Keypair.generate();
const USER_WALLET = USER.publicKey.toBase58();

type Ctx = { url: string; store: Store; close: () => Promise<void> };

/** A fake GitHub OAuth + API, so the whole flow runs without github.com. */
function mockGitHub(login: string, id = 4242) {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('access_token')) {
      return new Response(JSON.stringify({ access_token: 'gho_mocktoken' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url.includes('/user')) {
      const auth = new Headers(init?.headers).get('authorization');
      if (auth !== 'Bearer gho_mocktoken') return new Response('{}', { status: 401 });
      return new Response(JSON.stringify({ login, id, avatar_url: null }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return new Response('{}', { status: 404 });
  };
  return { fetchImpl, calls };
}

async function server(
  github?: { login: string; id?: number },
  sessionStore?: ConstructorParameters<typeof Store>[0] extends { sessionStore?: infer S } ? S : never
): Promise<Ctx> {
  const store = new Store(sessionStore ? { sessionStore } : {});
  const app = Fastify();
  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie);
  const mock = github ? mockGitHub(github.login, github.id) : undefined;
  await registerRoutes(app, {
    store,
    adminWallets: new Set(),
    rateLimits: {},
    ...(github
      ? {
          githubOAuth: {
            clientId: 'client-123',
            clientSecret: 'secret-456',
            redirectUri: 'http://localhost:4000/api/auth/github/callback',
            endpoints: { authorize: 'https://github.test/authorize', token: 'https://github.test/access_token', user: 'https://api.github.test/user' },
            fetchImpl: mock!.fetchImpl
          }
        }
      : {})
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

async function bindChallenge(ctx: Ctx, token: string, handle: string, kp = USER) {
  const ch = await (
    await fetch(`${ctx.url}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ wallet: kp.publicKey.toBase58(), purpose: 'bind', subject: handle })
    })
  ).json();
  return {
    githubUsername: handle,
    wallet: kp.publicKey.toBase58(),
    message: ch.message,
    signature: sign(kp, ch.message)
  };
}

describe('A — session store', () => {
  it('never stores the raw token; indexes by sha256', async () => {
    const store = new InMemorySessionStore();
    const token = 'super-secret-token-value';
    const session = {
      token,
      csrfToken: 'csrf',
      wallet: 'W',
      role: 'user' as const,
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    };
    await store.create(session);
    const keys = [...(store as unknown as { sessions: Map<string, unknown> }).sessions.keys()];
    expect(keys).toHaveLength(1);
    expect(keys[0]).toBe(sessionKey(token));
    expect(keys[0]).not.toBe(token);
    // The lookup still works by hashing the presented token.
    expect(await store.get(token)).toMatchObject({ wallet: 'W' });
  });

  it('rejects an expired session and sweeps it', async () => {
    const store = new InMemorySessionStore();
    await store.create({
      token: 't',
      wallet: 'W',
      role: 'user',
      issuedAt: new Date(Date.now() - 120_000).toISOString(),
      expiresAt: new Date(Date.now() - 1_000).toISOString()
    });
    expect(await store.get('t')).toBeUndefined();
  });

  it('enforces the idle window', async () => {
    const store = new InMemorySessionStore();
    const now = Date.now();
    await store.create({
      token: 't',
      wallet: 'W',
      role: 'user',
      issuedAt: new Date(now - 3 * 60 * 60_000).toISOString(),
      lastSeenAt: new Date(now - 3 * 60 * 60_000).toISOString(),
      expiresAt: new Date(now + 60 * 60_000).toISOString()
    });
    expect(await store.get('t')).toBeUndefined(); // idle > 2h
  });

  it('revokes every session for a wallet', async () => {
    const store = new InMemorySessionStore();
    for (const t of ['a', 'b', 'c']) {
      await store.create({
        token: t,
        wallet: t === 'c' ? 'OTHER' : 'W',
        role: 'user',
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      });
    }
    expect(await store.revokeAllForWallet('W')).toBe(2);
    expect(await store.get('a')).toBeUndefined();
    expect(await store.get('c')).toBeDefined();
  });

  it('FileSessionStore persists across instances without storing tokens', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pm-sess-')), 'sessions.json');
    const token = 'persist-me-please';
    const first = new FileSessionStore(file);
    await first.create({
      token,
      csrfToken: 'csrf',
      wallet: 'W',
      role: 'user',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString()
    });
    // The file must not contain a usable credential.
    const raw = fs.readFileSync(file, 'utf8');
    expect(raw).not.toContain(token);
    expect(raw).toContain(sessionKey(token));

    // A fresh instance resolves the session by hashing the presented token.
    const second = new FileSessionStore(file);
    const restored = await second.get(token);
    expect(restored).toMatchObject({ wallet: 'W' });
    expect(restored?.token).toBe(''); // no token material at rest
    fs.rmSync(path.dirname(file), { recursive: true, force: true });
  });
});

describe('B — GitHub OAuth proof', () => {
  let ctx: Ctx;
  let token: string;

  beforeAll(async () => {
    ctx = await server({ login: 'alexander-vance' });
    token = await signIn(ctx, USER);
  });
  afterAll(async () => {
    await ctx.close();
  });

  const auth = () => ({ authorization: `Bearer ${token}` });

  it('reports not-configured when no OAuth app is set', async () => {
    const bare = await server();
    try {
      const t = await signIn(bare, Keypair.generate());
      const res = await fetch(`${bare.url}/api/auth/github/start`, { headers: { authorization: `Bearer ${t}` } });
      expect(await res.json()).toMatchObject({ configured: false });
    } finally {
      await bare.close();
    }
  });

  it('issues an authorize URL with no scopes and a state', async () => {
    const res = await fetch(`${ctx.url}/api/auth/github/start`, { headers: auth() });
    const body = await res.json();
    expect(body.configured).toBe(true);
    const url = new URL(body.authorizeUrl);
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('state')).toBeTruthy();
    // Minimal privilege: no scope parameter at all.
    expect(url.searchParams.has('scope')).toBe(false);
  });

  it('rejects a callback with an unknown or replayed state', async () => {
    const start = await (await fetch(`${ctx.url}/api/auth/github/start`, { headers: auth() })).json();
    const state = new URL(start.authorizeUrl).searchParams.get('state')!;

    const first = await fetch(`${ctx.url}/api/auth/github/callback?code=abc&state=${encodeURIComponent(state)}`, {
      headers: auth()
    });
    expect(first.status).toBe(200);

    // Replay of the same state must fail.
    const replay = await fetch(`${ctx.url}/api/auth/github/callback?code=abc&state=${encodeURIComponent(state)}`, {
      headers: auth()
    });
    expect(replay.status).toBe(401);
    expect((await replay.json()).error).toBe('github_oauth_state_invalid');
  });

  it('rejects a state issued to a different wallet', async () => {
    const other = Keypair.generate();
    const otherToken = await signIn(ctx, other);
    const start = await (await fetch(`${ctx.url}/api/auth/github/start`, { headers: auth() })).json();
    const state = new URL(start.authorizeUrl).searchParams.get('state')!;
    const res = await fetch(`${ctx.url}/api/auth/github/callback?code=abc&state=${encodeURIComponent(state)}`, {
      headers: { authorization: `Bearer ${otherToken}` }
    });
    expect(res.status).toBe(401);
  });

  it('rejects missing code/state and provider errors', async () => {
    expect((await fetch(`${ctx.url}/api/auth/github/callback`, { headers: auth() })).status).toBe(401);
    const denied = await fetch(`${ctx.url}/api/auth/github/callback?error=access_denied&state=x`, { headers: auth() });
    expect(denied.status).toBe(401);
    expect((await denied.json()).error).toBe('github_oauth_denied');
  });

  it('proves the GitHub identity onto the session', async () => {
    const start = await (await fetch(`${ctx.url}/api/auth/github/start`, { headers: auth() })).json();
    const state = new URL(start.authorizeUrl).searchParams.get('state')!;
    const res = await fetch(`${ctx.url}/api/auth/github/callback?code=good-code&state=${encodeURIComponent(state)}`, {
      headers: auth()
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ proven: true, login: 'alexander-vance' });

    const status = await (await fetch(`${ctx.url}/api/auth/github/status`, { headers: auth() })).json();
    expect(status).toMatchObject({ proven: true, login: 'alexander-vance' });
  });

  it('only now allows a bind, and marks both legs proven', async () => {
    const body = await bindChallenge(ctx, token, 'alexander-vance');
    const res = await fetch(`${ctx.url}/api/bind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth() },
      body: JSON.stringify(body)
    });
    // alexander-vance is seeded, so no live ingestion is needed.
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.binding.verified).toEqual({ wallet: true, github: 'proven' });
  });

  it('refuses to bind a handle the session is not authorized as', async () => {
    const body = await bindChallenge(ctx, token, 'sindresorhus');
    const res = await fetch(`${ctx.url}/api/bind`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth() },
      body: JSON.stringify(body)
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('github_identity_mismatch');
  });
});

describe('oauth primitives', () => {
  it('state is hashed, single-valued and expiring', () => {
    const pending = newPendingOAuth('W', null);
    expect(pending.stateHash).toBe(stateHash(pending.state));
    expect(pending.stateHash).not.toBe(pending.state);
    expect(stateMatches(pending, pending.state)).toBe(true);
    expect(stateMatches(pending, 'other')).toBe(false);
    expect(isPendingLive(pending)).toBe(true);
    expect(isPendingLive({ ...pending, expiresAt: new Date(0).toISOString() })).toBe(false);
  });
});
