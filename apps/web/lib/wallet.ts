'use client';

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'proofmesh.wallet';

/** Persistent connected-wallet state shared across header + verify flow. */
export function useWallet() {
  const [wallet, setWallet] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setWallet(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const connect = useCallback((address: string) => {
    const trimmed = address.trim();
    if (!trimmed) return;
    setWallet(trimmed);
    try {
      window.localStorage.setItem(STORAGE_KEY, trimmed);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const disconnect = useCallback(() => {
    setWallet(null);
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
  }, []);

  return { wallet, connect, disconnect };
}