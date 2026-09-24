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
  if (attestation.status === 'EXPIRED' || new Date(attestation.expiresAt) < new Date())
    reasons.push('Attestation is expired.');
  if (opts.issuerAllowlist && opts.issuerAllowlist.length > 0) {
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
  if (attestation.level < 1) reasons.push('Credential not at a valid level.');

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

function readI64LE(bytes: Uint8Array, off: number): number {
  // Fits safely within Number until 2^53; unix seconds through 2050 are fine.
  const lo = readU32LE(bytes, off);
  const hi = readU32LE(bytes, off + 4);
  return lo + hi * 2 ** 32;
}

function toFixedString(bytes: Uint8Array, off: number, len: number): string {
  let end = off;
  const max = off + len;
  while (end < max && bytes[end] !== 0) end += 1;
  return Buffer.from(bytes.slice(off, end)).toString('utf8');
}

/** Parse the fixed binary Credential account (post-discriminator). */
export function parseCredentialLayout(
  data: Uint8Array,
  pda: string
): ParsedAttestation | null {
  if (data.length < LAYOUT.structLen) return null;
  const off = LAYOUT;
  const rawStatus = data[off.statusOffset] ?? 0;
  const status: ParsedAttestation['status'] =
    rawStatus === STATUS_EXPIRED
      ? 'EXPIRED'
      : rawStatus === STATUS_REVOKED
        ? 'REVOKED'
        : 'ISSUED';
  const wallet = bytesToPubkey(data.slice(off.walletOffset, off.walletOffset + 32));
  const skillId = toFixedString(data, off.schemaOffset, 32);
  const score = data[off.skillScoreOffset] ?? 0;
  const confidencePct = data[off.confidencePctOffset] ?? 0;
  const level = (data[off.levelOffset] ?? 0) as 0 | 1 | 2 | 3;
  const issuedAt = readI64LE(data, off.issuedAtOffset);
  const expiresAt = readI64LE(data, off.expiresAtOffset);
  const authority = bytesToPubkey(data.slice(off.authorityOffset, off.authorityOffset + 32));
  const rootBytes = data.slice(off.evidenceRootOffset, off.evidenceRootOffset + 32);
  const analyzer = toFixedString(data, off.analyzerOffset, 16);

  return {
    attestationAddress: pda,
    wallet,
    skillId,
    skillLabel: skillId,
    skillScore: score,
    confidencePercent: confidencePct,
    level,
    issuerAddress: authority,
    schema: skillId,
    analyzerVersion: analyzer || 'pow-analyzer',
    evidenceRoot: toBase58(rootBytes),
    issuedAt: new Date(issuedAt * 1000).toISOString(),
    expiresAt: new Date(expiresAt * 1000).toISOString(),
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
      params: [address, { encoding: 'base64' }]
    })
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const body = (await res.json()) as {
    result?: { value?: { data?: [string, string] } | { data?: string } | null };
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

  // Skip the 8-byte Anchor account discriminator.
  const parsed = parseCredentialLayout(raw.subarray(8), address);
  if (!parsed) return null;
  parsed.wallet = args.wallet;
  parsed.skillId = args.skillId;
  parsed.skillLabel = args.skillId;
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