'use client';

import Link from 'next/link';
import { useWallet } from '../lib/wallet';

const links = [
  { href: '/verify', label: 'Verification Protocol' },
  { href: '/sponsors', label: 'Registry' },
  { href: '/dev/components', label: 'Documentation' }
];

function shortWallet(w: string): string {
  return w.length > 16 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w;
}

export function GlobalHeader() {
  const { wallet, disconnect } = useWallet();

  return (
    <header className="w-full border-b border-border-subtle bg-surface-card/80 backdrop-blur-sm sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-6 h-6 rounded bg-text-primary flex items-center justify-center text-surface-card font-label-caps text-[11px] tracking-tight group-hover:bg-primary-container transition-colors">
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
            <span className="tracking-wide">{wallet ? 'LIVE' : 'SYNCED'}</span>
          </div>
        </div>

        {wallet ? (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-badge-green-border bg-badge-green-bg font-label-mono-tag text-xs text-badge-green-text">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-verified-dot opacity-75"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-verified-dot"></span>
              </span>
              <span className="select-all">{shortWallet(wallet)}</span>
            </div>
            <button
              onClick={disconnect}
              className="inline-flex items-center px-3 py-2 rounded-lg border border-border-subtle bg-surface-subtle text-text-secondary text-xs font-mono hover:text-error hover:border-error/40 transition-colors"
            >
              DISCONNECT
            </button>
          </div>
        ) : (
          <Link
            href="/verify"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-container hover:bg-tertiary text-on-primary text-xs font-semibold font-mono tracking-tight transition-all duration-150 shadow-[0_1px_2px_0_rgba(29,93,58,0.2),inset_0_1px_0_rgba(255,255,255,0.15)] active:scale-[0.98]"
          >
            <span>CONNECT WALLET</span>
            <svg className="w-3.5 h-3.5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </Link>
        )}
      </div>
    </header>
  );
}