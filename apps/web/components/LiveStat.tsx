'use client';

import { useEffect, useState } from 'react';
import type { NetworkStats } from '@proofmesh/shared-types';
import { api } from '../lib/api';

export function formatStat(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  return value.toLocaleString();
}

/** Fetch live network figures from /api/stats once on mount. */
function useNetworkStats(): NetworkStats | null {
  const [stats, setStats] = useState<NetworkStats | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .stats()
      .then((s) => alive && setStats(s))
      .catch(() => {
        /* offline → honest "—" fallback copy */
      });
    return () => {
      alive = false;
    };
  }, []);
  return stats;
}

/** Render one live network figure with an honest "—" fallback. */
export function LiveStat({ metric, suffix = '' }: { metric: keyof NetworkStats; suffix?: string }) {
  const stats = useNetworkStats();
  const value = stats?.[metric];
  if (typeof value !== 'number') return <span>—</span>;
  return (
    <span>
      {formatStat(value)}
      {suffix}
    </span>
  );
}