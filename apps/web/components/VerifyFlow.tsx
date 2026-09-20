'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Developer, PipelineStage, SseEvent } from '@proofmesh/shared-types';
import { api, subscribeJob } from '../lib/api';
import { PIPELINE_META, SKILL_OPTIONS, STAGE_ORDER } from '../lib/constants';
import { useWallet } from '../lib/wallet';

type StageState = { stage: PipelineStage; status: string; detail: string };
type RunState =
  | { kind: 'idle' }
  | { kind: 'running'; jobId: string; note: string }
  | { kind: 'done'; jobId: string; credentialId: string | null; scoreId: string | null }
  | { kind: 'error'; message: string };

const WALLET_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function shortWallet(w: string): string {
  if (!w) return '';
  return w.length > 16 ? `${w.slice(0, 6)}…${w.slice(-4)}` : w;
}

export function VerifyFlow() {
  const [devs, setDevs] = useState<Developer[]>([]);
  const [handle, setHandle] = useState('alexander-vance');
  const [skill, setSkill] = useState<string>('solana-anchor');
  const [stages, setStages] = useState<StageState[]>(() =>
    STAGE_ORDER.map((stage) => ({ stage, status: 'pending', detail: PIPELINE_META[stage].blurb }))
  );
  const [progress, setProgress] = useState<{ percent: number; detail: string } | null>(null);
  const [run, setRun] = useState<RunState>({ kind: 'idle' });
  const [resultStats, setResultStats] = useState<{ shownScore: number; confidence: number } | null>(null);
  const { wallet, connect, disconnect } = useWallet();
  const [walletInput, setWalletInput] = useState('');
  const [walletError, setWalletError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.developers()
      .then((d) => alive && setDevs(d))
      .catch(() => alive && setDevs([]));
    return () => {
      alive = false;
    };
  }, []);

  const mintWallet = wallet ?? undefined;
  const suggestions = useMemo(() => devs.map((d) => d.githubHandle).filter(Boolean), [devs]);

  const onConnect = () => {
    const value = walletInput.trim();
    if (!WALLET_PATTERN.test(value)) {
      setWalletError('Enter a valid Solana address (base58, 32–44 chars).');
      return;
    }
    setWalletError(null);
    connect(value);
    setWalletInput('');
  };

  const onEvent = useCallback((ev: SseEvent) => {
    switch (ev.type) {
      case 'stage':
        setStages((prev) =>
          prev.map((s) =>
            s.stage === ev.stage ? { stage: ev.stage, status: ev.status, detail: ev.detail } : s
          )
        );
        break;
      case 'progress':
        setProgress({ percent: ev.percent, detail: ev.detail });
        break;
      case 'result':
        setResultStats({ shownScore: ev.shownScore, confidence: ev.confidence });
        break;
      case 'done':
        setRun({ kind: 'done', jobId: ev.jobId, credentialId: ev.credentialId, scoreId: ev.scoreId });
        setProgress(null);
        break;
      case 'error':
        setRun({ kind: 'error', message: ev.message });
        setProgress(null);
        break;
      default:
        break;
    }
  }, []);

  const start = async () => {
    if (!handle.trim()) return;
    setRun({ kind: 'running', jobId: '', note: 'Queuing analysis job…' });
    setResultStats(null);
    setStages((prev) => prev.map((s) => ({ ...s, status: 'pending' })));
    setProgress(null);
    try {
      const { job } = await api.analyze({
        githubUsername: handle.trim(),
        skillId: skill as never,
        llmEnabled: false,
        wallet: mintWallet
      });
      setRun((r) => (r.kind === 'running' ? { ...r, jobId: job.id, note: `Job ${job.id} — deterministic pipeline running` } : r));
      await subscribeJob(job.id, onEvent);
    } catch (err) {
      setRun({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  };

  const current = stages.filter((s) => s.status === 'done').length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 w-full max-w-6xl mx-auto">
      <div className="lg:col-span-5 flex flex-col gap-5">
        <div className="p-6 bg-surface-card border border-border-subtle rounded-xl shadow-soft-card">
          <div className="flex items-center gap-2 mb-4">
            <span className="w-1.5 h-1.5 rounded-full bg-verified-dot animate-pulse"></span>
            <span className="font-label-mono-tag text-[11px] text-badge-green-text uppercase tracking-wider">
              [ LIVE DETERMINISTIC ANALYSIS ]
            </span>
          </div>

          <label className="font-label-caps text-[10px] text-text-muted uppercase tracking-wider block mb-1.5">
            GitHub Handle
          </label>
          <input
            type="text"
            list="proofmesh-dev-suggestions"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            disabled={run.kind === 'running'}
            placeholder="e.g. sindresorhus or any public GitHub username"
            className="w-full px-3 py-2 rounded-lg bg-surface-subtle border border-border-subtle text-text-primary text-sm font-mono focus:border-primary-container outline-none transition-colors disabled:opacity-50"
          />
          <datalist id="proofmesh-dev-suggestions">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>

          <label className="font-label-caps text-[10px] text-text-muted uppercase tracking-wider block mb-1.5 mt-4">
            Skill Schema
          </label>
          <select
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
            disabled={run.kind === 'running'}
            className="w-full px-3 py-2 rounded-lg bg-surface-subtle border border-border-subtle text-text-primary text-sm font-mono focus:border-primary-container outline-none transition-colors disabled:opacity-50"
          >
            {SKILL_OPTIONS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label} · {s.schema}
              </option>
            ))}
          </select>

          <label className="font-label-caps text-[10px] text-text-muted uppercase tracking-wider block mb-1.5 mt-4">
            Solana Wallet
          </label>
          {wallet ? (
            <div className="mt-1 p-3 rounded-lg bg-surface-container-low border border-border-subtle font-label-code text-[11px] text-text-muted">
              <div className="flex items-center justify-between gap-2">
                <span className="text-text-secondary">
                  CONNECTED: <span className="select-all text-badge-green-text">{shortWallet(wallet)}</span>
                </span>
                <button
                  onClick={disconnect}
                  className="font-label-mono-tag text-[10px] px-2 py-1 rounded border border-border-subtle text-text-muted hover:text-error hover:border-error/40 transition-colors"
                >
                  DISCONNECT
                </button>
              </div>
              <div className="mt-1.5 truncate select-all text-text-muted/70">{wallet}</div>
            </div>
          ) : (
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={walletInput}
                onChange={(e) => {
                  setWalletInput(e.target.value);
                  if (walletError) setWalletError(null);
                }}
                disabled={run.kind === 'running'}
                placeholder="Paste Solana wallet address"
                className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-surface-subtle border border-border-subtle text-text-primary text-sm font-mono focus:border-primary-container outline-none transition-colors disabled:opacity-50"
              />
              <button
                onClick={onConnect}
                disabled={run.kind === 'running' || !walletInput.trim()}
                className="px-3 py-2 rounded-lg bg-surface-container border border-border-subtle text-text-primary text-xs font-semibold font-mono hover:bg-primary-container hover:text-white transition-colors disabled:opacity-50"
              >
                CONNECT
              </button>
            </div>
          )}
          {walletError && <p className="mt-1.5 font-label-code text-[10px] text-error">{walletError}</p>}
          {!wallet && (
            <p className="mt-1.5 font-label-code text-[10px] text-text-muted">
              Your credential is minted to this wallet. Paste any Solana address — no browser extension required for the demo.
            </p>
          )}

          <button
            onClick={start}
            disabled={run.kind === 'running' || !handle.trim()}
            className={`mt-5 w-full inline-flex items-center justify-center gap-2.5 px-5 py-2.5 rounded-lg bg-primary-container text-white text-sm font-medium tracking-tight shadow-button transition-all ${
              run.kind === 'running' ? 'opacity-60 cursor-not-allowed' : 'hover:bg-tertiary active:scale-[0.98]'
            }`}
          >
            <span>{run.kind === 'running' ? 'VERIFYING…' : 'Run Proof Pipeline'}</span>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </button>

          <div className="mt-4 flex items-center gap-2 font-label-mono-tag text-[10px] text-text-muted flex-wrap">
            <span>Deterministic-only</span>
            <span className="text-text-muted/60">•</span>
            <span>No LLM required</span>
            {!wallet && (
              <>
                <span className="text-text-muted/60">•</span>
                <span>credentials held pending wallet binding</span>
              </>
            )}
          </div>
        </div>

        {run.kind === 'done' && (
          <div
            className={`p-6 rounded-xl border shadow-soft-card ${
              run.credentialId
                ? 'bg-badge-green-bg border-badge-green-border'
                : 'bg-surface-card border-border-strong'
            }`}
          >
            {run.credentialId ? (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-5 h-5 text-primary-container" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                  </svg>
                  <span className="font-headline-sm text-[18px] font-semibold text-badge-green-text">Credential minted on-chain</span>
                </div>
                <p className="font-label-code text-xs text-badge-green-text mb-4">
                  {resultStats
                    ? `Score ${resultStats.shownScore.toFixed(1)} · Confidence ${(resultStats.confidence * 100).toFixed(1)}%`
                    : 'Deterministic attestation issued.'}{' '}
                  <span className="select-all">{run.credentialId}</span>
                </p>
                {wallet && (
                  <Link
                    href={`/verify/${wallet}/${skill}`}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-container hover:bg-tertiary text-white text-xs font-semibold font-mono transition-colors"
                  >
                    <span>VIEW PUBLIC REPORT</span>
                    <span>→</span>
                  </Link>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-5 h-5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                    <circle cx="12" cy="12" r="9" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01" />
                  </svg>
                  <span className="font-headline-sm text-[18px] font-semibold text-text-primary">Honest abstention</span>
                </div>
                <p className="font-label-code text-xs text-text-muted">
                  The skeptic pass found insufficient falsifiable evidence. No credential minted — ProofMesh never inflates scores.
                </p>
              </>
            )}
          </div>
        )}

        {run.kind === 'error' && (
          <div className="p-5 rounded-xl border border-error/30 bg-error-container/40 font-label-code text-xs text-error">
            Analysis failed: {run.message}
          </div>
        )}
      </div>

      <div className="lg:col-span-7 flex flex-col gap-4">
        <div className="p-6 bg-surface-card border border-border-subtle rounded-xl shadow-soft-card">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <span className="font-label-caps text-[10px] text-text-muted uppercase tracking-wider">PIPELINE STAGES</span>
            </div>
            <div className="flex items-center gap-2">
              {progress && (
                <span className="font-label-mono-tag text-[11px] text-text-secondary">{Math.round(progress.percent)}%</span>
              )}
              <span className="font-label-mono-tag text-[11px] text-text-muted">{current}/{stages.length}</span>
              <span className="relative flex h-2 w-2">
                <span
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full bg-verified-dot opacity-75 ${
                    run.kind === 'running' ? '' : 'hidden'
                  }`}
                ></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 ${run.kind === 'running' ? 'bg-verified-dot' : 'bg-border-strong'}`}></span>
              </span>
            </div>
          </div>

          <div className="w-full h-1 bg-border-subtle rounded-full overflow-hidden mb-5">
            <div
              className="h-full bg-primary-container rounded-full transition-all duration-300"
              style={{ width: `${progress ? Math.round(progress.percent) : (current / stages.length) * 100}%` }}
            ></div>
          </div>

          <div className="divide-y divide-border-subtle">
            {stages.map((s, i) => {
              const meta = PIPELINE_META[s.stage];
              const active = s.status === 'running' || (run.kind === 'running' && s.status === 'done' && i === current - 1);
              return (
                <div key={s.stage} className="flex items-start gap-4 py-3">
                  <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                    {s.status === 'done' ? (
                      <svg className="w-5 h-5 text-primary-container" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : active ? (
                      <span className="w-3 h-3 rounded-full bg-verified-dot animate-pulse inline-block"></span>
                    ) : (
                      <span className="w-3 h-3 rounded-full bg-border-strong inline-block"></span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-label-caps text-[10px] uppercase tracking-wider ${s.status === 'done' ? 'text-primary-container' : 'text-text-muted'}`}>
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className={`font-body-md text-sm font-medium ${s.status === 'done' ? 'text-text-primary' : 'text-text-secondary'}`}>
                        {meta.label}
                      </span>
                      <span className="font-label-mono-tag text-[10px] px-1.5 py-0.5 rounded bg-surface-container border border-border-subtle text-text-muted">
                        {meta.tag}
                      </span>
                      {active && <span className="font-label-mono-tag text-[10px] text-badge-green-text animate-pulse">EXECUTING</span>}
                    </div>
                    <p className="font-label-code text-[11px] text-text-muted mt-0.5 truncate">{s.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}