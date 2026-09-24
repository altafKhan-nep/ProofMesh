'use client';

import { useCallback, useEffect, useState } from 'react';
import { ed25519 } from '@noble/curves/ed25519.js';
import { Keypair, PublicKey } from '@solana/web3.js';
import type { AuthRole } from '@proofmesh/shared-types';
import { api } from './api';

const SESSION_KEY = 'proofmesh.session';

export interface Session {
  token: string;
  wallet: string;
  role: AuthRole;
  expiresAt: string;
}

export interface WalletSigner {
  wallet: string;
  sign: (message: string) => Promise<string>;
}

/** Minimal surface of the injected Solana provider (Phantom / Backpack / window.solana). */
export interface SolanaProvider {
  publicKey?: { toBytes(): Uint8Array; toString(): string };
  signMessage?: (
    message: Uint8Array,
    encoding?: 'utf8' | 'hex' | 'base64'
  ) => Promise<{ signature: Uint8Array } | Uint8Array>;
}

declare global {
  interface Window {
    solana?: SolanaProvider;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const digest = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return new Uint8Array(digest);
}

/**
 * Deterministic demo signer (Epic-2 demo posture): a fixed seed derives an
 * ed25519 keypair whose base58 address is the "wallet". Set ADMIN_WALLETS on
 * the API to this address to get the admin console. Replace with a real wallet
 * adapter in production — signInWallet works with any signer above.
 */
const DEMO_SEED = 'proofmesh-demo-admin:v1';

export async function demoSigner(): Promise<WalletSigner> {
  const seed = await sha256Bytes(DEMO_SEED);
  const kp = Keypair.fromSeed(seed);
  return {
    wallet: kp.publicKey.toBase58(),
    sign: async (message: string) => {
      const sig = ed25519.sign(new TextEncoder().encode(message), kp.secretKey.slice(0, 32));
      return bytesToBase64(sig);
    }
  };
}

/** Real-wallet signer when window.solana is present with a connected key + signMessage. */
export function providerSigner(provider: SolanaProvider): WalletSigner | null {
  const pub = provider.publicKey;
  const signMessage = provider.signMessage;
  if (!pub || typeof signMessage !== 'function') return null;
  const wallet = (pub as { toBase58?(): string }).toBase58?.() ?? new PublicKey(pub.toBytes()).toBase58();
  return {
    wallet,
    sign: async (message: string) => {
      const bytes = new TextEncoder().encode(message);
      const res = await signMessage.call(provider, bytes, 'utf8');
      const sig = Array.isArray(res) ? (res as Uint8Array) : (res as { signature: Uint8Array }).signature;
      return bytesToBase64(sig);
    }
  };
}

/** Best available signer: injected extension wallet first, demo keypair fallback. */
export async function getBestSigner(): Promise<WalletSigner> {
  if (typeof window !== 'undefined' && window.solana) {
    const real = providerSigner(window.solana);
    if (real) return real;
  }
  return demoSigner();
}

function persist(session: Session): void {
  try {
    window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* storage unavailable */
  }
}

function readStored(): Session | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    if (!session.token || !session.wallet) return null;
    return session;
  } catch {
    return null;
  }
}

function clearStored(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable */
  }
}

function notify(): void {
  try {
    window.dispatchEvent(new Event('proofmesh:session'));
  } catch {
    /* noop */
  }
}

/**
 * SIWS sign-in per the API contract:
 *   1. challenge  -> { message, nonce }
 *   2. sign the EXACT message bytes (ed25519)
 *   3. verify     -> { token, wallet, role }
 * Token lives only in the caller's `Authorization: Bearer` header.
 */
export async function signInWallet(wallet: string, signer: WalletSigner): Promise<Session> {
  if (signer.wallet !== wallet) {
    throw new Error(`Signer is ${signer.wallet.slice(0, 6)}… — sign with the wallet you claim.`);
  }
  const challenge = await api.authChallenge(wallet);
  const signature = await signer.sign(challenge.message);
  const { token, role, expiresAt } = await api.authVerify({ wallet, message: challenge.message, signature });
  const session = { token, wallet, role, expiresAt };
  persist(session);
  notify();
  return session;
}

/** Same-tab + cross-tab session hook, matching useWallet's per-component pattern. */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    setSession(readStored());
    const onStorage = () => setSession(readStored());
    const onNotify = () => setSession(readStored());
    window.addEventListener('storage', onStorage);
    window.addEventListener('proofmesh:session', onNotify);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('proofmesh:session', onNotify);
    };
  }, []);

  const refresh = useCallback(async () => {
    const stored = readStored();
    if (!stored) return null;
    try {
      const me = await api.authMe(stored.token);
      const next = { ...stored, role: me.role, expiresAt: me.expiresAt };
      persist(next);
      setSession(next);
      return next;
    } catch {
      clearStored();
      setSession(null);
      return null;
    }
  }, []);

  const signOut = useCallback(async () => {
    const stored = readStored();
    if (stored) {
      try {
        await api.authLogout(stored.token);
      } catch {
        /* token already invalid server-side */
      }
    }
    clearStored();
    setSession(null);
    notify();
  }, []);

  return {
    session,
    isAdmin: session?.role === 'admin',
    signIn: signInWallet,
    refresh,
    signOut
  };
}