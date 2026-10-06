/**
 * ProofMesh credential mint path — Phase 1.
 *
 * Turns an in-memory Credential record into a REAL devnet transaction that
 * the proofmesh-gate Anchor program writes to a wallet+skill PDA. The same
 * PDA + fixed binary layout (packages/verifier-sdk/src/layout.ts) is what the
 * verifier-sdk reads back via RPC — no backend trust required.
 *
 * Requires:
 *   - .secrets/proofmesh-devnet.json (funded authority / issuer key)
 *   - SOLANA_RPC_URL or devnet default
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { deriveCredentialPda, PROGRAM_ID, TOTAL_ACCOUNT_LEN } from '@proofmesh/verifier-sdk';

// sha256("global:<instruction>")[0..8] — Anchor's instruction discriminator.
const MINT_DISCRIMINATOR = [136, 108, 131, 240, 163, 102, 204, 13];
const UPDATE_DISCRIMINATOR = [96, 104, 180, 182, 200, 19, 178, 1];
const EXTEND_EXPIRY_DISCRIMINATOR = [216, 39, 141, 15, 230, 100, 24, 26];
const REVOKE_DISCRIMINATOR = [38, 123, 95, 95, 223, 158, 169, 87];

export interface MintIssuerConfig {
  /** path to a funded devnet keypair (defaults to .secrets/proofmesh-devnet.json) */
  keypairPath?: string;
  rpcUrl?: string;
  skipConfirm?: boolean;
}

export interface MintResult {
  signature: string;
  pda: string;
  wallet: string;
  skillId: string;
  confirmations?: number;
  status: 'confirmed' | 'submitted';
}

/**
 * Resolve the issuer keypair path.
 *
 * The program now pins `authority` to `ISSUER`, so minting only ever works with
 * this one key. Resolution must therefore be explicit and loud: the previous
 * version silently returned `candidates[0]` even when it did not exist, and the
 * resulting ENOENT was swallowed by the pipeline as "devnet mint pending",
 * which reads like a network problem rather than a missing signer.
 */
function resolveKeypairPath(config?: MintIssuerConfig): string {
  const explicit = config?.keypairPath ?? process.env.SOLANA_KEYPAIR_PATH;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = explicit
    ? [path.resolve(explicit)]
    : [
        path.resolve(here, '../../../.secrets/proofmesh-devnet.json'),
        path.resolve(process.cwd(), '.secrets/proofmesh-devnet.json')
      ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  throw new Error(
    `issuer keypair not found. Looked in: ${candidates.join(', ')}. ` +
      `Set SOLANA_KEYPAIR_PATH (or pass keypairPath). Without it, minting cannot work.`
  );
}

function loadKeypair(config?: MintIssuerConfig): Keypair {
  const file = resolveKeypairPath(config);
  const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed) || parsed.length !== 64 || !parsed.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    throw new Error(`issuer keypair ${file} is not a 64-byte Solana secret key array`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(parsed));
}

export function getRpcUrl(config?: MintIssuerConfig): string {
  return config?.rpcUrl ?? process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com';
}

/** Borsh serialization matching Anchor's `#[derive(AnchorSerialize)]`. */
function writeString(buf: number[], value: string): void {
  const enc = new TextEncoder().encode(value);
  pushU32(buf, enc.length);
  for (const b of enc) buf.push(b);
}

/**
 * Strict 32-byte hex decode.
 *
 * `Buffer.from(x, 'hex')` stops at the first invalid pair and silently returns
 * a short buffer, which pushed `expires_at` to the wrong offset and produced an
 * Anchor deserialisation error instead of a clear validation message.
 */
function evidenceRootToBytes(evidenceRoot: string): Uint8Array {
  const hex = evidenceRoot.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`evidenceRoot must be 64 hex characters (sha256), got ${JSON.stringify(evidenceRoot)}`);
  }
  return Uint8Array.from(Buffer.from(hex, 'hex'));
}

/** borsh u32 little-endian */
export function pushU32(buf: number[], value: number): void {
  buf.push(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);
}

/** borsh i64 little-endian */
export function pushI64(buf: number[], value: number): void {
  const big = BigInt(value);
  const bytes = [0n, 8n, 16n, 24n, 32n, 40n, 48n, 56n].map((s) => Number((big >> s) & 0xffn));
  buf.push(...bytes);
}

export interface MintArgs {
  wallet: string; // base58 pubkey of the credential subject
  skill: string; // one of the SKILLS ids
  skillScore: number; // 0..100
  confidencePct: number; // 0..100
  level: 1 | 2 | 3;
  evidenceRoot: string; // 64 hex chars (sha256)
  /** Stored verbatim in the 16-byte `analyzer_version` field. */
  analyzerVersion: string;
  /** 0 (or omitted) selects the program's 180-day default; bounded to 365d. */
  expiresAt?: number;
}

/**
 * Shared payload body for `mint_credential` and `update_credential` — the two
 * instructions take identical args, so the serializer is shared rather than
 * duplicated (the layouts must never drift apart).
 */
function writeCredentialArgs(
  buf: number[],
  args: MintArgs,
  expiresAt: number
): void {
  writeString(buf, args.skill);
  buf.push(args.skillScore, args.confidencePct, args.level);
  for (const b of evidenceRootToBytes(args.evidenceRoot)) buf.push(b);
  writeString(buf, args.analyzerVersion);
  pushI64(buf, expiresAt);
}

/**
 * `mint_credential` payload:
 *   8-byte discriminator + args{ skill: String, skill_score: u8,
 *   confidence_pct: u8, level: u8, evidence_root: [u8;32],
 *   analyzer_version: String, expires_at: i64 }
 */
export function buildMintInstructionData(args: MintArgs): Uint8Array {
  const buf: number[] = [...MINT_DISCRIMINATOR];
  // 0 lets the program pick DEFAULT_TTL_SECONDS; it also validates the bound.
  writeCredentialArgs(buf, args, args.expiresAt ?? 0);
  return Uint8Array.from(buf);
}

/**
 * `update_credential` payload. Same args as mint; `expires_at = 0` keeps the
 * credential's current expiry.
 */
export function buildUpdateInstructionData(args: MintArgs): Uint8Array {
  const buf: number[] = [...UPDATE_DISCRIMINATOR];
  writeCredentialArgs(buf, args, args.expiresAt ?? 0);
  return Uint8Array.from(buf);
}

/** `extend_expiry` payload: args{ skill: String, expires_at: i64 }. */
export function buildExtendExpiryInstructionData(skill: string, expiresAt = 0): Uint8Array {
  const buf: number[] = [...EXTEND_EXPIRY_DISCRIMINATOR];
  writeString(buf, skill);
  pushI64(buf, expiresAt);
  return Uint8Array.from(buf);
}

export function buildRevokeInstructionData(skill: string): Uint8Array {
  const buf: number[] = [...REVOKE_DISCRIMINATOR];
  writeString(buf, skill);
  return Uint8Array.from(buf);
}

/**
 * Mint a credential on-chain. Signs with the issuer keypair (authority),
 * initializes the PDA account owned by the gate program.
 */
export async function mintCredential(
  args: MintArgs,
  config?: MintIssuerConfig
): Promise<MintResult> {
  const { address } = await deriveCredentialPda(args.wallet, args.skill);
  const program = new PublicKey(PROGRAM_ID);
  const walletPub = new PublicKey(args.wallet);
  const issuer = loadKeypair(config);
  const connection = new Connection(getRpcUrl(config), 'confirmed');

  const balance = await connection.getBalance(issuer.publicKey, 'confirmed');
  const minRent = await connection.getMinimumBalanceForRentExemption(TOTAL_ACCOUNT_LEN, 'confirmed');
  if (balance < minRent + 10_000) {
    throw new Error(
      `issuer ${issuer.publicKey.toBase58()} has ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL — need ~${((minRent + 10_000) / LAMPORTS_PER_SOL).toFixed(6)} for PDA rent + fee (fund via devnet faucet)`
    );
  }

  const keys = [
    { pubkey: issuer.publicKey, isSigner: true, isWritable: true },
    {
      pubkey: new PublicKey(address),
      isSigner: false,
      isWritable: true,
    },
    { pubkey: walletPub, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    keys,
    programId: program,
    data: Buffer.from(buildMintInstructionData(args)),
  });

  const tx = new Transaction();
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = issuer.publicKey;
  tx.add(ix);

  return sendAndMaybeConfirm(connection, issuer, tx, blockhash, lastValidBlockHeight, address, args, config);
}

/**
 * Send and confirm.
 *
 * `skipConfirm` previously also disabled *preflight*, so a transaction the
 * program would reject was broadcast blind, read back half a second later, and
 * recorded as "confirmation pending" forever. Preflight is cheap and catches
 * exactly the errors that matter here (UnauthorizedIssuer, LowConfidence,
 * AlreadyRevoked), so it always runs; only the RPC wait is optional.
 */
async function sendAndMaybeConfirm(
  connection: Connection,
  issuer: Keypair,
  tx: Transaction,
  blockhash: string,
  lastValidBlockHeight: number,
  pda: string,
  args: { wallet: string; skill: string },
  config?: MintIssuerConfig
): Promise<MintResult> {
  const signature = await connection.sendTransaction(tx, [issuer]);
  if (config?.skipConfirm) {
    return { signature, pda, wallet: args.wallet, skillId: args.skill, status: 'submitted' };
  }
  // web3.js v1 rejects when the transaction lands with an error, so a
  // program rejection surfaces here instead of being reported as "pending".
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  return { signature, pda, wallet: args.wallet, skillId: args.skill, status: 'confirmed' };
}

/**
 * Re-score an existing credential in place (issuer-only, on-chain).
 *
 * `mint` uses `init`, so this is the only way a re-analysis can reach chain
 * state; without it the first mint was permanent.
 */
export async function updateCredential(
  args: MintArgs,
  config?: MintIssuerConfig
): Promise<MintResult> {
  const { address } = await deriveCredentialPda(args.wallet, args.skill);
  const program = new PublicKey(PROGRAM_ID);
  const issuer = loadKeypair(config);
  const connection = new Connection(getRpcUrl(config), 'confirmed');

  const keys = [
    { pubkey: new PublicKey(address), isSigner: false, isWritable: true },
    { pubkey: issuer.publicKey, isSigner: true, isWritable: true },
    { pubkey: new PublicKey(args.wallet), isSigner: false, isWritable: false }
  ];

  const ix = new TransactionInstruction({
    keys,
    programId: program,
    data: Buffer.from(buildUpdateInstructionData(args))
  });

  const tx = new Transaction();
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = issuer.publicKey;
  tx.add(ix);

  return sendAndMaybeConfirm(connection, issuer, tx, blockhash, lastValidBlockHeight, address, args, config);
}

/** Extend a credential's lifetime on-chain (issuer-only). */
export async function extendExpiry(
  wallet: string,
  skill: string,
  expiresAt = 0,
  config?: MintIssuerConfig
): Promise<MintResult> {
  const { address } = await deriveCredentialPda(wallet, skill);
  const program = new PublicKey(PROGRAM_ID);
  const issuer = loadKeypair(config);
  const connection = new Connection(getRpcUrl(config), 'confirmed');

  const keys = [
    { pubkey: new PublicKey(address), isSigner: false, isWritable: true },
    { pubkey: issuer.publicKey, isSigner: true, isWritable: true },
    { pubkey: new PublicKey(wallet), isSigner: false, isWritable: false }
  ];

  const ix = new TransactionInstruction({
    keys,
    programId: program,
    data: Buffer.from(buildExtendExpiryInstructionData(skill, expiresAt))
  });

  const tx = new Transaction();
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = issuer.publicKey;
  tx.add(ix);

  return sendAndMaybeConfirm(
    connection,
    issuer,
    tx,
    blockhash,
    lastValidBlockHeight,
    address,
    { wallet, skill },
    config
  );
}

/** Revoke a credential on-chain (authority-only). */
export async function revokeCredential(
  wallet: string,
  skill: string,
  config?: MintIssuerConfig
): Promise<{ signature: string; pda: string; wallet: string; skillId: string }> {
  const { address } = await deriveCredentialPda(wallet, skill);
  const program = new PublicKey(PROGRAM_ID);
  const issuer = loadKeypair(config);
  const connection = new Connection(getRpcUrl(config), 'confirmed');

  const keys = [
    { pubkey: new PublicKey(address), isSigner: false, isWritable: true },
    { pubkey: issuer.publicKey, isSigner: true, isWritable: true },
    { pubkey: new PublicKey(wallet), isSigner: false, isWritable: false },
  ];

  const ix = new TransactionInstruction({
    keys,
    programId: program,
    data: Buffer.from(buildRevokeInstructionData(skill)),
  });

  const tx = new Transaction();
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
  tx.recentBlockhash = blockhash;
  tx.lastValidBlockHeight = lastValidBlockHeight;
  tx.feePayer = issuer.publicKey;
  tx.add(ix);

  const signature = await connection.sendTransaction(tx, [issuer]);
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  return { signature, pda: address, wallet, skillId: skill };
}

/** Minimum cost of building the PDA account + tx fees (informational). */
export const CREDENTIAL_RENT_SOL = (() => {
  // ~173-byte account at default rent exempt minimum.
  const bytes = TOTAL_ACCOUNT_LEN;
  // lamports-per-year heuristic; devnet is free but the program needs rent.
  const lamports = Math.ceil((bytes * 100) * LAMPORTS_PER_SOL); // placeholder, real rent from RPC
  void lamports;
  return 0.001;
})();