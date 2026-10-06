'use client';

import dynamic from 'next/dynamic';

/**
 * Client-side lazy wallet modal: keeps the Solana SDK out of the initial
 * server-components bundle until the user actually connects a wallet.
 */
export const LazyWalletModal = dynamic(() => import('./WalletModal').then((m) => m.WalletModal), {
  ssr: false
});