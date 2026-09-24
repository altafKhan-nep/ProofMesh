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

const MINT_DISCRIMINATOR = [136, 108, 131, 240, 163, 102, 204, 13];
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

function resolveKeypairPath(config?: MintIssuerConfig): string {
  if (config?.keypairPath) return path.resolve(config.keypairPath);
  if (process.env.SOLANA_KEYPAIR_PATH) return path.resolve(process.env.SOLANA_KEYPAIR_PATH);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), '.secrets/proofmesh-devnet.json'),
    path.resolve(here, '../../../.secrets/proofmesh-devnet.json'),
    path.resolve(here, '../.secrets/proofmesh-devnet.json')
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return candidates[0];
}

function loadKeypair(config?: MintIssuerConfig): Keypair {
  const raw = JSON.parse(fs.readFileSync(resolveKeypairPath(config), 'utf8')) as number[];
  return Keypair.fromSecretKey(Uint8Array.from(raw));
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
  skill: string; // "solana-anchor" | "typescript" | "java"
  skillScore: number; // 0..100
  confidencePct: number; // 0..100
  level: 1 | 2 | 3;
  evidenceRoot: string; // 32-byte hex
  expiresAt?: number; // unix seconds (default now + 180d)
}

/**
 * Build the `mint_credential` instruction payload:
 *   8-byte discriminator + args{ skill: String, skill_score: u8,
 *   confidence_pct: u8, level: u8, evidence_root: [u8;32], expires_at: i64 }
 */
export function buildMintInstructionData(args: MintArgs): Uint8Array {
  const rootBytes = Uint8Array.from(Buffer.from(args.evidenceRoot.padEnd(64, '0').slice(0, 64), 'hex'));
  const buf: number[] = [...MINT_DISCRIMINATOR];
  writeString(buf, args.skill);
  buf.push(args.skillScore, args.confidencePct, args.level);
  for (const b of rootBytes) buf.push(b);
  pushI64(buf, args.expiresAt ?? Math.floor(Date.now() / 1000) + 180 * 86400);
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

  const signature = await connection.sendTransaction(tx, [issuer], { skipPreflight: config?.skipConfirm });

  if (config?.skipConfirm) {
    return { signature, pda: address, wallet: args.wallet, skillId: args.skill, status: 'submitted' };
  }

  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, 'confirmed');
  return { signature, pda: address, wallet: args.wallet, skillId: args.skill, status: 'confirmed' };
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