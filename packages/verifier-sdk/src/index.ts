/**
 * ProofMesh Verifier SDK — RPC-only.
 *
 * ARCHITECTURE.md §9: `verify(wallet, skill, {minScore, minConfidence,
 * issuerAllowlist})` reads a SAS attestation directly from a Solana RPC endpoint.
 * There is deliberately NO call to the ProofMesh backend; the SDK is a pure
 * consumer of on-chain state.
 */

import type { VerifyResult, VerifierOptions, SkillId } from '@proofmesh/shared-types';
import {
  deriveCredentialPda,
  LAYOUT,
  bytesToPubkey,
  toBase58,
  ACCOUNT_DISCRIMINATOR,
  PROGRAM_ID,
  TOTAL_ACCOUNT_LEN,
  STATUS_ISSUED,
  STATUS_EXPIRED,
  STATUS_REVOKED,
} from './layout.js';

export {
  deriveCredentialPda,
  findProgramAddress,
  isOnCurve,
  fromBase58,
  toBase58,
  bytesToPubkey,
  pubkeyToBytes,
  PROGRAM_ID,
  SEED_PREFIX,
  CREDENTIAL_DISCRIMINATOR,
  ACCOUNT_DISCRIMINATOR,
  TOTAL_ACCOUNT_LEN,
  LAYOUT,
  STATUS_ISSUED,
  STATUS_EXPIRED,
  STATUS_REVOKED,
} from './layout.js';

export interface ParsedAttestation {
  /** base58 pubkey of the SAS attestation account (PDA) */
  attestationAddress: string;
  wallet: string;
  skillId: string;
  skillLabel: string;
  skillScore: number; // 0-100
  confidencePercent: number; // 0-100 (50 = c 0.5, 99 = 0.99)
  level: 0 | 1 | 2 | 3;
  issuerAddress: string;
  schema: string;
  analyzerVersion: string;
  evidenceRoot: string;
  issuedAt: string;
  expiresAt: string;
  status: 'ISSUED' | 'EXPIRED' | 'REVOKED';
}

export type AttestationReader = (args: {
  wallet: string;
  skillId: string;
  rpcUrl: string;
}) => Promise<ParsedAttestation | null>;

export interface VerifyParams extends VerifierOptions {
  rpcUrl?: string;
  readAttestation?: AttestationReader;
}

export interface VerifiedGrade {
  valid: boolean;
  reasons: string[];
  attestation: ParsedAttestation | null;
}

// ---------------------------------------------------------------------------
// Pure verification logic — deterministic, fully unit-tested.
// ---------------------------------------------------------------------------

export function toConfidence(percent: number): number {
  return Math.min(1, Math.max(0, percent / 100));
}

export function verifyConstraints(
  attestation: ParsedAttestation,
  opts: Required<Pick<VerifierOptions, 'minScore' | 'minConfidence'>> & VerifierOptions
): VerifiedGrade {
  const reasons: string[] = [];

  if (attestation.status === 'REVOKED') reasons.push('Attestation is revoked.');
  if (attestation.status === 'EXPIRED') reasons.push('Attestation is expired.');

  // Fail CLOSED on an unparseable expiry. `new Date('garbage')` is Invalid
  // Date, and `InvalidDate < validDate` is `NaN < x` === false, so the
  // previous check silently treated corrupt dates as "not expired".
  const expiry = Date.parse(attestation.expiresAt);
  if (!Number.isFinite(expiry)) {
    reasons.push('Attestation expiry is unparseable — treated as expired.');
  } else if (expiry <= Date.now()) {
    reasons.push('Attestation is expired.');
  }

  // An explicitly supplied allowlist is authoritative, INCLUDING the empty
  // array. `length > 0` previously meant an empty allowlist (= "no issuers
  // configured") silently trusted every issuer, including a wallet that had
  // minted its own credential through a permissionless program.
  if (opts.issuerAllowlist !== undefined) {
    if (!opts.issuerAllowlist.includes(attestation.issuerAddress))
      reasons.push(`Issuer ${attestation.issuerAddress} not in allowlist.`);
  }

  if (attestation.skillScore < (opts.minScore ?? 0))
    reasons.push(`Score ${attestation.skillScore} below minimum ${opts.minScore}.`);
  if (toConfidence(attestation.confidencePercent) < (opts.minConfidence ?? 0))
    reasons.push(
      `Confidence ${attestation.confidencePercent as number}% below minimum ${
        (opts.minConfidence ?? 0) * 100
      }%.`
    );
  // Range check rather than `< 1` alone: a corrupt account carrying level 200
  // previously satisfied this test.
  if (attestation.level < 1 || attestation.level > 3)
    reasons.push(`Credential level ${attestation.level} is out of range (expected 1..3).`);

  return {
    valid: reasons.length === 0,
    reasons,
    attestation
  };
}

/**
 * Lightweight validator for a parsed attestation record without touching RPC.
 * Used by off-chain mirrors (e.g. the public verify page) and tests.
 */
export function validateAttestationRecord(
  record: {
    wallet: string;
    skillId: string;
    skillScore: number;
    confidencePercent: number;
    level: 0 | 1 | 2 | 3;
    issuerAddress: string;
    expiresAt: string;
    status: 'ISSUED' | 'EXPIRED' | 'REVOKED';
  },
  opts: VerifierOptions = {}
): VerifiedGrade {
  const attestation: ParsedAttestation = {
    attestationAddress: '',
    wallet: record.wallet,
    skillId: record.skillId,
    skillLabel: record.skillId,
    skillScore: record.skillScore,
    confidencePercent: record.confidencePercent,
    level: record.level,
    issuerAddress: record.issuerAddress,
    schema: '',
    analyzerVersion: '',
    evidenceRoot: '',
    issuedAt: '',
    expiresAt: record.expiresAt,
    status: record.status
  };
  return verifyConstraints(attestation, {
    minScore: opts.minScore ?? 0,
    minConfidence: opts.minConfidence ?? 0,
    issuerAllowlist: opts.issuerAllowlist
  });
}

// ---------------------------------------------------------------------------
// The public API — read from an RPC endpoint, never from proofmesh.xyz.
// ---------------------------------------------------------------------------

export async function verify(
  wallet: string,
  skillId: string,
  opts: VerifyParams = {}
): Promise<VerifyResult> {
  const rpcUrl = opts.rpcUrl ?? process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
  const read = opts.readAttestation ?? readAttestationFromRpc;

  const attestation = await read({ wallet, skillId, rpcUrl });
  if (!attestation) {
    return {
      valid: false,
      wallet,
      skillId: skillId as SkillId,
      skillLabel: skillId,
      score: 0,
      confidence: 0,
      level: 0,
      issuerAddress: '',
      schema: '',
      analyzerVersion: 'unknown',
      evidenceRoot: '',
      reportUri: '',
      issuedAt: '',
      expiresAt: '',
      status: 'EXPIRED'
    };
  }

  const grade = verifyConstraints(attestation, {
    minScore: opts.minScore ?? 0,
    minConfidence: opts.minConfidence ?? 0,
    issuerAllowlist: opts.issuerAllowlist
  });

  return {
    valid: grade.valid,
    wallet,
    skillId: skillId as SkillId,
    skillLabel: attestation.skillLabel,
    score: attestation.skillScore,
    confidence: toConfidence(attestation.confidencePercent),
    level: attestation.level,
    issuerAddress: attestation.issuerAddress,
    schema: attestation.schema,
    analyzerVersion: attestation.analyzerVersion,
    evidenceRoot: attestation.evidenceRoot,
    reportUri: `https://proofmesh.xyz/verify/${wallet}/${skillId}`,
    issuedAt: attestation.issuedAt,
    expiresAt: attestation.expiresAt,
    status: attestation.status
  };
}

// ---------------------------------------------------------------------------
// RPC adapter. Queries a Solana RPC endpoint (default devnet) via JSON-RPC for
// the derived PDA, then parses the fixed binary layout that the Anchor
// proofmesh-gate program wrote at mint time. Dependency-light (global fetch);
// offline-testable by injecting a fake reader. If no account exists at the
// derived PDA — the honest truth for any non-minted credential — it returns
// null and `verify` reports `valid:false`, exactly as an on-chain consumer must.
//
// PDA + ABI come from ./layout.ts, kept in lock-step with
// programs/proofmesh-gate/src/lib.rs.
// ---------------------------------------------------------------------------

const DEVNET_RPC = 'https://api.devnet.solana.com';

function readU32LE(bytes: Uint8Array, off: number): number {
  return (
    (bytes[off] ?? 0) |
    ((bytes[off + 1] ?? 0) << 8) |
    ((bytes[off + 2] ?? 0) << 16) |
    ((bytes[off + 3] ?? 0) << 24)
  ) >>> 0;
}

/**
 * Signed little-endian i64 as a Number, or NaN when it is not a sane unix time.
 *
 * `lib.rs` stores `i64`, but this previously read it UNSIGNED and never range
 * checked. The program accepts any i64, so `expires_at = i64::MAX` minted
 * cleanly and then made `new Date(...).toISOString()` throw `RangeError` out of
 * every `verify()` call — permanently bricking the SDK for that (wallet, skill).
 */
function readI64LE(bytes: Uint8Array, off: number): number {
  const lo = readU32LE(bytes, off);
  const hi = readU32LE(bytes, off + 4) | 0; // force signed high word
  const v = hi * 2 ** 32 + lo;
  if (!Number.isSafeInteger(v)) return Number.NaN;
  return v;
}

/** Unix seconds -> ISO string, or null if out of the representable range. */
function toIsoString(unixSeconds: number): string | null {
  if (!Number.isFinite(unixSeconds) || Math.abs(unixSeconds) > 8_640_000_000_000_000)
    return null;
  const d = new Date(unixSeconds * 1000);
  const s = Number.isNaN(d.getTime()) ? null : d.toISOString();
  return s;
}

/**
 * NUL-padded fixed-width field -> string.
 *
 * Rejects invalid UTF-8 instead of silently substituting U+FFFD, so a garbage
 * account cannot masquerade as a (mangled) skill id.
 */
function toFixedString(bytes: Uint8Array, off: number, len: number): string | null {
  let end = off;
  const max = off + len;
  while (end < max && bytes[end] !== 0) end += 1;
  if (end === off) return null; // empty required field
  const buf = Buffer.from(bytes.slice(off, end));
  const decoded = new TextDecoder('utf-8', { fatal: true });
  try {
    return decoded.decode(buf);
  } catch {
    return null;
  }
}

/**
 * Parse the fixed binary `Credential` account (post-discriminator).
 *
 * This VALIDATES; it does not merely deserialize. A record is rejected unless
 * every field is in range, because a caller that only deserializes will happily
 * surface a corrupt account as a credential:
 *
 *  - exact length (a longer account would otherwise have its tail ignored)
 *  - status byte must be 0|1|2 (byte 255 previously read as `ISSUED`)
 *  - level must be 1..=3 (byte 200 previously returned `valid: true`)
 *  - timestamps must be sane unix seconds (i64::MAX previously threw RangeError)
 *  - skill id must be non-empty and valid UTF-8
 */
export function parseCredentialLayout(
  data: Uint8Array,
  pda: string
): ParsedAttestation | null {
  // Exact length: >= allowed a 1000-zero-byte account to "parse" successfully.
  if (data.length !== LAYOUT.structLen) return null;
  const off = LAYOUT;

  const rawStatus = data[off.statusOffset] ?? -1;
  let status: ParsedAttestation['status'];
  switch (rawStatus) {
    case STATUS_ISSUED:
      status = 'ISSUED';
      break;
    case STATUS_EXPIRED:
      status = 'EXPIRED';
      break;
    case STATUS_REVOKED:
      status = 'REVOKED';
      break;
    default:
      return null; // unknown status byte — reject rather than assume ISSUED
  }

  const level = data[off.levelOffset] ?? 0;
  if (level < 1 || level > 3) return null;

  const skillId = toFixedString(data, off.schemaOffset, 32);
  if (!skillId) return null;

  const issuedAt = toIsoString(readI64LE(data, off.issuedAtOffset));
  const expiresAt = toIsoString(readI64LE(data, off.expiresAtOffset));
  if (!issuedAt || !expiresAt) return null;

  const analyzerVersion = toFixedString(data, off.analyzerOffset, 16);
  if (!analyzerVersion) return null; // must not be a zeroed field

  const score = data[off.skillScoreOffset] ?? 0;
  const confidencePct = data[off.confidencePctOffset] ?? 0;
  if (score > 100 || confidencePct > 100) return null;

  return {
    attestationAddress: pda,
    wallet: bytesToPubkey(data.slice(off.walletOffset, off.walletOffset + 32)),
    skillId,
    skillLabel: skillId,
    skillScore: score,
    confidencePercent: confidencePct,
    level: level as 1 | 2 | 3,
    issuerAddress: bytesToPubkey(data.slice(off.authorityOffset, off.authorityOffset + 32)),
    schema: skillId,
    analyzerVersion,
    evidenceRoot: toBase58(data.slice(off.evidenceRootOffset, off.evidenceRootOffset + 32)),
    issuedAt,
    expiresAt,
    status,
  };
}

async function rpcRead(args: {
  wallet: string;
  skillId: string;
  rpcUrl: string;
}): Promise<ParsedAttestation | null> {
  const rpc = args.rpcUrl || DEVNET_RPC;
  const { address } = await deriveCredentialPda(args.wallet, args.skillId);

  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'getAccountInfo',
      // `commitment: 'finalized'` — without it the node's default
      // (often `processed`) can serve a pre-revocation snapshot, so a
      // revoked credential still verified as valid for a slot or two. For a
      // credential gating paid work that is the whole ballgame.
      params: [address, { encoding: 'base64', commitment: 'finalized' }]
    })
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const body = (await res.json()) as {
    result?: {
      value?: { data?: [string, string] | string; owner?: string } | null;
    };
    error?: { message?: string };
  };
  if (body.error) throw new Error(`RPC ${body.error.message ?? 'error'}`);
  const value = body.result?.value;
  if (!value) return null;

  const data = value.data;
  let raw: Uint8Array | null = null;
  if (Array.isArray(data)) {
    const [payload, encoding] = data;
    if (encoding === 'base64' && typeof payload === 'string')
      raw = Uint8Array.from(Buffer.from(payload, 'base64'));
  } else if (typeof data === 'string') {
    raw = Uint8Array.from(Buffer.from(data, 'base64'));
  }
  if (!raw || raw.length === 0) return null;

  // Owner check: bytes at this address must have been written by the gate
  // program. Without it, any account at these bytes is trusted.
  if (value.owner !== PROGRAM_ID) return null;

  // Account discriminator: sha256("account:Credential")[0..8]. The old code
  // *skipped* these 8 bytes without checking them, so nothing identified the
  // payload as a ProofMesh credential.
  if (raw.length < TOTAL_ACCOUNT_LEN) return null;
  for (let i = 0; i < 8; i++) {
    if (raw[i] !== ACCOUNT_DISCRIMINATOR[i]) return null;
  }

  const parsed = parseCredentialLayout(raw.subarray(8), address);
  if (!parsed) return null;

  // Identity cross-check. The old code OVERWROTE the parsed values with the
  // caller's own arguments, so a mismatch could never be detected and
  // `parsed.wallet === args.wallet` held by construction.
  if (parsed.wallet !== args.wallet) return null;
  if (parsed.skillId !== args.skillId) return null;

  return parsed;
}

async function readAttestationFromRpc(args: {
  wallet: string;
  skillId: string;
  rpcUrl: string;
}): Promise<ParsedAttestation | null> {
  return rpcRead(args);
}

export { readAttestationFromRpc };