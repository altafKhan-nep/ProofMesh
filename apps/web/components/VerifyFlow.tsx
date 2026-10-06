'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import type {
  AnalysisJob,
  Developer,
  EvidenceReport,
  PipelineStage,
  SseEvent, CredentialLevel } from '@proofmesh/shared-types';
import { LEVEL_INFO, PIPELINE_STAGES } from '@proofmesh/shared-types';
import { api, subscribeJob } from '../lib/api';
import { PIPELINE_META, SKILL_OPTIONS } from '../lib/constants';
import { shortAddress } from '../lib/format';
import { useWallet } from '../lib/wallet';
import { signInWallet, useAuth } from '../lib/auth';

type StageState = { stage: PipelineStage; status: string; detail: string };
type RunState =
  | { kind: 'idle' }
  | { kind: 'running'; jobId: string; note: string }
  | {
      kind: 'done';
      jobId: string;
      credentialId: string | null;
      scoreId: string | null;
      attestationAddress: string | null;
      mintConfirmed: boolean;
    }
  | { kind: 'error'; message: string };
type IdentityState = 'idle' | 'loading' | 'found' | 'empty';

function levelFrom(shownScore: number, confidence: number): CredentialLevel {
  if (shownScore >= 88 && confidence >= 0.85) return 3;
  if (shownScore >= 75 && confidence >= 0.75) return 2;
  if (shownScore >= 60 && confidence >= 0.6) return 1;
  return 0;
}

function Pill({ tone, children }: { tone: 'green' | 'mute' | 'amber' | 'red' | 'violet'; children: ReactNode }) {
  const map = {
    green: 'bg-badge-green-bg border-badge-green-border text-badge-green-text',
    mute: 'bg-surface-container border-border-subtle text-text-secondary',
    amber: 'bg-[#fdf6e3] border-[#ecdcb2] text-[#7a5b18]',
    red: 'bg-error-container/40 border-error/30 text-error',
    violet: 'bg-[#f1edf7] border-[#ded3ee] text-[#4c3d7a]'
  };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-label-mono-tag text-[10px] whitespace-nowrap ${map[tone]}`}>
      {children}
    </span>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <label className="font-label-caps text-[10px] text-text-muted uppercase tracking-wider block mb-1.5">
      {children}
    </label>
  );
}

function StepHeader({ n, title, status }: { n: string; title: string; status?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-5">
      <div className="flex items-center gap-3">
        <span className="font-label-mono-tag text-[10px] text-text-muted border border-border-subtle rounded px-1.5 py-0.5 leading-none">
          {n}
        </span>
        <h3 className="font-headline-sm text-[15px] font-semibold text-text-primary tracking-tight">{title}</h3>
      </div>
      {status ?? <span className="hidden lg:block" />}
    </div>
  );
}

function Ring({ pct, size = 112 }: { pct: number; size?: number }) {
  const v = Math.max(0, Math.min(100, pct));
  const r = Math.max(0, size / 2 - 10);
  const c = 2 * Math.PI * r;
  const off = c * (1 - v / 100);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90 shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-border-subtle)" strokeWidth="10" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--color-primary-container)"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={off}
      />
    </svg>
  );
}

function Stat({ label, value, tone = 'mute' }: { label: string; value: string | number; tone?: 'green' | 'mute' }) {
  return (
    <div className="flex flex-col gap-1 p-2.5 rounded-lg bg-surface-container-low border border-border-subtle">
      <span className={`font-label-code text-base leading-none font-semibold ${tone === 'green' ? 'text-badge-green-text' : 'text-text-primary'}`}>
        {value}
      </span>
      <span className="font-label-caps text-[9px] text-text-muted uppercase tracking-wider">{label}</span>
    </div>
  );
}

const PRIMARY_BTN =
  'inline-flex items-center justify-center bg-primary-container hover:bg-tertiary text-white font-mono text-sm font-semibold rounded-lg shadow-button transition-all duration-150 active:scale-[0.98]';
const SECONDARY_BTN =
  'inline-flex items-center justify-center border border-border-strong bg-surface-card text-text-secondary rounded-lg font-mono text-xs hover:bg-surface-container-low hover:text-text-primary transition-colors';

export function VerifyFlow() {
  const [devs, setDevs] = useState<Developer[]>([]);
  const [handle, setHandle] = useState('');
  const [skill, setSkill] = useState<string>('solana-anchor');
  const [stages, setStages] = useState<StageState[]>(() =>
    PIPELINE_STAGES.map((stage) => ({ stage, status: 'pending', detail: PIPELINE_META[stage].blurb }))
  );
  const [progress, setProgress] = useState<{ percent: number; detail: string } | null>(null);
  const [run, setRun] = useState<RunState>({ kind: 'idle' });
  const [resultStats, setResultStats] = useState<{ shownScore: number; confidence: number } | null>(null);
  const [jobFinal, setJobFinal] = useState<AnalysisJob | null>(null);
  const { wallet, walletId, openModal, disconnect, signMessage, error: walletError } = useWallet();
  const { session, refresh } = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const [github, setGithub] = useState<{ proven: boolean; login: string | null }>({ proven: false, login: null });
  const [bindState, setBindState] = useState<{ kind: 'idle' | 'busy' | 'done' | 'error'; text?: string }>({ kind: 'idle' });
  const [attestations, setAttestations] = useState<
    Array<{ id: string; attesterLogin: string; repo: string; skill: string; statement: string }>
  >([]);
  const [attestRepo, setAttestRepo] = useState('');
  const [attestState, setAttestState] = useState<{ kind: 'idle' | 'busy' | 'done' | 'error'; text?: string }>({ kind: 'idle' });

  // Live identity snapshot for the target handle (repos / evidence / score).
  const [evidence, setEvidence] = useState<EvidenceReport | null>(null);
  const [identity, setIdentity] = useState<IdentityState>('idle');

  useEffect(() => {
    let alive = true;
    api.developers()
      .then((d) => {
        if (!alive) return;
        setDevs(d);
        setHandle((prev) => prev || d[0]?.githubHandle || '');
      })
      .catch(() => alive && setDevs([]));
    return () => {
      alive = false;
    };
  }, []);

  // The GitHub leg of a binding: proven on the session via OAuth.
  useEffect(() => {
    if (!session) {
      setGithub({ proven: false, login: null });
      return;
    }
    api
      .githubOAuthStatus()
      .then(setGithub)
      .catch(() => setGithub({ proven: false, login: null }));
  }, [session]);

  const connectGithub = async () => {
    setBindState({ kind: 'busy', text: 'Opening GitHub…' });
    try {
      const start = await api.githubOAuthStart();
      if (!start.configured || !start.authorizeUrl) {
        setBindState({ kind: 'error', text: start.message ?? 'GitHub OAuth is not configured on this server.' });
        return;
      }
      window.location.assign(start.authorizeUrl);
    } catch (err) {
      setBindState({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const bindWallet = async () => {
    if (!wallet || !handle.trim()) return;
    setBindState({ kind: 'busy', text: 'Signing the binding…' });
    try {
      const challenge = await api.post<{ message: string }>('/api/auth/challenge', {
        wallet,
        purpose: 'bind',
        subject: handle.trim()
      });
      const signature = await signMessage(challenge.message);
      const res = await api.bind({
        githubUsername: handle.trim(),
        wallet,
        message: challenge.message,
        signature
      });
      setBindState({
        kind: 'done',
        text: `Bound ${res.binding.verified?.github === 'proven' ? 'and verified' : ''} — credentials can now be issued to this wallet.`
      });
    } catch (err) {
      setBindState({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  // Tier-2 attestations are public and independently verifiable.
  useEffect(() => {
    const h = handle.trim();
    if (!h) {
      setAttestations([]);
      return;
    }
    api
      .attestations(h)
      .then((r) => setAttestations(r.attestations))
      .catch(() => setAttestations([]));
  }, [handle, bindState.kind]);

  const submitAttestation = async () => {
    const h = handle.trim();
    if (!wallet || !h || !attestRepo.trim()) return;
    setAttestState({ kind: 'busy', text: 'Signing the attestation…' });
    try {
      const challenge = await api.post<{ message: string }>('/api/auth/challenge', {
        wallet,
        purpose: 'attest',
        subject: h,
        repo: attestRepo.trim(),
        skill
      });
      const signature = await signMessage(challenge.message);
      const res = await api.attest({
        githubUsername: h,
        repo: attestRepo.trim(),
        skill,
        message: challenge.message,
        signature
      });
      setAttestState({
        kind: 'done',
        text: res.duplicate
          ? 'Already recorded (identical claim).'
          : `Recorded — @${res.attestation.attesterLogin} vouched for this work.`
      });
    } catch (err) {
      setAttestState({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const mintWallet = wallet ?? undefined;
  const suggestions = useMemo(() => devs.map((d) => d.githubHandle).filter(Boolean), [devs]);

  // Resolve the target identity live (repos, evidence, prior score, bindings).
  useEffect(() => {
    const h = handle.trim();
    const timer = setTimeout(() => {
      if (!h) {
        setEvidence(null);
        setIdentity('idle');
        return;
      }
      let alive = true;
      setIdentity('loading');
      api
        .evidence(h)
        .then((r) => {
          if (!alive) return;
          setEvidence(r);
          setIdentity('found');
        })
        .catch(() => {
          if (alive) {
            setEvidence(null);
            setIdentity('empty');
          }
        });
    }, 320);
    return () => {
      clearTimeout(timer);
    };
  }, [handle, run.kind, bindState.kind]);

  // On completion, pull the authoritative job record: final stage details,
  // the abstain reason, and the persisted score snapshot.
  useEffect(() => {
    if (run.kind !== 'done' || !run.jobId) return;
    let alive = true;
    api
      .job(run.jobId)
      .then(({ job, score }) => {
        if (!alive) return;
        setJobFinal(job);
        if (job.stages?.length) {
          setStages(
            job.stages.map((st) => ({
              stage: st.stage,
              status: st.status,
              detail: st.detail || 'Completed.'
            }))
          );
        }
        setResultStats((prev) => prev ?? (score ? { shownScore: score.shownScore, confidence: score.confidence } : null));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [run]);

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
        setRun({
          kind: 'done',
          jobId: ev.jobId,
          credentialId: ev.credentialId,
          scoreId: ev.scoreId,
          attestationAddress: ev.attestationAddress,
          mintConfirmed: ev.mintConfirmed
        });
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
    if (!wallet) {
      openModal();
      setRun({ kind: 'error', message: 'Connect a Solana wallet to authorize the pipeline.' });
      return;
    }
    if (!session) {
      setSigningIn(true);
      try {
        await signInWallet(wallet, signMessage);
        const next = await refresh();
        if (!next) throw new Error('Sign-in could not be confirmed by the API');
      } catch (err) {
        setRun({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err)
        });
        setSigningIn(false);
        return;
      }
      setSigningIn(false);
    }
    setRun({ kind: 'running', jobId: '', note: 'Queuing analysis job…' });
    setResultStats(null);
    setJobFinal(null);
    setStages((prev) => prev.map((s) => ({ ...s, status: 'pending' })));
    setProgress(null);
    try {
      // Cookie session (httpOnly) + CSRF header; no token is held in JS.
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
  const pct = progress ? Math.round(progress.percent) : Math.round((current / stages.length) * 100);
  const skillLabel = SKILL_OPTIONS.find((s) => s.id === skill)?.label ?? skill;
  const verifiedBindings = evidence?.developer.linkedWallets.filter(
    (b) => b.verified?.wallet === true && b.verified.github === 'proven'
  ).length ?? 0;
  const abstainReason =
    jobFinal?.stages.find((st) => st.stage === 'CREDENTIAL_CHECK')?.detail ??
    'The skeptic pass found insufficient falsifiable evidence. No credential minted — ProofMesh never inflates scores.';

  const authReady = Boolean(session && wallet);
  const identityStatus = identity === 'found' ? (
    <Pill tone="green">
      <span className="w-1.5 h-1.5 rounded-full bg-verified-dot" />
      RESOLVED
    </Pill>
  ) : identity === 'empty' ? (
    <Pill tone="mute">NOT INGESTED</Pill>
  ) : undefined;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 w-full max-w-7xl mx-auto">
      {/* ------------------------------------------------ left: target ----- */}
      <div className="lg:col-span-5 flex flex-col gap-6">
        <section className="p-6 bg-surface-card border border-border-subtle rounded-xl shadow-soft-card">
          <StepHeader n="01" title="Target identity" status={identityStatus} />

          <FieldLabel>GitHub handle</FieldLabel>
          <div className="flex h-10 items-center rounded-lg border border-border-strong bg-surface-card px-3 transition-colors focus-within:border-primary-container focus-within:ring-2 focus-within:ring-primary-container/15">
            <span className="font-mono text-sm text-text-muted select-none">@</span>
            <input
              type="text"
              list="proofmesh-dev-suggestions"
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              disabled={run.kind === 'running'}
              placeholder="github username"
              aria-label="GitHub username"
              className="flex-1 min-w-0 bg-transparent px-1.5 font-mono text-sm text-text-primary outline-none placeholder:text-text-muted/70 disabled:opacity-50"
            />
          </div>
          <datalist id="proofmesh-dev-suggestions">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>

          <FieldLabel>Skill schema</FieldLabel>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {SKILL_OPTIONS.map((s) => {
              const active = skill === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={run.kind === 'running'}
                  onClick={() => setSkill(s.id)}
                  className={`group flex flex-col gap-1 px-3 py-2.5 rounded-lg border text-left transition-colors disabled:opacity-50 ${
                    active
                      ? 'border-primary-container bg-forest-light'
                      : 'border-border-subtle bg-surface-card hover:border-border-strong hover:bg-surface-container-low'
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className={`text-[12px] font-semibold leading-tight ${active ? 'text-primary-container' : 'text-text-secondary'}`}>
                      {s.label}
                    </span>
                    {active && (
                      <span className="w-4 h-4 rounded-full bg-primary-container text-white flex items-center justify-center shrink-0">
                        <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </span>
                    )}
                  </span>
                  <span className={`font-mono text-[10px] ${active ? 'text-primary-container/80' : 'text-text-muted'}`}>
                    {s.schema}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Live identity snapshot */}
          <div className="mt-5 pt-5 border-t border-border-subtle">
            {identity === 'loading' && (
              <div className="flex items-center gap-3 animate-pulse">
                <div className="w-10 h-10 rounded-full bg-surface-container"></div>
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-32 bg-surface-container rounded"></div>
                  <div className="h-2.5 w-48 bg-surface-container rounded"></div>
                </div>
              </div>
            )}

            {identity === 'found' && evidence && (
              <div>
                <div className="flex items-center gap-3">
                  {evidence.developer.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={evidence.developer.avatarUrl}
                      alt=""
                      width={40}
                      height={40}
                      className="w-10 h-10 rounded-full border border-border-subtle bg-surface-container"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-primary-container text-white font-mono text-lg font-bold flex items-center justify-center shrink-0">
                      {(evidence.developer.githubHandle[0] ?? '?').toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-body-md text-[15px] font-semibold text-text-primary">
                        @{evidence.developer.githubHandle}
                      </span>
                      <Pill tone={evidence.developer.accountType === 'User' ? 'green' : 'amber'}>
                        {(evidence.developer.accountType ?? 'User').toUpperCase()}
                      </Pill>
                    </div>
                    <span className="font-label-code text-[11px] text-text-muted">
                      github.com/{evidence.developer.githubUsername}
                    </span>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  <Stat label="Repos" value={evidence.repos?.length ?? 0} />
                  <Stat label="Evidence" value={evidence.evidence?.length ?? 0} />
                  <Stat label="Verified binds" value={verifiedBindings} tone={verifiedBindings > 0 ? 'green' : 'mute'} />
                </div>

                {evidence.score ? (
                  <div className="mt-3 flex items-center justify-between gap-3 p-3 rounded-lg bg-surface-container-low border border-border-subtle">
                    <div className="min-w-0">
                      <div className="font-label-caps text-[9px] text-text-muted uppercase tracking-wider">
                        Latest · {SKILL_OPTIONS.find((s) => s.id === evidence.score?.skillId)?.label ?? evidence.score.skillId}
                      </div>
                      <div className="font-label-code text-sm text-text-primary font-semibold mt-0.5">
                        {evidence.score.shownScore.toFixed(1)} / 100 · {Math.round(evidence.score.confidence * 100)}% conf
                      </div>
                    </div>
                    <Pill tone={evidence.score.shownScore >= 60 && evidence.score.confidence >= 0.6 ? 'green' : 'violet'}>
                      {LEVEL_INFO[levelFrom(evidence.score.shownScore, evidence.score.confidence)].label}
                    </Pill>
                  </div>
                ) : (
                  <p className="mt-3 font-label-code text-[11px] text-text-muted">
                    No analysis on record — run the pipeline to produce evidence.
                  </p>
                )}
              </div>
            )}

            {identity === 'empty' && (
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-surface-container-low border border-border-subtle">
                <svg className="w-4 h-4 text-text-muted shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
                </svg>
                <p className="font-label-code text-[11px] text-text-muted leading-relaxed">
                  Not yet ingested. Running the pipeline will fetch this account live from GitHub.
                </p>
              </div>
            )}
          </div>
        </section>

        {/* ------------------------------------------------ auth -------------- */}
        <section className="p-6 bg-surface-card border border-border-subtle rounded-xl shadow-soft-card">
          <StepHeader
            n="02"
            title="Authorization"
            status={
              authReady ? (
                <Pill tone="green">READY</Pill>
              ) : (
                <Pill tone="mute">INCOMPLETE</Pill>
              )
            }
          />

          <FieldLabel>Solana wallet</FieldLabel>
          {wallet ? (
            <div className="mt-1 p-3 rounded-lg bg-surface-container-low border border-border-subtle">
              <div className="flex items-center justify-between gap-2">
                <span className="font-label-code text-[11px] text-text-secondary">
                  <span className="select-all text-badge-green-text">{shortAddress(wallet)}</span>{' '}
                  <span className="text-badge-green-text/70 uppercase text-[9px]">({walletId})</span>
                </span>
                <button
                  onClick={() => void disconnect()}
                  className="font-label-mono-tag text-[10px] px-3 py-2 min-h-[44px] inline-flex items-center rounded border border-border-subtle text-text-muted hover:text-error hover:border-error/40 transition-colors"
                >
                  DISCONNECT
                </button>
              </div>
              <div className="mt-1.5 truncate select-all text-text-muted/70">{wallet}</div>
              {!session && (
                <div className="mt-2 flex items-center justify-between gap-2">
                  <span className="font-label-code text-[10px] text-text-muted">Not signed in.</span>
                  <button
                    onClick={() =>
                      void (async () => {
                        setSigningIn(true);
                        try {
                          await signInWallet(wallet, signMessage);
                          await refresh();
                        } catch (err) {
                          setRun({
                            kind: 'error',
                            message: `Sign-in ${err instanceof Error ? err.message : String(err)}`
                          });
                        } finally {
                          setSigningIn(false);
                        }
                      })()
                    }
                    disabled={signingIn}
                    className="font-label-mono-tag text-[10px] px-3 py-2 min-h-[44px] inline-flex items-center rounded border border-primary-container/40 text-text-secondary hover:text-text-primary hover:border-primary-container transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {signingIn ? 'SIGNING…' : 'SIGN IN'}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button onClick={openModal} className={`${SECONDARY_BTN} mt-1 w-full min-h-[44px] h-11 border-dashed`}>
              Connect Solana wallet
            </button>
          )}
          {walletError && <p className="mt-1.5 font-label-code text-[10px] text-error">{walletError}</p>}

          {session && (
            <div className="mt-2 p-2.5 rounded-lg bg-badge-green-bg/60 border border-badge-green-border flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-verified-dot shrink-0"></span>
              <span className="font-label-code text-[11px] text-badge-green-text">
                SESSION · {session.role.toUpperCase()} · {shortAddress(session.wallet)}
              </span>
            </div>
          )}

          {/* Identity proof steps */}
          <div className="mt-5">
            <FieldLabel>Identity proof</FieldLabel>
            <p className="font-body-sm text-body-sm text-text-muted -mt-1 mb-2 leading-relaxed">
              Both legs must be proven before a credential can be minted.
            </p>
            {[
              {
                key: '1',
                done: github.proven,
                label: `GitHub OAuth · ${github.proven ? `@${github.login}` : 'not connected'}`,
                action: !github.proven
                  ? {
                      label: bindState.kind === 'busy' ? 'OPENING…' : 'CONNECT GITHUB',
                      onClick: () => void connectGithub()
                    }
                  : null
              },
              {
                key: '2',
                done: bindState.kind === 'done',
                label: `Wallet signature · @${handle.trim() || '…'}`,
                action: null
              }
            ].map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-2 py-2 first:pt-0">
                <div className="flex items-center gap-2.5 min-w-0">
                  <span
                    className={`w-5 h-5 shrink-0 rounded-full border transition-colors flex items-center justify-center ${
                      row.done
                        ? 'bg-badge-green-bg border-badge-green-border text-badge-green-text'
                        : 'border-border-strong text-text-muted'
                    }`}
                  >
                    {row.done ? (
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="3">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <span className="font-mono text-[9px] font-bold">{row.key}</span>
                    )}
                  </span>
                  <span className={`font-label-code text-[11px] truncate ${row.done ? 'text-badge-green-text' : 'text-text-secondary'}`}>
                    {row.label}
                  </span>
                </div>
                {row.key === '2' && (
                  <button
                    onClick={() => void bindWallet()}
                    disabled={bindState.kind === 'busy' || !github.proven || !wallet || !handle.trim()}
                    className="px-3 py-2 min-h-[44px] inline-flex items-center rounded-md border border-border-strong text-[10px] text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                  >
                    {bindState.kind === 'busy' ? 'SIGNING…' : 'BIND WALLET'}
                  </button>
                )}
                {row.action && (
                  <button
                    onClick={row.action.onClick}
                    className="min-h-[44px] px-3 py-2 inline-flex items-center rounded-md border border-border-strong text-[10px] text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors whitespace-nowrap"
                  >
                    {row.action.label}
                  </button>
                )}
              </div>
            ))}
            {bindState.text && (
              <p className={`mt-1 font-label-code text-[10px] ${bindState.kind === 'error' ? 'text-error' : 'text-text-muted'}`}>
                {bindState.text}
              </p>
            )}
          </div>

          {/* Tier-2 attestation */}
          <div className="mt-5 pt-5 border-t border-border-subtle">
            <FieldLabel>Tier-2 attestation · optional</FieldLabel>
            {attestations.length > 0 && (
              <div className="flex flex-col gap-1 mb-2">
                {attestations.map((a) => (
                  <div key={a.id} className="font-label-code text-[10px] text-badge-green-text">
                    <span className="text-badge-green-text/60">✓</span> @{a.attesterLogin} owns {a.repo} · {a.skill}
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={attestRepo}
                onChange={(e) => setAttestRepo(e.target.value)}
                placeholder="owner/repository you own"
                aria-label="Repository for attestation"
                className="flex-1 min-w-0 h-9 px-2.5 rounded-lg border border-border-strong bg-surface-card text-text-primary text-[11px] font-mono placeholder:text-text-muted/70 focus:border-primary-container focus:ring-2 focus:ring-primary-container/15 outline-none"
              />
              <button
                onClick={() => void submitAttestation()}
                disabled={attestState.kind === 'busy' || !session || !attestRepo.trim() || !handle.trim()}
                className="min-h-[44px] px-4 py-2 inline-flex items-center rounded-lg border border-border-strong bg-surface-card text-[10px] font-mono text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
              >
                {attestState.kind === 'busy' ? 'SIGNING…' : 'ATTEST'}
              </button>
            </div>
            <p className="mt-1.5 font-body-sm text-body-sm text-text-muted leading-relaxed">
              Requires a signed-in wallet with a proven GitHub identity that owns the repo — you cannot attest yourself.
              Unlocks Expert (L3).
            </p>
            {attestState.text && (
              <p className={`mt-1.5 font-label-code text-[10px] ${attestState.kind === 'error' ? 'text-error' : 'text-text-muted'}`}>
                {attestState.text}
              </p>
            )}
          </div>
        </section>

        {/* ------------------------------------------------ run ---------------- */}
        <section className="p-6 bg-surface-card border border-border-subtle rounded-xl shadow-soft-card">
          <StepHeader n="03" title="Run pipeline" />

          <button
            onClick={start}
            disabled={run.kind === 'running' || signingIn || !handle.trim()}
            className={`${PRIMARY_BTN} mt-1 w-full gap-2.5 px-5 py-3 ${
              run.kind === 'running' || signingIn ? 'opacity-60 cursor-not-allowed' : ''
            }`}
          >
            <span className="flex items-center gap-2.5">
              {run.kind === 'running' ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin inline-block"></span>
                  VERIFYING…
                </>
              ) : signingIn ? (
                'SIGNING IN…'
              ) : wallet && !session ? (
                'SIGN IN & RUN PIPELINE'
              ) : (
                `RUN PIPELINE · @${handle.trim() || '…'}`
              )}
            </span>
            <svg className="w-4 h-4 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </button>

          <div className="mt-3 flex items-center gap-x-2.5 gap-y-1 font-label-mono-tag text-[10px] text-text-muted flex-wrap">
            <span>SKILL: <span className="text-text-secondary">{skillLabel}</span></span>
            <span aria-hidden className="text-border-strong">/</span>
            <span>7 STAGES</span>
            <span aria-hidden className="text-border-strong">/</span>
            <span>NO LLM</span>
            {!wallet && (
              <>
                <span aria-hidden className="text-border-strong">/</span>
                <span>credentials held pending wallet binding</span>
              </>
            )}
          </div>
        </section>

        {/* ------------------------------------------------ verdict ------------ */}
        {run.kind === 'done' && (
          <section className={`p-6 rounded-xl border ${
            run.credentialId ? 'bg-badge-green-bg border-badge-green-border' : 'bg-surface-card border-border-strong'
          }`}>
            {run.credentialId ? (
              <div>
                <div className="flex items-center gap-4">
                  <div className="relative shrink-0">
                    <Ring pct={resultStats?.shownScore ?? 0} size={104} />
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="font-display text-xl font-medium text-text-primary leading-none">
                        {resultStats ? resultStats.shownScore.toFixed(0) : '—'}
                      </span>
                      <span className="font-label-caps text-[8px] text-text-muted uppercase mt-0.5">/ 100</span>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <svg className="w-5 h-5 text-primary-container shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                      <span className="font-headline-sm text-[17px] font-semibold text-badge-green-text">
                        {run.mintConfirmed ? 'Credential minted on-chain' : 'Credential issued'}
                      </span>
                    </div>
                    {resultStats && (
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <Pill tone="green">
                          {LEVEL_INFO[levelFrom(resultStats.shownScore, resultStats.confidence)].label}
                        </Pill>
                        <span className="font-label-code text-xs text-badge-green-text">
                          CONF {Math.round(resultStats.confidence * 100)}%
                        </span>
                      </div>
                    )}
                    <p className="font-label-code text-xs text-badge-green-text mt-1.5">
                      <span className="select-all">{run.credentialId}</span>
                    </p>
                  </div>
                </div>

                {run.attestationAddress && (
                  <div className="mt-4 p-3 rounded-lg bg-surface-card border border-border-subtle font-label-code text-[11px] text-text-muted">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-text-secondary">
                        PDA: <span className="select-all text-badge-green-text">{run.attestationAddress}</span>
                      </span>
                      <a
                        href={`https://explorer.solana.com/address/${run.attestationAddress}?cluster=devnet`}
                        target="_blank"
                        rel="noreferrer"
                        className="font-label-mono-tag text-[10px] px-3 py-2 min-h-[44px] inline-flex items-center rounded border border-border-subtle text-text-muted hover:text-primary-container hover:border-primary-container/40 transition-colors whitespace-nowrap"
                      >
                        EXPLORER ↗
                      </a>
                    </div>
                    {!run.mintConfirmed && (
                      <p className="mt-1.5 text-text-muted/70">
                        Devnet mint pending (issuer funding). Credential is already registered off-chain — RPC will show valid:false until the on-chain record lands.
                      </p>
                    )}
                  </div>
                )}
                {wallet && (
                  <Link
                    href={`/verify/${wallet}/${skill}`}
                    className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-container hover:bg-tertiary text-white text-xs font-semibold font-mono transition-colors"
                  >
                    <span>VIEW PUBLIC REPORT</span>
                    <span>→</span>
                  </Link>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="relative shrink-0">
                  <Ring pct={resultStats?.shownScore ?? 0} size={104} />
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-display text-xl font-medium text-text-primary leading-none">
                      {resultStats ? resultStats.shownScore.toFixed(0) : '—'}
                    </span>
                    <span className="font-label-caps text-[8px] text-text-muted uppercase mt-0.5">/ 100</span>
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <svg className="w-5 h-5 text-text-muted shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                      <circle cx="12" cy="12" r="9" />
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01" />
                    </svg>
                    <span className="font-headline-sm text-[17px] font-semibold text-text-primary">Honest abstention</span>
                  </div>
                  <p className="font-label-code text-xs text-text-muted mt-1.5 leading-relaxed">{abstainReason}</p>
                </div>
              </div>
            )}
          </section>
        )}

        {run.kind === 'error' && (
          <div role="alert" className="p-5 rounded-xl border border-error/30 bg-error-container/40 font-label-code text-xs text-error">
            <span className="font-semibold">Analysis failed:</span> {run.message}
          </div>
        )}
      </div>

      {/* ------------------------------------------------ right: pipeline ------ */}
      <div className="lg:col-span-7 flex flex-col gap-6 lg:sticky lg:top-6 self-start">
        <section className="p-6 bg-surface-card border border-border-subtle rounded-xl shadow-soft-card" aria-live="polite">
          <div className="flex items-center justify-between gap-3 mb-5">
            <div className="flex items-center gap-3">
              <span className="font-label-mono-tag text-[10px] text-text-muted border border-border-subtle rounded px-1.5 py-0.5 leading-none">
                04
              </span>
              <div>
                <h3 className="font-headline-sm text-[15px] font-semibold text-text-primary tracking-tight">Pipeline monitor</h3>
                <p className="font-body-sm text-body-sm text-text-muted">7 deterministic stages · live over SSE</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-label-mono-tag text-[11px] text-text-secondary tabular-nums">{pct}%</span>
              <span className="font-label-mono-tag text-[11px] text-text-muted tabular-nums">
                {current}/{stages.length}
              </span>
              <span className="relative flex h-2 w-2">
                <span
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full bg-verified-dot opacity-75 ${run.kind === 'running' ? '' : 'hidden'}`}
                ></span>
                <span className={`relative inline-flex rounded-full h-2 w-2 ${run.kind === 'running' ? 'bg-verified-dot' : 'bg-border-strong'}`}></span>
              </span>
            </div>
          </div>

          <div className="w-full h-1.5 bg-surface-container rounded-full overflow-hidden mb-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Pipeline progress">
            <div
              className="h-full bg-primary-container rounded-full transition-all duration-300"
              style={{ width: `${pct}%` }}
            ></div>
          </div>

          <ul className="mt-2">
            {stages.map((s, i) => {
              const meta = PIPELINE_META[s.stage];
              const done = s.status === 'done';
              const running = s.status === 'running' || (run.kind === 'running' && !done && i === current);
              return (
                <li key={s.stage} className="relative flex gap-3.5 py-3.5">
                  {i < stages.length - 1 && (
                    <span className="absolute left-[14px] top-[44px] bottom-0 w-px bg-border-subtle" aria-hidden />
                  )}
                  <span
                    className={`w-[30px] h-[30px] shrink-0 rounded-full border flex items-center justify-center transition-colors ${
                      done
                        ? 'bg-badge-green-bg border-badge-green-border text-badge-green-text'
                        : running
                          ? 'border-primary-container/60 text-primary-container'
                          : 'border-border-strong text-text-muted'
                    }`}
                  >
                    {done ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    ) : running ? (
                      <span className="w-2.5 h-2.5 rounded-full bg-primary-container animate-pulse inline-block"></span>
                    ) : (
                      <span className="font-mono text-[10px] font-bold tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                    )}
                  </span>
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-body-md text-sm font-medium ${done || running ? 'text-text-primary' : 'text-text-secondary'}`}>
                        {meta.label}
                      </span>
                      <span className="font-label-mono-tag text-[10px] px-1.5 py-0.5 rounded bg-surface-container border border-border-subtle text-text-muted">
                        {meta.tag}
                      </span>
                      {running && (
                        <span className="font-label-mono-tag text-[10px] text-primary-container animate-pulse">EXECUTING</span>
                      )}
                    </div>
                    <p className={`font-label-code text-[11px] mt-1 leading-relaxed ${done ? 'text-text-secondary' : 'text-text-muted'}`}>
                      {s.detail}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>

          {run.kind === 'running' && run.note && (
            <div className="mt-4 p-3 rounded-lg bg-surface-container-low border border-border-subtle font-label-code text-[11px] text-text-muted">
              {run.note}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}