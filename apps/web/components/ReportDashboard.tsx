'use client';

import type { ReactNode } from 'react';
import type { DimensionId } from '@proofmesh/shared-types';
import type { DashboardData } from '../lib/api';
import { barsFromEvidence } from '../lib/constants';

const DIM_LABELS: Record<DimensionId, string> = {
  architecture: '01. Code Architecture & Modularity',
  quality: '02. Peer Review Acceptance & Consensus',
  consistency: '03. Cross-Repository Impact',
  security: '04. Vulnerability & Security Clearance',
  testing: '05. Maintainer Retention & Stability'
};

const DIM_ORDER: DimensionId[] = ['architecture', 'quality', 'consistency', 'security', 'testing'];

function shortId(id: string, head = 5, tail = 4): string {
  return id.length <= head + tail + 3 ? id : `${id.slice(0, head)}…${id.slice(-tail)}`;
}

function TimeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.max(1, Math.round(ms / 60000));
  return mins < 60 ? `Audited ${mins} min${mins === 1 ? '' : 's'} ago` : `Audited ${Math.round(mins / 60)}h ago`;
}

function Bar({ label, pct }: { label: string; pct: number }) {
  const v = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex justify-between items-baseline">
        <span className="font-body-md text-text-primary text-sm font-medium">{label}</span>
        <span className="font-label-code text-xs font-semibold text-text-primary">{v}%</span>
      </div>
      <div className="w-full h-2 rounded-full bg-[#EBE9E1] overflow-hidden">
        <div className="h-full bg-primary-container rounded-full" style={{ width: `${v}%` }}></div>
      </div>
    </div>
  );
}

function EvidenceRow({ children, type }: { children: ReactNode; type: string }) {
  return (
    <div className="p-3.5 rounded-lg bg-surface-container-low border border-border-subtle flex flex-col sm:flex-row sm:items-start justify-between gap-3 hover:border-border-strong transition-colors">
      <div className="flex items-start gap-3">
        <span className="w-5 h-5 mt-0.5 flex-shrink-0 text-primary-container">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="6" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
        </span>
        <p className="font-body-sm text-text-primary leading-relaxed">{children}</p>
      </div>
      <span className="font-label-mono-tag text-[10px] px-2 py-0.5 rounded bg-surface-card border border-border-subtle text-text-secondary shrink-0 self-start">
        {type}
      </span>
    </div>
  );
}

export function ReportDashboard({ data }: { data: DashboardData | null }) {
  if (!data) {
    return (
      <div className="w-full max-w-5xl mx-auto">
        <div className="w-full bg-surface-card rounded-xl border border-border-strong shadow-[0_4px_24px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] overflow-hidden animate-pulse">
          <div className="px-6 py-4 bg-surface-subtle border-b border-border-subtle h-14" />
          <div className="p-6 md:p-8 space-y-6">
            <div className="h-32 bg-surface-container rounded-lg" />
            <div className="h-4 bg-surface-container rounded" />
            <div className="h-4 bg-surface-container rounded" />
          </div>
        </div>
      </div>
    );
  }

  const dims = data.dimensions?.length
    ? DIM_ORDER.map((d) => {
        const s = data.dimensions!.find((x) => x.dimension === d);
        return { label: DIM_LABELS[d], pct: s ? s.score : 0 };
      })
    : barsFromEvidence(data.evidence, data.repos.length);

  const positive = data.evidence.filter((e) => e.positive);
  const citations = positive.slice(0, 4);
  const conf = data.confidence;
  const sigma = ((conf / 100) * 1.0).toFixed(2);
  const ringTrack = 201.06;
  const ringFrac = Math.max(0, Math.min(1, conf / 100));

  return (
    <section className="relative w-full py-16 px-4 md:px-8 lg:px-12 flex flex-col justify-center items-center bg-surface-base coordinate-grid">
      <div className="w-full max-w-5xl mx-auto flex flex-col items-start gap-8 z-10">
        <div className="flex flex-col gap-3">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-container-low border border-border-subtle shadow-sm">
            <span className={`w-2 h-2 rounded-full animate-pulse ${data.verified ? 'bg-verified-dot' : 'bg-text-muted'}`}></span>
            <span className="font-label-mono-tag text-text-secondary uppercase tracking-wider text-xs">
              [ TELEMETRY &amp; ATTRIBUTION REPORT ]
            </span>
          </div>
          <h2 className="font-headline-lg text-text-primary tracking-tight max-w-2xl text-2xl sm:text-3xl md:text-4xl font-medium leading-tight">
            Deterministic evidence, quantified and verifiable down to the commit.
          </h2>
        </div>

        <div className="w-full bg-surface-card rounded-xl border border-border-strong shadow-[0_4px_24px_rgba(0,0,0,0.04),0_1px_2px_rgba(0,0,0,0.02)] overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-4 bg-surface-subtle border-b border-border-subtle">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 pr-2 border-r border-border-strong">
                <span className="w-2.5 h-2.5 rounded-full bg-border-strong inline-block"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-border-strong inline-block"></span>
                <span className="w-2.5 h-2.5 rounded-full bg-border-strong inline-block"></span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-text-muted text-base">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 21h8M12 17v4M6 4h12v6a6 6 0 0 1-12 0V4z" />
                  </svg>
                </span>
                <span className="font-label-code text-xs md:text-sm text-text-primary font-medium tracking-tight">
                  github.com/{data.handle} · {data.githubUsername}
                </span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2.5 font-label-mono-tag text-xs">
              {data.verified ? (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-badge-green-bg border border-badge-green-border text-primary-container font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-verified-dot"></span>
                  <span>VERIFIED ON-CHAIN</span>
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-surface-container border border-border-strong text-text-secondary font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-text-muted"></span>
                  <span>NO CREDENTIAL MINTED</span>
                </div>
              )}
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-surface-card border border-border-subtle text-text-secondary hover:text-text-primary transition-colors">
                <span>TX: {shortId(data.attestationAddress)}</span>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4M14 4h6m0 0v6m0-6L10 14" />
                </svg>
              </span>
              <span className="text-text-muted hidden sm:inline-block">{TimeAgo(data.issuedAt)}</span>
            </div>
          </div>

          <div className="p-6 md:p-8 flex flex-col gap-8">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-6 p-6 rounded-lg bg-surface-subtle border border-border-subtle">
              <div className="md:col-span-6 flex flex-col justify-center border-b md:border-b-0 md:border-r border-border-subtle pb-6 md:pb-0 md:pr-6">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-label-caps text-text-muted uppercase text-xs">AGGREGATED SKILL INDEX · {data.skillLabel}</span>
                  <svg className="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 16v-4m0-4h.01" />
                  </svg>
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="font-display text-4xl sm:text-5xl font-medium tracking-tight text-text-primary">{data.score.toFixed(1)}</span>
                  <span className="font-label-code text-text-muted text-lg">/ 100</span>
                </div>
                <div className="flex items-center gap-2 mt-2 font-label-code text-xs text-badge-green-text">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <span>
                    {data.levelLabel} · Cohort #{data.repos.length}
                  </span>
                </div>
              </div>

              <div className="md:col-span-6 flex items-center justify-between gap-6 pl-0 md:pl-4">
                <div className="flex flex-col gap-1">
                  <span className="font-label-caps text-text-muted uppercase text-xs">STATISTICAL CONFIDENCE</span>
                  <div className="flex items-center gap-2">
                    <span className="font-headline-md text-2xl sm:text-3xl font-semibold text-text-primary">{conf.toFixed(1)}%</span>
                    <span className="px-2 py-0.5 rounded bg-surface-container text-text-secondary font-label-mono-tag text-xs">
                      {conf >= 0.85 ? 'HIGH DEGREE' : conf >= 0.6 ? 'MODERATE DEGREE' : 'LOW DEGREE'}
                    </span>
                  </div>
                  <p className="font-label-code text-xs text-text-muted mt-1">Entropy Model v2.4 · p-val &lt; 0.001</p>
                </div>
                <div className="relative flex-shrink-0 w-20 h-20 flex items-center justify-center">
                  <svg className="w-20 h-20 -rotate-90 transform" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" fill="transparent" r="32" stroke="#EBE9E1" strokeWidth="6"></circle>
                    <circle
                      cx="40"
                      cy="40"
                      fill="transparent"
                      r="32"
                      stroke="#1D5D3A"
                      strokeDasharray={ringTrack}
                      strokeDashoffset={ringTrack * (1 - ringFrac)}
                      strokeLinecap="round"
                      strokeWidth="6"
                    ></circle>
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="font-label-caps text-[10px] text-text-muted">σ</span>
                    <span className="font-label-mono-tag text-[10px] font-bold text-primary-container">{sigma}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-border-subtle pb-2">
                <h3 className="font-label-caps text-xs text-text-primary uppercase tracking-wider font-semibold">
                  DIMENSIONAL COMPETENCY VECTOR
                </h3>
                <span className="font-label-mono-tag text-xs text-text-muted">5 VECTORS AUDITED</span>
              </div>
              <div className="flex flex-col gap-4">
                {dims.map((d) => (
                  <Bar key={d.label} label={d.label} pct={d.pct} />
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-3 pt-2">
              <div className="flex items-center justify-between border-b border-border-subtle pb-2">
                <h4 className="font-label-caps text-xs text-text-muted uppercase tracking-wider font-semibold">
                  PRIMARY EVIDENCE CITATIONS ({positive.length} RECORDED)
                </h4>
                <span className="font-label-mono-tag text-xs text-primary-container">{data.analyzerVersion}</span>
              </div>
              <div className="flex flex-col gap-2.5">
                {citations.map((e) => (
                  <EvidenceRow key={e.id} type={e.type}>
                    {e.description}{' '}
                    {e.sourceIdentifier && (
                      <span className="font-label-code text-xs font-medium text-text-primary">{e.sourceIdentifier}</span>
                    )}
                  </EvidenceRow>
                ))}
              </div>
            </div>
          </div>

          <div className="px-6 py-3 bg-surface-container-low border-t border-border-subtle flex flex-wrap items-center justify-between gap-2 font-label-code text-[11px] text-text-muted">
            <div className="flex items-center gap-2">
              <svg className="w-3.5 h-3.5 text-badge-green-text" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              <span>
                Solana Ledger Attestation: Program ID: <span className="text-text-secondary">{shortId(data.issuerAddress, 8, 4)}</span> · State Verified
              </span>
            </div>
            <div className="truncate max-w-full">
              <span className="text-text-secondary">SHA-256 Merkle Root:</span> {shortId(data.evidenceRoot, 16, 8)}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}