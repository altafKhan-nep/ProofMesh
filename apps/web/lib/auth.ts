'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AuthRole } from '@proofmesh/shared-types';
import { api } from './api';

/** UI mirror of the session. The credential itself is an httpOnly cookie. */
export interface Session {
  wallet: string;
  role: AuthRole;
  expiresAt: string;
}

function notify(): void {
  try {
    window.dispatchEvent(new Event('proofmesh:session'));
  } catch {
    /* noop */
  }
}

export async function signInWallet(
  wallet: string,
  sign: (message: string) => Promise<string>
): Promise<Session> {
  const challenge = await api.authChallenge(wallet);
  const signature = await sign(challenge.message);
  // The API sets an httpOnly session cookie; the token is NOT stored in
  // localStorage, so an XSS cannot exfiltrate a long-lived credential.
  const { role, expiresAt } = await api.authVerify({ wallet, message: challenge.message, signature });
  const session: Session = { wallet, role, expiresAt };
  notify();
  return session;
}

/**
 * Session state for the UI. The credential itself lives in an httpOnly cookie;
 * this hook only mirrors non-sensitive display data and revalidates against
 * `GET /api/auth/me` (which reads the cookie).
 */
export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const sync = async () => {
      try {
        const me = await api.authMe();
        if (alive) setSession({ wallet: me.wallet, role: me.role, expiresAt: me.expiresAt });
      } catch {
        if (alive) setSession(null);
      } finally {
        if (alive) setLoading(false);
      }
    };
    void sync();
    window.addEventListener('proofmesh:session', sync);
    window.addEventListener('proofmesh:wallet', sync);
    return () => {
      alive = false;
      window.removeEventListener('proofmesh:session', sync);
      window.removeEventListener('proofmesh:wallet', sync);
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const me = await api.authMe();
      const next: Session = { wallet: me.wallet, role: me.role, expiresAt: me.expiresAt };
      setSession(next);
      return next;
    } catch {
      setSession(null);
      return null;
    }
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.authLogout();
    } catch {
      /* cookie already invalid server-side */
    }
    setSession(null);
    notify();
  }, []);

  return {
    session,
    loading,
    isAdmin: session?.role === 'admin',
    signIn: signInWallet,
    refresh,
    signOut
  };
}
