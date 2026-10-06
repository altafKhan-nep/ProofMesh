'use client';

import { useSyncExternalStore } from 'react';
import { DEMO_WALLET_ENABLED } from './demo-signer';

const STORAGE_KEY = 'proofmesh.wallet';

/** The slice of the injected-provider API we rely on (Phantom / Backpack / Solflare). */
export interface SolanaProvider {
  isPhantom?: boolean;
  publicKey?: { toBytes(): Uint8Array; toString(): string };
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<unknown>;
  disconnect: () => Promise<unknown>;
  signMessage: (
    message: Uint8Array,
    display?: 'utf8' | 'hex'
  ) => Promise<{ signature: Uint8Array } | Uint8Array>;
}

declare global {
  interface Window {
    phantom?: { solana?: SolanaProvider };
    solana?: SolanaProvider;
    backpack?: SolanaProvider;
    solflare?: SolanaProvider;
  }
}

export interface WalletOption {
  id: string;
  name: string;
  installed: boolean;
  provider?: SolanaProvider;
}

export interface WalletState {
  address: string | null;
  walletId: string | null;
  connecting: boolean;
  error: string | null;
  modalOpen: boolean;
}

// ---------------------------------------------------------------------------
// Shared store: the header, the verify flow and the modal are separate
// components, so connection state must be a single source of truth rather than
// per-hook copies. useSyncExternalStore keeps them in sync without a provider.
// ---------------------------------------------------------------------------

function hydrate(): WalletState {
  const base: WalletState = { address: null, walletId: null, connecting: false, error: null, modalOpen: false };
  if (typeof window === 'undefined') return base;
  try {
    const address = window.localStorage.getItem(STORAGE_KEY);
    const walletId = window.localStorage.getItem(`${STORAGE_KEY}.id`);
    if (address && walletId) return { ...base, address, walletId };
  } catch {
    /* storage unavailable */
  }
  return base;
}

let state: WalletState = hydrate();
const listeners = new Set<() => void>();

/**
 * SSR/hydration-safe snapshot: wallet state only exists client-side (injected
 * providers + localStorage), so the server and the first client render must
 * agree on the *empty* state. After hydration we re-read `getSnapshot` and
 * re-render with the real wallet if one is connected.
 */
const SERVER_SNAPSHOT: WalletState = {
  address: null,
  walletId: null,
  connecting: false,
  error: null,
  modalOpen: false
};

function setState(patch: Partial<WalletState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = (): WalletState => state;
const getServerSnapshot = (): WalletState => SERVER_SNAPSHOT;

// ---------------------------------------------------------------------------

/** Detected browser wallets, in preference order. Demo key is opt-in (env). */
export function detectWallets(): WalletOption[] {
  if (typeof window === 'undefined') return [];
  const found: WalletOption[] = [];
  const phantom = window.phantom?.solana ?? (window.solana?.isPhantom ? window.solana : undefined);
  if (phantom) found.push({ id: 'phantom', name: 'Phantom', installed: true, provider: phantom });
  if (window.backpack) found.push({ id: 'backpack', name: 'Backpack', installed: true, provider: window.backpack });
  if (window.solflare && window.solflare !== phantom) found.push({ id: 'solflare', name: 'Solflare', installed: true, provider: window.solflare });
  if (DEMO_WALLET_ENABLED) found.push({ id: 'demo', name: 'Demo key (no extension)', installed: true });
  return found;
}

function persist(address: string | null, walletId: string | null): void {
  try {
    if (address && walletId) {
      window.localStorage.setItem(STORAGE_KEY, address);
      window.localStorage.setItem(`${STORAGE_KEY}.id`, walletId);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(`${STORAGE_KEY}.id`);
    }
  } catch {
    /* storage unavailable */
  }
}

export async function connectWallet(id: string): Promise<void> {
  setState({ error: null, connecting: true, modalOpen: false });
  try {
    if (id === 'demo') {
      const { demoKeypair } = await import('./demo-signer');
      const address = (await demoKeypair()).publicKey.toBase58();
      persist(address, 'demo');
      setState({ address, walletId: 'demo' });
      return;
    }
    const option = detectWallets().find((w) => w.id === id);
    if (!option?.provider) throw new Error(`${id} is not installed`);
    await option.provider.connect();
    const pub = option.provider.publicKey;
    if (!pub) throw new Error('Wallet connected without exposing a public key');
    const alreadyBase58 = (pub as { toBase58?(): string }).toBase58?.();
    const { PublicKey } = await import('@solana/web3.js');
    const address = alreadyBase58 ?? new PublicKey(pub.toBytes()).toBase58();
    persist(address, id);
    setState({ address, walletId: id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setState({ error: /reject/i.test(message) ? 'Connection rejected in wallet' : message });
    throw err;
  } finally {
    setState({ connecting: false });
  }
}

export async function disconnectWallet(): Promise<void> {
  const option = state.walletId ? detectWallets().find((w) => w.id === state.walletId) : undefined;
  try {
    // Extensions may refuse programmatic disconnect; local state clears regardless.
    await option?.provider?.disconnect();
  } catch {
    /* wallet kept its own session; we still forget it locally */
  }
  persist(null, null);
  setState({ address: null, walletId: null, error: null });
}

/** Sign the exact message bytes with the connected wallet; returns base64. */
export async function signWithWallet(message: string): Promise<string> {
  const bytes = new TextEncoder().encode(message);
  if (state.walletId === 'demo') {
    const { signDemo } = await import('./demo-signer');
    return signDemo(message);
  }
  const option = state.walletId ? detectWallets().find((w) => w.id === state.walletId) : undefined;
  if (!option?.provider) throw new Error('No wallet connected');
  const res = await option.provider.signMessage(bytes, 'utf8');
  const sig = res instanceof Uint8Array ? res : res.signature;
  let binary = '';
  for (let i = 0; i < sig.length; i++) binary += String.fromCharCode(sig[i]);
  return btoa(binary);
}

// Stable action identities: module-level functions so subscribers do not get a
// fresh closure on every state change (only the values re-render).
function openWalletModal(): void {
  setState({ modalOpen: true, error: null });
}
function closeWalletModal(): void {
  setState({ modalOpen: false });
}
function clearWalletError(): void {
  setState({ error: null });
}

/** Shared wallet state + actions for every component. */
export function useWallet() {
  const s = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return {
    wallet: s.address,
    walletId: s.walletId,
    connecting: s.connecting,
    error: s.error,
    modalOpen: s.modalOpen,
    openModal: openWalletModal,
    closeModal: closeWalletModal,
    clearError: clearWalletError,
    connect: connectWallet,
    disconnect: disconnectWallet,
    signMessage: signWithWallet
  };
}