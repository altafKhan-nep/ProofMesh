'use client';

import { ed25519 } from '@noble/curves/ed25519.js';
import { Keypair } from '@solana/web3.js';

/**
 * Deterministic local signer so the protocol is fully testable without an
 * extension. Only reachable when NEXT_PUBLIC_DEMO_WALLET=1 (production builds
 * never include the eager web3.js/ed25519 bundle — this module is loaded
 * lazily only for the demo path).
 */
const DEMO_KEY = 'proofmesh-demo-admin:v1';

export const DEMO_WALLET_ENABLED = process.env.NEXT_PUBLIC_DEMO_WALLET === '1';

export async function demoKeypair(): Promise<Keypair> {
  const seed = new Uint8Array(
    await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(DEMO_KEY))
  );
  return Keypair.fromSeed(seed);
}

/** Sign the exact message bytes with the demo admin key; returns base64. */
export async function signDemo(message: string): Promise<string> {
  const kp = await demoKeypair();
  const bytes = new TextEncoder().encode(message);
  let binary = '';
  const sig = ed25519.sign(bytes, kp.secretKey.slice(0, 32));
  for (let i = 0; i < sig.length; i++) binary += String.fromCharCode(sig[i]);
  return btoa(binary);
}