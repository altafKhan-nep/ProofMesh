'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/** Live embeddable-badge example — shows the most recent REAL verified credential
 * (real wallet + real skill), or an honest empty state until one exists. */
export function BadgeExample() {
  const [src, setSrc] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'found' | 'empty'>('loading');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const hits = await api.search({ minLevel: 1, limit: 1 });
        if (!alive) return;
        const top = hits[0];
        const wallet = top?.linkedWallets?.find(
          (b) => b.verified?.wallet === true && b.verified.github === 'proven'
        )?.wallet ?? top?.linkedWallets?.[0]?.wallet;
        const skill = top?.skillId;
        if (top && wallet && skill) {
          setSrc(api.badge(wallet, skill));
          setState('found');
        } else {
          setState('empty');
        }
      } catch {
        if (alive) setState('empty');
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (state === 'found' && src) {
    return (
      <img
        alt="ProofMesh credential badge"
        width={320}
        height={96}
        src={src}
        className="rounded-lg border border-border-subtle bg-surface-card"
      />
    );
  }
  if (state === 'loading') {
    return <div className="w-[320px] h-[96px] rounded-lg border border-border-subtle bg-surface-card animate-pulse" />;
  }
  return (
    <div className="w-[320px] h-[96px] rounded-lg border border-dashed border-border-subtle bg-surface-card flex flex-col items-center justify-center gap-1 text-center px-4">
      <span className="font-label-mono-tag text-[10px] text-text-muted uppercase tracking-wider">
        NO CREDENTIAL ISSUED YET
      </span>
      <span className="font-label-code text-[10px] text-text-secondary">
        Run the pipeline on{' '}
        <a href="/verify" className="text-primary-container underline underline-offset-2">
          /verify
        </a>{' '}
        to mint the first real badge.
      </span>
    </div>
  );
}