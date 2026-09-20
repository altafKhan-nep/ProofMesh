'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { GlobalHeader } from '@/components/GlobalHeader';
import { GlobalFooter } from '@/components/GlobalFooter';
import { ReportDashboard } from '@/components/ReportDashboard';
import { dashboardFor, type DashboardData } from '@/lib/api';
import { skillLabel } from '@/lib/constants';

export default function PublicReportPage() {
  const params = useParams<{ wallet: string; skill: string }>();
  const wallet = params.wallet ?? '';
  const skill = params.skill ?? '';
  const [data, setData] = useState<DashboardData | null>(null);
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!wallet || !skill) return;
    let alive = true;
    setState('loading');
    dashboardFor(wallet, skill)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setState('done');
      })
      .catch((e) => {
        if (!alive) return;
        setMessage(e instanceof Error ? e.message : String(e));
        setState('error');
      });
    return () => {
      alive = false;
    };
  }, [wallet, skill]);

  return (
    <div className="flex flex-col min-h-screen">
      <GlobalHeader />
      <main className="flex-1">
        <ReportDashboard data={state === 'done' ? data : null} />
        {state === 'error' && (
          <section className="w-full max-w-5xl mx-auto px-6 pb-16 text-center">
            <div className="p-6 rounded-xl border border-border-strong bg-surface-card shadow-soft-card font-label-code text-xs text-text-muted">
              <span className="text-text-secondary">Credential not found for</span> {skillLabel(skill)}{' '}
              <span className="select-all">{wallet}</span> — <span className="text-error">{message}</span>.
              <div className="mt-4">
                <Link href="/verify" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-container hover:bg-tertiary text-white text-xs font-semibold font-mono transition-colors">
                  <span>RUN VERIFICATION</span>
                  <span>→</span>
                </Link>
              </div>
            </div>
          </section>
        )}
        {state === 'done' && data && (
          <section className="w-full max-w-5xl mx-auto px-6 pb-16 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3 font-label-code text-xs text-text-muted">
              <img
                alt="ProofMesh credential badge"
                width={320}
                height={96}
                src={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/badge/${wallet}/${skill}.svg`}
                className="rounded-lg border border-border-subtle bg-surface-card"
              />
              <div className="max-w-sm space-y-1">
                <div className="font-label-caps text-[10px] uppercase tracking-wider text-text-muted">Public verify badge</div>
                <p className="text-text-secondary">
                  {data.skillLabel} credential — verified on-chain. Verified by the shared verifier SDK with constraints
                  minScore 0, minConfidence 0.
                </p>
              </div>
            </div>
            <Link
              href="/verify"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-card border border-border-subtle text-text-primary hover:bg-surface-subtle text-xs font-semibold font-mono transition-colors shadow-soft-card"
            >
              <span>VERIFY ANOTHER</span>
              <span>↗</span>
            </Link>
          </section>
        )}
        {state === 'loading' && (
          <section className="w-full max-w-5xl mx-auto px-6 pb-16 text-center font-label-code text-xs text-text-muted">
            Resolving attestation for <span className="select-all">{wallet}</span> / {skillLabel(skill)}…
          </section>
        )}
      </main>
      <GlobalFooter />
    </div>
  );
}