'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AuthRole } from '@proofmesh/shared-types';
import { api } from './api';

const SESSION_KEY = 'proofmesh.session';

export interface Session {
  token: string;
  wallet: string;
  role: AuthRole;
  expiresAt: string;
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
 *   2. sign the EXACT message bytes with the connected wallet (ed25519)
 *   3. verify     -> { token, wallet, role }
 * The token is only ever sent in the `Authorization: Bearer` header.
 */
export async function signInWallet(
  wallet: string,
  sign: (message: string) => Promise<string>
): Promise<Session> {
  const challenge = await api.authChallenge(wallet);
  const signature = await sign(challenge.message);
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