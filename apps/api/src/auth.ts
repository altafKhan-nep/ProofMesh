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

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519.js';
import { PublicKey } from '@solana/web3.js';
import type { AuthRole, AuthSession, SiwsChallenge, SiwsVerifyRequest } from '@proofmesh/shared-types';

export const SIWS_DOMAIN = 'proofmesh.xyz';
export const SIWS_URI = 'https://proofmesh.xyz';
export const SIWS_CHAIN_ID = 'solana:101'; // devnet
export const SIWS_VERSION = '1';

export const CHALLENGE_TTL_MS = 5 * 60_000; // 5 minutes
export const ACTION_CHALLENGE_TTL_MS = 60_000; // 60s — a privileged action proof is used immediately
export const SESSION_TTL_MS = 24 * 60 * 60_000; // 24 hours (absolute)
export const SESSION_IDLE_TTL_MS = 2 * 60 * 60_000; // 2 hours without activity
export const MAX_CHALLENGES_PER_WALLET = 5;

// Cookie names. The session token is httpOnly (invisible to JS, so an XSS
// cannot read it); the CSRF token is deliberately readable so the client can
// echo it in a header (double-submit). Both are SameSite=Lax, which covers
// cross-site form/POST CSRF; the header check covers the rest.
export const SESSION_COOKIE = 'pm_session';
export const CSRF_COOKIE = 'pm_csrf';
export const CSRF_HEADER = 'x-pm-csrf';

/** Cookie attributes shared by the session and CSRF cookies. */
export function sessionCookieOpts(req?: { protocol?: string; hostname?: string }): {
  httpOnly: boolean;
  sameSite: 'lax';
  path: string;
  secure: boolean;
  maxAge: number;
} {
  const behindTls = req?.protocol === 'https' || (req?.hostname ?? '').endsWith('proofmesh.xyz');
  return {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: behindTls,
    maxAge: Math.floor(SESSION_TTL_MS / 1000)
  };
}

/** The CSRF cookie is deliberately readable so the client can echo it back. */
export function csrfCookieOpts(req?: { protocol?: string; hostname?: string }): {
  httpOnly: false;
  sameSite: 'lax';
  path: string;
  secure: boolean;
  maxAge: number;
} {
  return { ...sessionCookieOpts(req), httpOnly: false };
}

/** Constant-time-ish comparison for CSRF tokens. */
export function safeEqual(a: string | undefined, b: string | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

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
    // Double-submit CSRF token. Not a secret: it is readable by JS and must be
    // echoed in a header, which a cross-site attacker cannot do.
    csrfToken: randomBytes(24).toString('base64url'),
    wallet,
    role,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + SESSION_TTL_MS).toISOString(),
    lastSeenAt: issuedAt.toISOString()
  };
}

/**
 * Sliding idle window: activity extends the session, but never past the absolute
 * 24h lifetime. Returns false when the session has expired.
 */
export function touchSession(session: AuthSession): boolean {
  const now = Date.now();
  if (new Date(session.expiresAt).getTime() < now) return false;
  const idleDeadline = new Date(session.lastSeenAt ?? session.issuedAt).getTime() + SESSION_IDLE_TTL_MS;
  if (now > idleDeadline) return false;
  session.lastSeenAt = new Date(now).toISOString();
  return true;
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

// ---------------------------------------------------------------------------
// P2 — per-request wallet proof for privileged (admin) actions
//
// A stolen session cookie must not be enough to drain the admin console: the
// wallet must sign *this* request. The signature covers method, path and a hash
// of the body, so a captured proof cannot be replayed onto a different action.
// ---------------------------------------------------------------------------

export interface ActionChallenge {
  nonce: string;
  wallet: string;
  method: string;
  path: string;
  bodyHash: string;
  issuedAt: string;
  expirationTime: string;
  message: string;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Stable hash of a request body. JSON key order must not change the hash, and a
 * bodyless request (GET/DELETE) must hash identically to an explicit `{}` — the
 * client signs `action: {}` for those.
 */
export function bodyHash(body: unknown): string {
  const value = body === undefined || body === null ? {} : body;
  let canonical: string;
  try {
    canonical = JSON.stringify(value, Object.keys(value as object).sort()) ?? '{}';
  } catch {
    canonical = JSON.stringify(value) ?? '{}';
  }
  return sha256Hex(canonical);
}

export function newActionChallenge(params: {
  wallet: string;
  method: string;
  path: string;
  body: unknown;
}): ActionChallenge {
  const issuedAt = new Date();
  const expirationTime = new Date(issuedAt.getTime() + ACTION_CHALLENGE_TTL_MS);
  const nonce = randomUUID();
  const hash = bodyHash(params.body);
  const message = [
    `${SIWS_DOMAIN} authorises a ProofMesh privileged action:`,
    ``,
    `Wallet: ${params.wallet}`,
    `Action: ${params.method.toUpperCase()} ${params.path}`,
    `Body SHA-256: ${hash}`,
    ``,
    `URI: ${SIWS_URI}`,
    `Version: ${SIWS_VERSION}`,
    `Chain ID: ${SIWS_CHAIN_ID}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
    `Expiration Time: ${expirationTime.toISOString()}`
  ].join('\n');
  return {
    nonce,
    wallet: params.wallet,
    method: params.method.toUpperCase(),
    path: params.path,
    bodyHash: hash,
    issuedAt: issuedAt.toISOString(),
    expirationTime: expirationTime.toISOString(),
    message
  };
}

/** Verify a privileged-action proof against the request it is being used for. */
export function verifyActionProof(
  challenge: ActionChallenge,
  signatureB64: string,
  req: { wallet: string; method: string; path: string; body: unknown }
): string | null {
  if (challenge.wallet !== req.wallet) return 'action_wallet_mismatch';
  if (challenge.method !== req.method.toUpperCase()) return 'action_method_mismatch';
  if (challenge.path !== req.path) return 'action_path_mismatch';
  if (challenge.bodyHash !== bodyHash(req.body)) return 'action_body_mismatch';
  if (new Date(challenge.expirationTime).getTime() < Date.now()) return 'action_expired';
  if (!verifySiwsSignature(challenge.message, signatureB64, req.wallet)) return 'invalid_signature';
  return null;
}