'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AuditEvent, CandidateDeveloper, Listing, CredentialLevel } from '@proofmesh/shared-types';
import { LEVEL_INFO } from '@proofmesh/shared-types';
import { api } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { useWallet } from '../../lib/wallet';
import { SKILL_OPTIONS, skillLabel } from '../../lib/constants';
import { GlobalHeader } from '../../components/GlobalHeader';
import { GlobalFooter } from '../../components/GlobalFooter';

/**
 * A credential level arrives from the API as an untrusted number. Clamp to the
 * known range so a corrupt row renders 'Not Yet' instead of reading
 * `LEVEL_INFO[undefined]` (or crashing).
 */
function clampLevel(level?: number): CredentialLevel {
  if (!Number.isFinite(level)) return 0;
  return (Math.min(3, Math.max(0, Math.trunc(level as number))) as CredentialLevel);
}

function LevelChip({ level }: { level?: number }) {
  if (!level) return <span className="font-label-mono-tag text-[10px] px-1.5 py-0.5 rounded bg-surface-container border border-border-strong text-text-muted">NOT YET</span>;
  const classes = [
    'text-badge-green-text bg-badge-green-bg border-badge-green-border',
    'text-badge-green-text bg-badge-green-bg border-badge-green-border',
    'text-text-primary bg-primary-fixed border-primary-container/40'
  ];
  return (
    <span className={`font-label-mono-tag text-[10px] px-1.5 py-0.5 rounded border ${classes[clampLevel(level) - 1] ?? classes[0]}`}>
      L{level} · {LEVEL_INFO[clampLevel(level)]?.label ?? ''}
    </span>
  );
}

export default function SponsorsPage() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [results, setResults] = useState<CandidateDeveloper[]>([]);
  const [skill, setSkill] = useState('solana-anchor');
  const [minScore, setMinScore] = useState(60);
  const [searching, setSearching] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [selectedListing, setSelectedListing] = useState<string>('');
  const { session, isAdmin } = useAuth();
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  // Wallet signer for privileged admin actions (P2: every admin write is signed).
  const { signMessage } = useWallet();

  useEffect(() => {
    api.listings().then(setListings).catch(() => setListings([]));
  }, []);

  // P3: pull the security audit trail once signed in as an admin.
  useEffect(() => {
    if (!isAdmin) {
      setAudit([]);
      return;
    }
    api
      .adminAudit(25)
      .then((r) => setAudit(r.events))
      .catch(() => setAudit([]));
  }, [isAdmin, session?.expiresAt]);

  // Debounce + cancel: dragging the min-score slider must not fire one HTTP
  // request per pixel, and a stale slow response must never overwrite a newer one.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearching(true);
      setNotice(null);
      api
        .search({ skills: [skill], minScore }, controller.signal)
        .then((res) => !controller.signal.aborted && setResults(res))
        .catch((e) => {
          if (controller.signal.aborted) return;
          setNotice({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
        })
        .finally(() => !controller.signal.aborted && setSearching(false));
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [skill, minScore]);

  const invite = async (handle: string) => {
    if (!selectedListing) {
      setNotice({ kind: 'err', text: 'Select a listing to invite from.' });
      return;
    }
    if (!isAdmin) {
      setNotice({ kind: 'err', text: 'Admin sign-in required to invite candidates.' });
      return;
    }
    try {
      await api.adminPost('/api/invite', { listingId: selectedListing, githubHandle: handle }, signMessage);
      setNotice({ kind: 'ok', text: `Invite sent to @${handle}` });
    } catch (e) {
      setNotice({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const genLink = async (id: string) => {
    if (!isAdmin) {
      setNotice({ kind: 'err', text: 'Admin sign-in required to generate verified links.' });
      return;
    }
    try {
      const { listing } = await api.adminPost<{ listing: Listing }>(`/api/listings/${id}/verified-link`, {}, signMessage);
      setListings((prev) => prev.map((l) => (l.id === id ? listing : l)));
      setNotice({ kind: 'ok', text: `Verified link generated: ${listing.inviteUrl ?? ''}` });
    } catch (e) {
      setNotice({ kind: 'err', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const deleteListing = async (id: string) => {
    if (!isAdmin) {
      setNotice({ kind: 'err', text: 'Admin sign-in required to remove listings.' });
      return;
    }
    try {
      const res = await api.adminDelete<{ ok: boolean }>(`/api/listings/${id}`, signMessage);
      void res;
      setNotice({ kind: 'ok', text: 'Listing removed.' });
      setListings((prev) => prev.filter((l) => l.id !== id));
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
          <div
            className={`mt-3 self-start inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border font-label-mono-tag text-[11px] ${
              isAdmin
                ? 'bg-badge-green-bg border-badge-green-border text-badge-green-text'
                : 'bg-surface-container border-border-strong text-text-muted'
            }`}
          >
            {isAdmin ? (
              <>ADMIN CONSOLE ACTIVE — {session?.wallet}</>
            ) : (
              <>INVITE / VERIFIED LINK / REMOVE require admin sign-in (wallet in ADMIN_WALLETS) — use the header SIGN IN.</>
            )}
          </div>
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
                        disabled={!isAdmin}
                        className="shrink-0 font-label-mono-tag text-[10px] px-3 py-2 min-h-[44px] inline-flex items-center rounded bg-badge-green-bg border border-badge-green-border text-badge-green-text hover:bg-badge-green-border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Generate verified application link (admin)"
                      >
                        VERIFIED LINK
                      </button>
                      <button
                        onClick={() => {
                          if (confirm('Remove this listing?')) void deleteListing(l.id);
                        }}
                        disabled={!isAdmin}
                        className="shrink-0 font-label-mono-tag text-[10px] px-3 py-2 min-h-[44px] inline-flex items-center rounded bg-error-container/40 border border-error/30 text-error hover:bg-error/20 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Remove listing (admin)"
                      >
                        REMOVE
                      </button>
                    </div>
                    {l.inviteUrl && (
                      <p className="mt-2 font-label-code text-[10px] text-badge-green-text break-all select-all">{l.inviteUrl}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {isAdmin && (
              <div className="p-6 bg-surface-card border border-border-subtle rounded-xl shadow-soft-card">
                <div className="flex items-center justify-between mb-3">
                  <div className="font-label-caps text-[10px] text-text-muted uppercase tracking-wider">
                    Security audit trail
                  </div>
                  <span className="font-label-mono-tag text-[10px] text-text-muted">{audit.length} recent</span>
                </div>
                <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
                  {audit.length === 0 && (
                    <p className="font-label-code text-[11px] text-text-muted">No security events recorded yet.</p>
                  )}
                  {audit.map((e) => (
                    <div
                      key={e.id}
                      className="flex items-center gap-2 px-2 py-1.5 rounded border border-border-subtle bg-surface-container-low font-label-code text-[10px]"
                    >
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] uppercase ${
                          e.outcome === 'success'
                            ? 'bg-badge-green-bg text-badge-green-text border border-badge-green-border'
                            : e.outcome === 'blocked'
                              ? 'bg-error-container/40 text-error border border-error/30'
                              : 'bg-surface-container text-text-secondary border border-border-strong'
                        }`}
                      >
                        {e.outcome}
                      </span>
                      <span className="text-text-primary">{e.type}</span>
                      {e.route && <span className="text-text-muted truncate">{e.route}</span>}
                      {e.reason && <span className="text-error">{e.reason}</span>}
                      {e.actor && <span className="text-text-muted ml-auto shrink-0">{e.actor.slice(0, 6)}…</span>}
                      <span className="text-text-muted/60 shrink-0">{new Date(e.at).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
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
                        disabled={!selectedListing || !isAdmin}
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