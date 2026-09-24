/**
 * On-chain ABI for the ProofMesh gate program (Anchor).
 *
 * Keep in lock-step with programs/proofmesh-gate/src/lib.rs. The credential
 * account is a fixed 173-byte layout:
 *
 *   8  bytes  Anchor discriminator (sha256("account:Credential")[0..8])
 *   165 bytes the Credential struct below
 *
 * PDA derivation mirrors Solana `find_program_address` exactly:
 *   seeds = [b"credential", wallet_pubkey, skill_ascii]
 *   for bump in 255..=0: candidate = sha256(seeds || bump || program_id || "ProgramDerivedAddress")
 *   -> first candidate whose 32 bytes do NOT decompress to an ed25519 point wins.
 */

export const CREDENTIAL_DISCRIMINATOR = 8;
export const PROGRAM_ID = '8p8PNd75RdygjcmnvQMGW3U8Fr9AwgR21fSGSL7VBvAj';

export const SCHEMA_LEN = 32;
export const ANALYZER_LEN = 16;

/** (offset, size) in the post-discriminator struct. */
export const LAYOUT = {
  authorityOffset: 0, // Pubkey 32
  walletOffset: 32, // Pubkey 32
  schemaOffset: 64, // [u8;32]
  skillScoreOffset: 96, // u8
  confidencePctOffset: 97, // u8
  levelOffset: 98, // u8
  issuerTierOffset: 99, // u8
  evidenceRootOffset: 100, // [u8;32]
  analyzerOffset: 132, // [u8;16]
  statusOffset: 148, // u8 0=ISSUED 1=EXPIRED 2=REVOKED
  issuedAtOffset: 149, // i64 LE
  expiresAtOffset: 157, // i64 LE
  structLen: 165,
} as const;

export const TOTAL_ACCOUNT_LEN = CREDENTIAL_DISCRIMINATOR + LAYOUT.structLen;

export const SEED_PREFIX = 'credential';

export const STATUS_ISSUED = 0;
export const STATUS_EXPIRED = 1;
export const STATUS_REVOKED = 2;

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function fromBase58(input: string): Uint8Array {
  if (input.length === 0) return new Uint8Array(0);
  const bytes: number[] = [0];
  for (const ch of input) {
    const idx = B58.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid base58 char: ${ch}`);
    let carry = idx;
    for (let i = 0; i < bytes.length; i++) {
      const x = (bytes[i] ?? 0) * 58 + carry;
      bytes[i] = x % 256;
      carry = Math.floor(x / 256);
    }
    while (carry > 0) {
      bytes.push(carry % 256);
      carry = Math.floor(carry / 256);
    }
  }
  const zeros = (input.match(/^1*/) ?? [''])[0]!.length;
  while (bytes.length > 1 && bytes[bytes.length - 1] === 0) bytes.pop();
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i]!;
  return out;
}

export function toBase58(bytes: Uint8Array): string {
  if (bytes.length === 0) return '';
  const digits = [0];
  for (const b of bytes) {
    let carry = b;
    for (let i = 0; i < digits.length; i++) {
      carry += (digits[i]! << 8) >>> 0;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out += '1';
  for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]!]!;
  return out;
}

export function pubkeyToBytes(base58Addr: string): Uint8Array {
  const bytes = fromBase58(base58Addr);
  if (bytes.length !== 32)
    throw new Error(`Expected a 32-byte base58 pubkey, got ${bytes.length} bytes`);
  return bytes;
}

export function bytesToPubkey(bytes: Uint8Array): string {
  if (bytes.length !== 32) throw new Error(`Expected 32 bytes for a pubkey, got ${bytes.length}`);
  return toBase58(bytes);
}

// ---------------------------------------------------------------------------
// ed25519 on-curve check (mirrors Solana's is_on_curve: CompressedEdwardsY
// decompress().is_some()). Pure bigint — no crypto dependency.
// ---------------------------------------------------------------------------

const P = (1n << 255n) - 19n; // 2^255 - 19
const D = (-121665n * modInv(121666n)) % P;

function modInv(a: bigint): bigint {
  let [old_r, r] = [a % P, P];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  return ((old_s % P) + P) % P;
}

function modPow(base: bigint, exp: bigint): bigint {
  let result = 1n;
  base = ((base % P) + P) % P;
  let e = exp;
  while (e > 0n) {
    if (e & 1n) result = (result * base) % P;
    base = (base * base) % P;
    e >>= 1n;
  }
  return result;
}

// Is x a quadratic residue mod P? (Euler's criterion.)
function isSqrtResidue(x: bigint): boolean {
  if (x === 0n) return true;
  const r = modPow(x, (P - 1n) / 2n);
  return r === 1n;
}

/**
 * Solana is_on_curve: takes the 32-byte compressed encoding, clears
 * the sign bit, treats the remainder as little-endian y, and succeeds iff the
 * curve equation has a solution (x² is a quadratic residue).
 */
export function isOnCurve(bytes: Uint8Array): boolean {
  if (bytes.length !== 32) return false;
  let y = 0n;
  for (let i = 0; i < 31; i++) y |= BigInt(bytes[i]!) << BigInt(8 * i);
  y |= BigInt(bytes[31]! & 0x7f) << BigInt(8 * 31); // y is 255 bits; top bit of byte31 is the sign bit
  const y2 = (y * y) % P;
  const num = (y2 - 1n + P) % P;
  const den = (D * y2 + 1n) % P;
  if (den === 0n) return false;
  const x2 = (num * modInv(den)) % P;
  return isSqrtResidue(x2);
}

export async function asyncSha256(bytes: Uint8Array): Promise<Uint8Array> {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.subtle?.digest) {
    const copy = new Uint8Array(bytes);
    const d = await c.subtle.digest('SHA-256', copy);
    return new Uint8Array(d);
  }
  const { createHash } = await import('node:crypto');
  return Uint8Array.from(createHash('sha256').update(Buffer.from(bytes)).digest());
}

export type HashFn = (bytes: Uint8Array) => Promise<Uint8Array>;

/**
 * Exact Solana find_program_address: try bumps 255..0, return the first
 * (address, bump) whose sha256(seeds || bump || program_id || "ProgramDerivedAddress")
 * is NOT on the curve (create_program_address rejects on-curve hashes).
 */
export async function findProgramAddress(
  programId: Uint8Array,
  seeds: Uint8Array[],
  hashFn: HashFn = asyncSha256
): Promise<{ address: Uint8Array; bump: number } | null> {
  const marker = new TextEncoder().encode('ProgramDerivedAddress');
  for (let bump = 255; bump >= 0; bump--) {
    const pieces: Uint8Array[] = [...seeds, Uint8Array.of(bump), programId, marker];
    const total = pieces.reduce((a, p) => a + p.length, 0);
    const buf = new Uint8Array(total);
    let off = 0;
    for (const p of pieces) {
      buf.set(p, off);
      off += p.length;
    }
    const hash = await hashFn(buf);
    if (!isOnCurve(hash)) return { address: hash, bump };
  }
  return null;
}

export async function deriveCredentialPda(
  walletBase58: string,
  skill: string,
  hashFn?: HashFn
): Promise<{ address: string; bump: number; seed: Uint8Array[] }> {
  const programId = pubkeyToBytes(PROGRAM_ID);
  const wallet = pubkeyToBytes(walletBase58);
  const seed = [
    new TextEncoder().encode(SEED_PREFIX),
    wallet,
    new TextEncoder().encode(skill),
  ];
  const found = await findProgramAddress(programId, seed, hashFn);
  if (!found) throw new Error(`No PDA found for wallet=${walletBase58} skill=${skill}`);
  return { address: toBase58(found.address), bump: found.bump, seed };
}