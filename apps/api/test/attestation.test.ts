import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { Keypair } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { PublicKey } from '@solana/web3.js';
import { Store } from '../src/store.js';
import { registerRoutes } from '../src/routes.js';
import {
  attestationEvidence,
  buildAttestationStatement,
  isSelfAttestation,
  repoExists,
  repoOwnedBy,
  verifyAttestationOffline
} from '../src/attestation.js';
import { sign } from './helpers.js';
import { accountingFromEvidence } from '@proofmesh/scoring-engine';

/** The subject developer: owns repo `acme/widget`, linked wallet SUBJECT. */
const ATTESTER = Keypair.generate();

type Ctx = { url: string; store: Store; close: () => Promise<void> };

function verifySig(message: string, signatureB64: string, wallet: string): boolean {
  try {
    return ed25519.verify(
      Uint8Array.from(Buffer.from(signatureB64, 'base64')),
      new TextEncoder().encode(message),
      new PublicKey(wallet).toBytes()
    );
  } catch {
    return false;
  }
}

async function server(): Promise<Ctx> {
  const store = new Store();
  const app = Fastify();
  await app.register(cors, { origin: true, credentials: true });
  await app.register(cookie);
  await registerRoutes(app, { store, adminWallets: new Set(), rateLimits: {} });
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

async function attestChallenge(ctx: Ctx, token: string, kp: Keypair, handle: string, repo: string, skill: string) {
  const ch = await (
    await fetch(`${ctx.url}/api/auth/challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        wallet: kp.publicKey.toBase58(),
        purpose: 'attest',
        subject: handle,
        repo,
        skill
      })
    })
  ).json();
  return {
    githubUsername: handle,
    repo,
    skill,
    message: ch.message,
    signature: sign(kp, ch.message)
  };
}

describe('attestation primitives', () => {
  const repos = [
    { owner: 'acme', fullName: 'acme/widget' },
    { owner: 'other', fullName: 'other/thing' }
  ] as never;

  it('identifies the repository owner', () => {
    expect(repoOwnedBy(repos, 'acme/widget', 'acme')).toBe(true);
    expect(repoOwnedBy(repos, 'acme/widget', 'someone-else')).toBe(false);
    expect(repoExists(repos, 'other/thing')).toBe(true);
    expect(repoExists(repos, 'nope/none')).toBe(false);
  });

  it('flags self-attestation regardless of case', () => {
    expect(isSelfAttestation('Alice', 'alice')).toBe(true);
    expect(isSelfAttestation('alice', 'bob')).toBe(false);
  });

  it('states the claim explicitly', () => {
    expect(buildAttestationStatement({ subjectHandle: 'bob', repo: 'acme/widget', skill: 'typescript' })).toContain(
      'acme/widget'
    );
  });

  it('verifies offline from the record alone', async () => {
    const kp = Keypair.generate();
    const message = `proofmesh.xyz authorises\n\nNonce: abc123\nRepository: acme/widget\nGitHub account: bob`;
    const record = {
      signedMessage: message,
      signature: sign(kp, message),
      attesterWallet: kp.publicKey.toBase58(),
      nonce: 'abc123',
      repo: 'acme/widget',
      subjectHandle: 'bob'
    };
    expect(await verifyAttestationOffline(record, verifySig)).toEqual({ valid: true });

    // A record whose nonce is not in the message is rejected without a key check.
    expect(
      await verifyAttestationOffline({ ...record, nonce: 'other' }, verifySig)
    ).toMatchObject({ valid: false, reason: 'nonce_not_in_message' });
    // Tampered signature fails.
    expect(
      await verifyAttestationOffline({ ...record, signature: Buffer.alloc(64).toString('base64') }, verifySig)
    ).toMatchObject({ valid: false, reason: 'invalid_signature' });
  });

  it('carries the attester identity so repeats are not double-counted', () => {
    const kp = Keypair.generate();
    const wallet = kp.publicKey.toBase58();
    const base = {
      id: 'att-1',
      subjectHandle: 'bob',
      subjectDeveloperId: 'dev-bob',
      attesterLogin: 'acme',
      attesterWallet: wallet,
      repo: 'acme/widget',
      skill: 'typescript',
      statement: 's',
      signedMessage: 'm',
      signature: 'sig',
      nonce: 'n1',
      domain: 'proofmesh.xyz',
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 1000).toISOString(),
      createdAt: new Date().toISOString()
    };
    const one = accountingFromEvidence([attestationEvidence(base)]);
    const two = accountingFromEvidence([
      attestationEvidence(base),
      attestationEvidence({ ...base, id: 'att-2', nonce: 'n2' })
    ]);
    expect(one.maintainerAttestations).toBe(1);
    // Same attester twice must NOT add confidence.
    expect(two.maintainerAttestations).toBe(1);

    const otherKp = Keypair.generate();
    const three = accountingFromEvidence([
      attestationEvidence(base),
      attestationEvidence({ ...base, id: 'att-3', nonce: 'n3', attesterWallet: otherKp.publicKey.toBase58() })
    ]);
    expect(three.maintainerAttestations).toBe(2);
  });
});

describe('POST /api/attest — the rules', () => {
  let ctx: Ctx;

  beforeAll(async () => {
    ctx = await server();
  });
  afterAll(async () => {
    await ctx.close();
  });

  it('refuses without a signed-in session', async () => {
    const res = await fetch(`${ctx.url}/api/attest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ githubUsername: 'maria-chen', repo: 'acme/widget', skill: 'typescript' })
    });
    expect(res.status).toBe(401);
  });

  it('refuses when the attester has not proven GitHub', async () => {
    const token = await signIn(ctx, ATTESTER);
    const body = await attestChallenge(ctx, token, ATTESTER, 'maria-chen', 'acme/widget', 'typescript');
    const res = await fetch(`${ctx.url}/api/attest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('github_proof_required');
  });

  it('accepts a valid independent attestation and emits scoring evidence', async () => {
    // Seed a subject developer with a repo owned by the attester's GitHub login.
    const subject = ctx.store.findDeveloper('maria-chen')!;
    ctx.store.repos.set(subject.id, [
      {
        id: 'repo-1',
        developerId: subject.id,
        owner: 'acme',
        name: 'widget',
        fullName: 'acme/widget',
        defaultBranch: 'main',
        primaryLanguage: 'typescript',
        snapshotCommitSha: null,
        isFork: false,
        starsAtSnapshot: 10,
        snapshotAt: new Date().toISOString(),
        commitCount: 10,
        prCount: 1,
        testFileCount: 2,
        sourceFileCount: 10,
        ciGreen: true
      }
    ]);

    const token = await signIn(ctx, ATTESTER);
    // Simulate a completed OAuth by attaching the proven login to the session.
    const storeSessions = (ctx.store.sessionStore as unknown as { sessions: Map<string, { githubLogin?: string }> })
      .sessions;
    for (const s of storeSessions.values()) if (s.wallet === ATTESTER.publicKey.toBase58()) s.githubLogin = 'acme';

    const body = await attestChallenge(ctx, token, ATTESTER, 'maria-chen', 'acme/widget', 'typescript');
    const res = await fetch(`${ctx.url}/api/attest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.duplicate).toBe(false);
    expect(json.attestation).toMatchObject({ attesterLogin: 'acme', repo: 'acme/widget', skill: 'typescript' });

    // Evidence landed on the subject, and the engine counts one attester.
    const evidence = ctx.store.evidenceFor(subject.id);
    expect(evidence.some((e) => e.type === 'MAINTAINER_ATTESTATION')).toBe(true);
    expect(accountingFromEvidence(evidence).maintainerAttestations).toBe(1);

    // Public, verifiable listing.
    const list = await (await fetch(`${ctx.url}/api/attestations/maria-chen`)).json();
    expect(list.attestations).toHaveLength(1);
    expect(await verifyAttestationOffline(list.attestations[0], verifySig)).toEqual({ valid: true });
  });

  it('refuses self-attestation even from a repo owner', async () => {
    const token = await signIn(ctx, ATTESTER);
    const storeSessions = (ctx.store.sessionStore as unknown as { sessions: Map<string, { githubLogin?: string }> })
      .sessions;
    for (const s of storeSessions.values()) if (s.wallet === ATTESTER.publicKey.toBase58()) s.githubLogin = 'maria-chen';
    const body = await attestChallenge(ctx, token, ATTESTER, 'maria-chen', 'acme/widget', 'typescript');
    const res = await fetch(`${ctx.url}/api/attest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('self_attestation');
  });

  it('refuses a non-owner of the repository', async () => {
    const token = await signIn(ctx, ATTESTER);
    const storeSessions = (ctx.store.sessionStore as unknown as { sessions: Map<string, { githubLogin?: string }> })
      .sessions;
    for (const s of storeSessions.values()) if (s.wallet === ATTESTER.publicKey.toBase58()) s.githubLogin = 'not-acme';
    const body = await attestChallenge(ctx, token, ATTESTER, 'maria-chen', 'acme/widget', 'typescript');
    const res = await fetch(`${ctx.url}/api/attest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('not_repo_owner');
  });

  it('refuses replaying a signin challenge as an attestation (audience binding)', async () => {
    const token = await signIn(ctx, ATTESTER);
    const storeSessions = (ctx.store.sessionStore as unknown as { sessions: Map<string, { githubLogin?: string }> })
      .sessions;
    for (const s of storeSessions.values()) if (s.wallet === ATTESTER.publicKey.toBase58()) s.githubLogin = 'acme';
    const signinCh = await (
      await fetch(`${ctx.url}/api/auth/challenge`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ wallet: ATTESTER.publicKey.toBase58() })
      })
    ).json();
    const res = await fetch(`${ctx.url}/api/attest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        githubUsername: 'maria-chen',
        repo: 'acme/widget',
        skill: 'typescript',
        message: signinCh.message,
        signature: sign(ATTESTER, signinCh.message)
      })
    });
    expect(res.status).toBe(401);
    expect(['challenge_audience_mismatch', 'challenge_not_found']).toContain((await res.json()).error);
  });

  it('refuses a challenge issued for a different repo (liveness binding)', async () => {
    const token = await signIn(ctx, ATTESTER);
    const storeSessions = (ctx.store.sessionStore as unknown as { sessions: Map<string, { githubLogin?: string }> })
      .sessions;
    for (const s of storeSessions.values()) if (s.wallet === ATTESTER.publicKey.toBase58()) s.githubLogin = 'acme';
    const body = await attestChallenge(ctx, token, ATTESTER, 'maria-chen', 'acme/widget', 'typescript');
    // Swap in a challenge for a different repo, signed correctly.
    const other = await attestChallenge(ctx, token, ATTESTER, 'maria-chen', 'other/thing', 'typescript');
    const res = await fetch(`${ctx.url}/api/attest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...body, message: other.message, signature: other.signature })
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('challenge_claim_mismatch');
  });

  it('is idempotent for the same claim+nonce', async () => {
    const token = await signIn(ctx, ATTESTER);
    const storeSessions = (ctx.store.sessionStore as unknown as { sessions: Map<string, { githubLogin?: string }> })
      .sessions;
    for (const s of storeSessions.values()) if (s.wallet === ATTESTER.publicKey.toBase58()) s.githubLogin = 'acme';
    const body = await attestChallenge(ctx, token, ATTESTER, 'sam-carter', 'acme/widget', 'typescript');
    // The repo must exist for the subject.
    const subject = ctx.store.findDeveloper('sam-carter')!;
    ctx.store.repos.set(subject.id, ctx.store.reposFor(ctx.store.findDeveloper('maria-chen')!.id));
    const first = await (
      await fetch(`${ctx.url}/api/attest`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body)
      })
    ).json();
    expect(first.duplicate).toBe(false);
    // Replay of the same nonce is rejected outright (single-use), not double-counted.
    const second = await fetch(`${ctx.url}/api/attest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body)
    });
    expect(second.status).toBe(401);
  });
});
