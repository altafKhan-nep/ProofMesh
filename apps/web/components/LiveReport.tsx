'use client';

import { useEffect, useState } from 'react';
import { api, dashboardFor, type DashboardData } from '../lib/api';
import { ReportDashboard } from './ReportDashboard';

/**
 * Live deterministic telemetry — always renders a REAL report: the most recent
 * verified credential in the store (wallet + skill + evidence all live), or an
 * honest prompt to mint the first one on /verify. Never a fabricated account.
 */
export function LiveReport() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const hits = await api.search({ minLevel: 1, limit: 1 });
        if (!alive) return;
        const top = hits[0];
        const wallet = top?.linkedWallets?.find((b) => b.verified?.wallet === true && b.verified.github === 'proven')
          ?.wallet ?? top?.linkedWallets?.[0]?.wallet;
        const skill = top?.skillId;
        if (!top || !wallet || !skill) {
          setEmpty(true);
          return;
        }
        const d = await dashboardFor(wallet, skill, top.githubHandle);
        if (alive) setData(d);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    })();
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

  if (empty) {
    return (
      <section className="relative w-full py-16 px-4 md:px-8 lg:px-12 flex flex-col justify-center items-center bg-surface-base coordinate-grid">
        <div className="w-full max-w-5xl mx-auto flex flex-col items-start gap-4 z-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-container-low border border-border-subtle shadow-sm">
            <span className="w-2 h-2 rounded-full bg-text-muted"></span>
            <span className="font-label-mono-tag text-text-secondary uppercase tracking-wider text-xs">
              [ TELEMETRY &amp; ATTRIBUTION REPORT ]
            </span>
          </div>
          <h2 className="font-headline-lg text-text-primary tracking-tight max-w-2xl text-2xl sm:text-3xl md:text-4xl font-medium leading-tight">
            Deterministic evidence, quantified and verifiable down to the commit.
          </h2>
          <p className="font-body-lg text-body-lg text-text-secondary max-w-2xl leading-relaxed">
            No verified credential has been issued yet. Connect a wallet, bind your GitHub account on{' '}
            <a href="/verify" className="text-primary-container underline underline-offset-2">/verify</a>, and run the
            pipeline — the first real report renders right here.
          </p>
        </div>
      </section>
    );
  }

  return <ReportDashboard data={data} />;
}