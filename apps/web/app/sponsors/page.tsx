'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import type { CandidateDeveloper, Listing } from '@proofmesh/shared-types';
import { api } from '../../lib/api';
import { SKILL_OPTIONS, skillLabel } from '../../lib/constants';
import { GlobalHeader } from '../../components/GlobalHeader';
import { GlobalFooter } from '../../components/GlobalFooter';

function LevelChip({ level }: { level?: number }) {
  if (!level) return <span className="font-label-mono-tag text-[10px] px-1.5 py-0.5 rounded bg-surface-container border border-border-strong text-text-muted">NOT YET</span>;
  const labels: Record<number, { t: string; c: string }> = {
    1: { t: 'L1 · Verified', c: 'text-badge-green-text bg-badge-green-bg border-badge-green-border' },
    2: { t: 'L2 · Strong', c: 'text-badge-green-text bg-badge-green-bg border-badge-green-border' },
    3: { t: 'L3 · Expert', c: 'text-text-primary bg-primary-fixed border-primary-container/40' }
  };
  const l = labels[level];
  return <span className={`font-label-mono-tag text-[10px] px-1.5 py-0.5 rounded border ${l.c}`}>{l.t}</span>;
}

export default function SponsorsPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [results, setResults] = useState<CandidateDeveloper[]>([]);
  const [skill, setSkill] = useState('solana-anchor');
  const [minScore, setMinScore] = useState(60);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [selectedListing, setSelectedListing] = useState<string>('');

  useEffect(() => {
    api.listings().then(setListings).catch(() => setListings([]));
  }, []);

  const search = useCallback(async () => {
    setSearching(true);
    setNotice(null);
    try {
      const res = await api.search({ skills: [skill], minScore });
      setResults(res);
    } catch (e) {
      setNotice({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSearching(false);
    }
  }, [skill, minScore]);

  useEffect(() => {
    void search();
  }, [search]);

  const invite = async (handle: string) => {
    if (!selectedListing) {
      setNotice({ kind: 'err', text: 'Select a listing to invite from.' });
      return;
    }
    try {
      await api.post('/api/invite', { listingId: selectedListing, githubHandle: handle });
      setNotice({ kind: 'ok', text: `Invite sent to @${handle}` });
    } catch (e) {
      setNotice({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const genLink = async (id: string) => {
    try {
      const { listing } = await api.post<{ listing: Listing }>(`/api/listings/${id}/verified-link`, {});
      setListings((prev) => prev.map((l) => (l.id === id ? listing : l)));
      setNotice({ kind: 'ok', text: `Verified link generated: ${listing.inviteUrl ?? ''}` });
    } catch (e) {
      setNotice({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="flex flex-col min-h-screen">
      <GlobalHeader />
      <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-14">
        <div className="flex flex-col gap-3 mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-container-low border border-border-subtle shadow-sm self-start">
            <span className="w-2 h-2 rounded-full bg-verified-dot animate-pulse"></span>
            <span className="font-label-mono-tag text-text-secondary uppercase tracking-wider text-xs">
              [ SPONSOR CONSOLE — DETERMINISTIC HIRING INDEX ]
            </span>
          </div>
          <h1 className="font-headline-lg text-3xl sm:text-4xl text-text-primary tracking-tight font-medium max-w-2xl leading-tight">
            Find engineers with on-chain proof of skill.
          </h1>
          <p className="font-body-lg text-body-lg text-text-secondary max-w-2xl leading-relaxed">
            Every candidate below carries a deterministic, on-chain credential derived from GitHub evidence — no
            self-reported résumés, no inflated scores. Search, invite, and generate verified application links.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-4 flex flex-col gap-5">
            <div className="p-6 bg-surface-card border border-border-subtle rounded-xl shadow-soft-card">
              <div className="font-label-caps text-[10px] text-text-muted uppercase tracking-wider mb-4">SEARCH FILTERS</div>

              <label className="font-label-caps text-[10px] text-text-muted uppercase tracking-wider block mb-1.5">Skill</label>
              <select
                value={skill}
                onChange={(e) => setSkill(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface-subtle border border-border-subtle text-text-primary text-sm font-mono focus:border-primary-container outline-none transition-colors"
              >
                {SKILL_OPTIONS.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>

              <label className="font-label-caps text-[10px] text-text-muted uppercase tracking-wider block mb-1.5 mt-4">Min Score</label>
              <input
                type="range"
                min={0}
                max={100}
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value))}
                className="w-full accent-primary-container"
              />
              <div className="flex items-center justify-between font-label-mono-tag text-[10px] text-text-muted">
                <span>{minScore} / 100</span>
                <span>shown score (post-shrinkage)</span>
              </div>

              <label className="font-label-caps text-[10px] text-text-muted uppercase tracking-wider block mb-1.5 mt-4">Listing</label>
              <select
                value={selectedListing}
                onChange={(e) => setSelectedListing(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-surface-subtle border border-border-subtle text-text-primary text-sm font-mono focus:border-primary-container outline-none transition-colors"
              >
                <option value="">— none selected —</option>
                {listings.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title} · {skillLabel(l.requiredSkills[0] ?? '')}
                  </option>
                ))}
              </select>

              {notice && (
                <div
                  className={`mt-4 p-3 rounded-lg border font-label-code text-[11px] ${
                    notice.kind === 'ok'
                      ? 'bg-badge-green-bg border-badge-green-border text-badge-green-text'
                      : 'bg-error-container/40 border-error/30 text-error'
                  }`}
                >
                  {notice.text}
                </div>
              )}
            </div>

            <div className="p-6 bg-surface-card border border-border-subtle rounded-xl shadow-soft-card">
              <div className="font-label-caps text-[10px] text-text-muted uppercase tracking-wider mb-4">POSTED LISTINGS</div>
              <div className="flex flex-col gap-3">
                {listings.length === 0 && <p className="font-label-code text-xs text-text-muted">No listings seeded.</p>}
                {listings.map((l) => (
                  <div key={l.id} className="p-4 rounded-lg border border-border-subtle bg-surface-container-low">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-body-md text-sm font-medium text-text-primary">{l.title}</div>
                        <div className="font-label-code text-[11px] text-text-muted mt-0.5">
                          {l.requiredSkills.map(skillLabel).join(' · ')} · min {l.minScore} · level {l.minLevel}
                        </div>
                      </div>
                      <button
                        onClick={() => genLink(l.id)}
                        className="shrink-0 font-label-mono-tag text-[10px] px-2 py-1 rounded bg-badge-green-bg border border-badge-green-border text-badge-green-text hover:bg-badge-green-border transition-colors"
                        title="Generate verified application link"
                      >
                        VERIFIED LINK
                      </button>
                    </div>
                    {l.inviteUrl && (
                      <p className="mt-2 font-label-code text-[10px] text-badge-green-text break-all select-all">{l.inviteUrl}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="lg:col-span-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-label-caps text-xs text-text-primary uppercase tracking-wider font-semibold">
                CANDIDATE MATCHES ({results.length})
              </h2>
              {searching && <span className="font-label-mono-tag text-[11px] text-text-muted animate-pulse">RE-INDEXING…</span>}
            </div>
            <div className="flex flex-col gap-3">
              {results.length === 0 && (
                <div className="p-8 rounded-xl border border-dashed border-border-strong bg-surface-card text-center font-label-code text-xs text-text-muted">
                  No candidates meet the filter. Lower the min score or switch skill — honest abstentions are never padded.
                </div>
              )}
              {results.map((d) => {
                const wallet = d.linkedWallets?.[0]?.wallet;
                const score = d.score;
                return (
                  <div
                    key={d.id}
                    className="p-5 rounded-xl bg-surface-card border border-border-subtle shadow-soft-card hover:shadow-card-hover transition-shadow flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-11 h-11 rounded-xl bg-surface-container border border-border-subtle flex items-center justify-center font-label-caps text-xs font-bold text-text-primary">
                        {d.githubHandle.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-headline-sm text-[16px] font-semibold text-text-primary">{d.githubHandle}</span>
                          <LevelChip level={d.level} />
                          {d.score && (
                            <span className="font-label-code text-xs text-text-muted">
                              {d.score.shownScore.toFixed(1)} · conf {d.score.confidence.toFixed(2)} · E {Math.round(d.score.evidenceUnits)}
                            </span>
                          )}
                        </div>
                        <div className="font-label-code text-[11px] text-text-muted mt-0.5">
                          {wallet ? <span className="select-all">{wallet}</span> : 'no wallet bound'}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {wallet && d.score && (
                        <>
                          <Link
                            href={`/verify/${wallet}/${skill}`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-card border border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-strong text-xs font-mono font-semibold transition-colors"
                          >
                            <span>REPORT</span>
                            <span>↗</span>
                          </Link>
                          <a
                            href={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/badge/${wallet}/${skill}.svg`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-card border border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-strong text-xs font-mono font-semibold transition-colors"
                          >
                            BADGE
                          </a>
                        </>
                      )}
                      <button
                        onClick={() => invite(d.githubHandle)}
                        disabled={!selectedListing}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-container hover:bg-tertiary disabled:opacity-40 text-white text-xs font-mono font-semibold transition-colors"
                      >
                        INVITE
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </main>
      <GlobalFooter />
    </div>
  );
}