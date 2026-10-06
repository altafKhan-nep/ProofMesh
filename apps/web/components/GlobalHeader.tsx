'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useWallet } from '../lib/wallet';
import { signInWallet, useAuth } from '../lib/auth';
import { shortAddress } from '../lib/format';

const links = [
  { href: '/verify', label: 'Verification Protocol' },
  { href: '/sponsors', label: 'Registry' },
  { href: '/dev/components', label: 'Documentation' }
];

export function GlobalHeader() {
  const { wallet, walletId, openModal, disconnect, signMessage, error: walletError } = useWallet();
  const { session, signOut } = useAuth();
  const [busy, setBusy] = useState<null | 'in' | 'out'>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  // Keep this header's session in sync when another component signs in/out.
  useEffect(() => {
    const sync = () => setAuthError(null);
    window.addEventListener('proofmesh:session', sync);
    return () => window.removeEventListener('proofmesh:session', sync);
  }, []);

  const handleSignIn = async () => {
    if (!wallet) return;
    setBusy('in');
    setAuthError(null);
    try {
      await signInWallet(wallet, signMessage);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleSignOut = async () => {
    setBusy('out');
    try {
      await signOut();
    } finally {
      setBusy(null);
    }
  };

  return (
    <header className="w-full border-b border-border-subtle bg-surface-card/80 backdrop-blur-sm sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-6 h-6 rounded bg-text-primary flex items-center justify-center text-surface-card font-label-caps text-[11px] tracking-tight group-group-hover:bg-primary-container transition-colors">
            PM
          </div>
          <span className="font-headline-sm text-sm tracking-tight font-semibold text-text-primary">ProofMesh</span>
          <span className="text-xs font-label-mono-tag text-text-muted px-2 py-0.5 rounded border border-border-subtle bg-surface-subtle hidden sm:inline-block">
            v2.4.1
          </span>
        </Link>

        <div className="hidden md:flex items-center space-x-6 text-body-sm text-text-secondary">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-text-primary transition-colors">
              {l.label}
            </Link>
          ))}
          <div className="flex items-center gap-1.5 pl-3 border-l border-border-subtle text-badge-green-text font-label-mono-tag text-xs">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-verified-dot opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-verified-dot"></span>
            </span>
            <span className="tracking-wide">{session ? 'LIVE' : 'SYNCED'}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {session && (
            <span
              className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-label-mono-tag text-[10px] tracking-wider uppercase border ${
                session.role === 'admin'
                  ? 'bg-primary-fixed border-primary-container/40 text-text-primary'
                  : 'bg-surface-container border-border-strong text-text-secondary'
              }`}
              title={`Signed in as ${session.wallet}`}
            >
              {session.role === 'admin' ? 'ADMIN' : 'USER'}
            </span>
          )}

          {wallet ? (
            <>
              <button
                onClick={openModal}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-badge-green-border bg-badge-green-bg font-label-mono-tag text-xs text-badge-green-text hover:bg-badge-green-border transition-colors"
                title={`${walletId} · ${wallet}`}
              >
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-verified-dot opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-verified-dot"></span>
                </span>
                <span className="select-all">{shortAddress(wallet)}</span>
                <span className="text-badge-green-text/70 uppercase text-[9px]">{walletId}</span>
              </button>

              {session ? (
                <button
                  onClick={() => void handleSignOut()}
                  disabled={busy !== null}
                  className="inline-flex items-center px-3 py-2 rounded-lg border border-border-subtle bg-surface-subtle text-text-secondary text-xs font-mono hover:text-error hover:border-error/40 transition-colors disabled:opacity-50"
                >
                  {busy === 'out' ? 'SIGNING OUT…' : 'SIGN OUT'}
                </button>
              ) : (
                <button
                  onClick={() => void handleSignIn()}
                  disabled={busy !== null}
                  className="inline-flex items-center px-3 py-2 rounded-lg bg-primary-container hover:bg-tertiary disabled:opacity-60 text-white text-xs font-mono font-semibold transition-colors shadow-[0_1px_2px_0_rgba(29,93,58,0.2),inset_0_1px_0_rgba(255,255,255,0.15)]"
                >
                  {busy === 'in' ? 'SIGNING…' : 'SIGN IN'}
                </button>
              )}

              <button
                onClick={() => void disconnect()}
                className="inline-flex items-center px-3 py-2 rounded-lg border border-border-subtle bg-surface-subtle text-text-secondary text-xs font-mono hover:text-error hover:border-error/40 transition-colors"
              >
                DISCONNECT
              </button>
            </>
          ) : (
            <button
              onClick={openModal}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-container hover:bg-tertiary text-on-primary text-xs font-semibold font-mono tracking-tight transition-all duration-150 shadow-[0_1px_2px_0_rgba(29,93,58,0.2),inset_0_1px_0_rgba(255,255,255,0.15)] active:scale-[0.98]"
            >
              <span>CONNECT WALLET</span>
              <svg className="w-3.5 h-3.5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {(authError ?? walletError) && (
        <div className="max-w-7xl mx-auto px-6 pb-2 font-label-code text-[11px] text-error">
          {authError ?? walletError}
        </div>
      )}
    </header>
  );
}
