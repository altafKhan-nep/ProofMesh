'use client';

import { useEffect, useState } from 'react';
import { dashboardFor, type DashboardData } from '../lib/api';
import { ReportDashboard } from './ReportDashboard';

const ALEXANDER_WALLET = '7xGqYtRZLJ4XZiQn69NCHsWkY1mTVMLqmLX4m3md8DwzF3';

/** Live deterministic telemetry — fetches the seeded attestation report from the API. */
export function LiveReport() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    dashboardFor(ALEXANDER_WALLET, 'solana-anchor', 'alexander-vance')
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <section className="w-full py-16 text-center">
        <p className="font-label-code text-xs text-text-muted">
          API offline ({error}). Start the backend with <span className="text-text-secondary">pnpm dev:api</span>.
        </p>
      </section>
    );
  }

  return <ReportDashboard data={data} />;
}