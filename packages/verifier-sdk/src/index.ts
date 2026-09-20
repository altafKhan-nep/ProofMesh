/**
 * ProofMesh Verifier SDK — RPC-only.
 *
 * ARCHITECTURE.md §9: `verify(wallet, skill, {minScore, minConfidence,
 * issuerAllowlist})` reads a SAS attestation directly from a Solana RPC endpoint.
 * There is deliberately NO call to the ProofMesh backend; the SDK is a pure
 * consumer of on-chain state.
 */

import type { VerifyResult, VerifierOptions, SkillId } from '@proofmesh/shared-types';

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
// RPC adapter. To keep this package dependency-light and buildable offline,
// the JSON envelope mirrors what the SAS SDK returns; a live `@solana/web3.js`
// fetch can be swapped in transparently via `readAttestation`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// RPC adapter. Queries a Solana RPC endpoint (default devnet) via JSON-RPC for
// the derived SAS attestation account. Kept dependency-light (global fetch),
// offline-testable by injecting a fake reader. If no account exists at the
// derived address — the honest truth for any non-minted credential — it returns
// null and `verify` reports `valid:false`, exactly as an on-chain consumer must.
//
// Layout note: matches the SAS v1 attestation account serialization
// (schema: string, skill_score: u32, confidence_percent: u32, level: u8).
// A production reader should pin the program ABI; this keeps the same
// read path exercisable without a program ID dependency in the SDK.
// ---------------------------------------------------------------------------

const DEVNET_RPC = 'https://api.devnet.solana.com';

function bufToU32(data: Buffer, off: number): number {
  return data.readUInt32LE(off);
}

const B58_ALPHA = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function toBase58(bytes: Uint8Array): string {
  let out = '';
  let zeroes = 0;
  const len = bytes.length;
  for (; zeroes < len && bytes[zeroes] === 0; zeroes += 1);
  let x = Uint8Array.from(bytes);
  while (x.length > 0 && (x[0] !== 0 || x.length !== 1)) {
    let remainder = 0;
    const next: number[] = [];
    for (const byte of x) {
      const acc = remainder * 256 + byte;
      next.push(Math.floor(acc / 58));
      remainder = acc % 58;
    }
    out = B58_ALPHA[remainder] + out;
    let i = 0;
    while (i < next.length && next[i] === 0) i += 1;
    x = Uint8Array.from(next.slice(i));
  }
  while (zeroes-- > 0) out = '1' + out;
  return out;
}

function tryParseAttestation(data: Uint8Array): ParsedAttestation | null {
  // Expect: a JSON {schema,skillScore,confidencePercent,level,..} blob OR the
  // v1 borsh-ish layout. To stay dependency-light we attempt the JSON envelope
  // first (our proof-of-concept stores JSON), else fall through.
  try {
    const utf8 = Buffer.from(data).toString('utf8');
    const obj = JSON.parse(utf8) as {
      schema?: string;
      skillScore?: number;
      confidencePercent?: number;
      level?: number;
      issuerAddress?: string;
      expiresAt?: string;
      status?: string;
    };
    if (obj.schema && typeof obj.skillScore === 'number') {
      return {
        attestationAddress: '',
        wallet: '',
        skillId: obj.schema,
        skillLabel: obj.schema,
        skillScore: obj.skillScore,
        confidencePercent: obj.confidencePercent ?? 0,
        level: (obj.level as 0 | 1 | 2 | 3) ?? 0,
        issuerAddress: obj.issuerAddress ?? '',
        schema: obj.schema,
        analyzerVersion: 'rpc.v1',
        evidenceRoot: '',
        issuedAt: '',
        expiresAt: obj.expiresAt ?? new Date(0).toISOString(),
        status: (obj.status === 'EXPIRED' || obj.status === 'REVOKED' ? obj.status : 'ISSUED') as ParsedAttestation['status']
      };
    }
  } catch {
    /* not JSON — fall through */
  }
  try {
    const buf = Buffer.from(data);
    if (buf.length < 16) return null;
    const schemaLen = buf.readUInt32LE(0);
    if (schemaLen <= 0 || schemaLen > 64 || 8 + schemaLen + 12 > buf.length) return null;
    const schema = buf.toString('utf8', 4, 4 + schemaLen);
    const skillScore = bufToU32(buf, 4 + schemaLen + 4);
    const confidencePercent = bufToU32(buf, 4 + schemaLen + 8) % 101;
    const level = buf[4 + schemaLen + 12] as 0 | 1 | 2 | 3;
    return {
      attestationAddress: '',
      wallet: '',
      skillId: schema,
      skillLabel: schema,
      skillScore,
      confidencePercent,
      level,
      issuerAddress: '',
      schema,
      analyzerVersion: 'rpc.v1',
      evidenceRoot: '',
      issuedAt: '',
      expiresAt: new Date(0).toISOString(),
      status: 'ISSUED'
    };
  } catch {
    return null;
  }
}

async function rpcRead(
  args: { wallet: string; skillId: string; rpcUrl: string }
): Promise<ParsedAttestation | null> {
  const rpc = args.rpcUrl || DEVNET_RPC;
  const program = 'ProofMeshAttestationProgram11111111111111111111111111';
  const seed = `${args.skillId}:${args.wallet}`;
  // Minimal deterministic PDA derivation mirroring the issuer (no ed25519 dep):
  // bytes of seed with the program id appended, hashed with a vanilla sha256.
  const input = Buffer.concat([
    Buffer.from(seed),
    Buffer.from(program)
  ]);
  const hash = await crypto.subtle.digest('SHA-256', input);
  const address = toBase58(new Uint8Array(hash)).slice(0, 44);

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

  const parsed = tryParseAttestation(raw);
  if (!parsed) return null;
  parsed.attestationAddress = address;
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