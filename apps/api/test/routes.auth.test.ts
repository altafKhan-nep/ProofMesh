import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import { Keypair } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { Store } from '../src/store.js';
import { registerRoutes } from '../src/routes.js';
import { signedAdminFetch } from './helpers.js';

const adminKp = Keypair.generate();
const adminWallet = adminKp.publicKey.toBase58();

type Bound = { port: number; close: () => Promise<void> };

async function makeServer(adminWallets: Set<string>): Promise<Bound> {
  const store = new Store();
  const app = Fastify();
  await app.register(cors, { origin: true, allowedHeaders: ['content-type', 'authorization'] });
  await registerRoutes(app, { store, adminWallets });
  await app.listen({ port: 0 });
  const bound = app.server.address() as { port: number };
  return { port: bound.port, close: () => app.close().then(() => void 0) };
}

function baseUrl(b: Bound): string {
  return `http://127.0.0.1:${b.port}`;
}

async function signIn(url: string, kp: Keypair): Promise<{ token: string; wallet: string }> {
  const wallet = kp.publicKey.toBase58();
  const challengeRes = await fetch(`${url}/api/auth/challenge`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet })
  });
  const challenge = await challengeRes.json();
  const sig = ed25519.sign(new TextEncoder().encode(challenge.message), kp.secretKey.slice(0, 32));
  const verifyRes = await fetch(`${url}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet, message: challenge.message, signature: Buffer.from(sig).toString('base64') })
  });
  expect(verifyRes.status).toBe(200);
  return verifyRes.json();
}

describe('auth + gated routes', () => {
  it('challenge nonce is single-use (replay rejected)', async () => {
    const server = await makeServer(new Set());
    const url = baseUrl(server);
    try {
      const kp = Keypair.generate();
      const wallet = kp.publicKey.toBase58();
      const chRes = await fetch(`${url}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet })
      });
      const ch = await chRes.json();
      expect(chRes.status).toBe(200);
      const sig = ed25519.sign(new TextEncoder().encode(ch.message), kp.secretKey.slice(0, 32));
      const sigB64 = Buffer.from(sig).toString('base64');
      const body = JSON.stringify({ wallet, message: ch.message, signature: sigB64 });

      const first = await fetch(`${url}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      expect(first.status).toBe(200);
      const second = await fetch(`${url}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      expect(second.status).toBe(401);
      expect((await second.json()).error).toBe('challenge_not_found');
    } finally {
      await server.close();
    }
  });

  it('challenge is rejected for an invalid wallet address (400)', async () => {
    const server = await makeServer(new Set());
    const url = baseUrl(server);
    try {
      const res = await fetch(`${url}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet: 'not-a-base58-key' })
      });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe('invalid_wallet');
    } finally {
      await server.close();
    }
  });

  it('full round trip: sign-in → me → logout invalidates token', async () => {
    const server = await makeServer(new Set());
    const url = baseUrl(server);
    try {
      const userKp = Keypair.generate();
      const wallet = userKp.publicKey.toBase58();
      const { token } = await signIn(url, userKp);
      expect(token.length).toBe(43);

      const me = await fetch(`${url}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } });
      expect(me.status).toBe(200);
      expect(await me.json()).toMatchObject({ wallet, role: 'user' });

      const logout = await fetch(`${url}/api/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
      expect(logout.status).toBe(200);

      const meAfter = await fetch(`${url}/api/auth/me`, { headers: { authorization: `Bearer ${token}` } });
      expect(meAfter.status).toBe(401);
    } finally {
      await server.close();
    }
  });

  it('analyze requires a session (401 without bearer)', async () => {
    const server = await makeServer(new Set());
    const url = baseUrl(server);
    try {
      const anon = await fetch(`${url}/api/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ghUser: 'example' })
      });
      expect(anon.status).toBe(401);

      const { token } = await signIn(url, Keypair.generate());
      const authed = await fetch(`${url}/api/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ ghUser: 'example' })
      });
      expect(authed.status).not.toBe(401);
    } finally {
      await server.close();
    }
  });

  it('admin routes: user gets 403, admin wallet succeeds with role admin', async () => {
    const server = await makeServer(new Set([adminWallet]));
    const url = baseUrl(server);
    try {
      const { token: userToken } = await signIn(url, Keypair.generate());

      const userReset = await fetch(`${url}/api/reset`, { method: 'POST', headers: { authorization: `Bearer ${userToken}` } });
      expect(userReset.status).toBe(403);

      const { token: adminToken } = await signIn(url, adminKp);
      const me = await fetch(`${url}/api/auth/me`, { headers: { authorization: `Bearer ${adminToken}` } });
      expect(await me.json()).toMatchObject({ wallet: adminWallet, role: 'admin' });

      const adminReset = await signedAdminFetch(url, adminToken, adminKp, 'POST', '/api/reset');
      expect(adminReset.status).toBe(200);
      expect(await adminReset.json()).toMatchObject({ ok: true });
    } finally {
      await server.close();
    }
  });

  it('verify rejects a signature made by the wrong wallet', async () => {
    const server = await makeServer(new Set());
    const url = baseUrl(server);
    try {
      const target = Keypair.generate();
      const attacker = Keypair.generate();
      const chRes = await fetch(`${url}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ wallet: target.publicKey.toBase58() })
      });
      const ch = await chRes.json();
      const sig = ed25519.sign(new TextEncoder().encode(ch.message), attacker.secretKey.slice(0, 32));
      const verify = await fetch(`${url}/api/auth/verify`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          wallet: target.publicKey.toBase58(),
          message: ch.message,
          signature: Buffer.from(sig).toString('base64')
        })
      });
      expect(verify.status).toBe(401);
      expect((await verify.json()).error).toBe('invalid_signature');
    } finally {
      await server.close();
    }
  });
});