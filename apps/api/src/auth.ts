/**
 * Epic 2 — SIWS wallet auth + role gating.
 *
 * Challenge/response sign-in: the server issues a time-boxed, single-use nonce
 * inside a SIWS-shaped message; the caller signs the EXACT message bytes with
 * their Solana keypair; we recover/verify the ed25519 signature against the
 * claimed wallet address. Success → opaque 256-bit bearer token bound to the
 * wallet + role (admin when the wallet is in ADMIN_WALLETS).
 *
 * No cookies; tokens travel in `Authorization: Bearer <token>` only (immunes to
 * CSRF under dev CORS `origin: true`). Sessions are held in-memory by Store —
 * the same swap-ready seam ARCHITECTURE.md documents for Postgres/Redis.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { PublicKey } from '@solana/web3.js';
import type { AuthRole, AuthSession, SiwsChallenge, SiwsVerifyRequest } from '@proofmesh/shared-types';

export const SIWS_DOMAIN = 'proofmesh.xyz';
export const SIWS_URI = 'https://proofmesh.xyz';
export const SIWS_CHAIN_ID = 'solana:101'; // devnet
export const SIWS_VERSION = '1';

export const CHALLENGE_TTL_MS = 5 * 60_000; // 5 minutes
export const SESSION_TTL_MS = 24 * 60 * 60_000; // 24 hours
export const MAX_CHALLENGES_PER_WALLET = 5;

/** Wallets allowed to perform admin console actions (env: comma-separated b58). */
export function adminWalletsFromEnv(env = process.env): Set<string> {
  const raw = env.ADMIN_WALLETS?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  return new Set(raw);
}

/** ed25519 signature, sent as base64 (server + browser both encode it natively). */
function decodeSignature(signatureB64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(signatureB64, 'base64'));
}

export function isValidPubkey(candidate: string): boolean {
  try {
    new PublicKey(candidate);
    return PublicKey.isOnCurve(candidate);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// SIWS message
// ---------------------------------------------------------------------------

export interface SiwsMessageParts {
  wallet: string;
  domain: string;
  statement: string;
  uri: string;
  chainId: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
  subject?: string;
}

export function buildSiwsMessage(parts: Omit<SiwsMessageParts, 'statement'> & { statement?: string }): string {
  const statement =
    parts.statement ??
    (parts.subject
      ? `Authorise this ProofMesh account to publish on-chain credentials for @${parts.subject}.`
      : 'Determine your role on ProofMesh and prove ownership of this wallet.');
  const lines = [
    `${parts.domain} wants you to sign in with your Solana account:`,
    ``,
    parts.wallet,
    ``,
    statement
  ];
  if (parts.subject) {
    lines.push(``, `GitHub account: ${parts.subject}`);
  }
  lines.push(
    ``,
    `URI: ${parts.uri}`,
    `Version: ${SIWS_VERSION}`,
    `Chain ID: ${parts.chainId}`,
    `Nonce: ${parts.nonce}`,
    `Issued At: ${parts.issuedAt}`,
    `Expiration Time: ${parts.expirationTime}`
  );
  return lines.join('\n');
}

const NONCE_RE = /^Nonce:\s*(.+)$/m;
const WALLET_RE = /^([1-9A-HJ-NP-Za-km-z]{32,44})$/m;
const ISSUED_AT_RE = /^Issued At:\s*(.+)$/m;

/** Loose parse of the fields the verifier actually checks. */
export function parseSiwsMessage(message: string): Partial<SiwsMessageParts> {
  return {
    nonce: NONCE_RE.exec(message)?.[1],
    wallet: WALLET_RE.exec(message)?.[1],
    issuedAt: ISSUED_AT_RE.exec(message)?.[1]
  };
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

export function verifySiwsSignature(
  message: string,
  signatureB64: string,
  claimedWallet: string
): boolean {
  if (!isValidPubkey(claimedWallet)) return false;
  try {
    const sig = decodeSignature(signatureB64);
    if (sig.length !== 64) return false;
    const pubkeyBytes = new PublicKey(claimedWallet).toBytes();
    return ed25519.verify(sig, new TextEncoder().encode(message), pubkeyBytes);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Challenge creation / session issue (pure-ish helpers; state lives in Store)
// ---------------------------------------------------------------------------

export function newChallenge(
  wallet: string,
  opts: { purpose?: 'signin' | 'bind'; subject?: string } = {}
): SiwsChallenge {
  const issuedAt = new Date();
  const expirationTime = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
  const nonce = randomUUID();
  const purpose = opts.purpose ?? 'signin';
  const subject = purpose === 'bind' ? (opts.subject ?? '').trim() : undefined;
  return {
    wallet,
    nonce,
    domain: SIWS_DOMAIN,
    uri: SIWS_URI,
    chainId: SIWS_CHAIN_ID,
    issuedAt: issuedAt.toISOString(),
    expirationTime: expirationTime.toISOString(),
    ...(purpose === 'bind' ? { purpose, subject } : {}),
    message: buildSiwsMessage({
      wallet,
      domain: SIWS_DOMAIN,
      uri: SIWS_URI,
      chainId: SIWS_CHAIN_ID,
      nonce,
      issuedAt: issuedAt.toISOString(),
      expirationTime: expirationTime.toISOString(),
      ...(subject ? { subject } : {})
    })
  };
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function newSession(wallet: string, role: AuthRole, token?: string): AuthSession {
  const issuedAt = new Date();
  return {
    token: token ?? newSessionToken(),
    wallet,
    role,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + SESSION_TTL_MS).toISOString()
  };
}

export function bearerTokenFromHeader(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const m = /^Bearer\s+(.+)$/i.exec(authHeader);
  return m?.[1] ?? null;
}

/** Validate a raw verify request against a stored challenge (immutable message replay guard). */
export function validateVerifyAgainstChallenge(req: SiwsVerifyRequest, challenge: SiwsChallenge): string | null {
  if (req.wallet !== challenge.wallet) return 'wallet_mismatch';
  if (req.message !== challenge.message) return 'message_mismatch';
  if (new Date(challenge.expirationTime).getTime() < Date.now()) return 'challenge_expired';
  return null;
}