import { SKILLS } from '@proofmesh/shared-types';
import type { PipelineStage, SkillId } from '@proofmesh/shared-types';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export const ISSUER_LABEL = 'PROOF-SPEC V2.4.1 // ATTEST-NODE-SOL-OK';

export const SKILL_OPTIONS = Object.values(SKILLS);

export function skillLabel(id: string): string {
  return SKILLS[id as SkillId]?.label ?? id;
}

/** Landing "five deterministic stages" — mirrors the Stitch pipeline section. */
export const FIVE_STAGES = [
  {
    n: '01',
    label: 'Ingestion',
    tag: 'STAGE_READ_ONLY',
    blurb: 'Full commit, pull request, and review history pulled read-only from GitHub.'
  },
  {
    n: '02',
    label: 'Static analysis',
    tag: 'SANDBOX_AUDIT',
    blurb: 'Sandboxed, automated checks on code quality and security.'
  },
  {
    n: '03',
    label: 'Outcome analysis',
    tag: 'ENTROPY_INDEX',
    blurb: 'Whether contributions survive contact with other maintainers.'
  },
  {
    n: '04',
    label: 'Verified credential',
    tag: 'SOLANA_ANCHOR',
    blurb: 'The score and confidence are issued on Solana, tamper-proof.'
  },
  {
    n: '05',
    label: 'Built for scale',
    tag: 'N_PARALLEL',
    blurb: 'Works the same for one developer or thousands.'
  }
] as const;

/** Live 7-stage pipeline (matches apps/api pipeline.ts + PIPELINE_STAGES). */
export const PIPELINE_META: Record<PipelineStage, { label: string; tag: string; blurb: string }> = {
  INGESTION: {
    label: 'Ingestion',
    tag: 'STAGE_READ_ONLY',
    blurb: 'Full commit, pull request, and review history pulled read-only from GitHub.'
  },
  STATIC_ANALYSIS: {
    label: 'Static analysis',
    tag: 'SANDBOX_AUDIT',
    blurb: 'Sandboxed automated checks on code quality and security.'
  },
  OUTCOME_ANALYSIS: {
    label: 'Outcome analysis',
    tag: 'ENTROPY_INDEX',
    blurb: 'Whether contributions survive contact with other maintainers.'
  },
  SCORING: {
    label: 'Deterministic scoring',
    tag: 'PEER_PERCENTILE',
    blurb: 'Signals normalized and scored against the reference corpus (E, c, shrinkage).'
  },
  REVIEWER_PASS: {
    label: 'Reviewer pass',
    tag: 'REVIEWER_ATTESTATION',
    blurb: 'Independent reviewer attests the evidence trail is coherent.'
  },
  SKEPTIC_PASS: {
    label: 'Skeptic pass',
    tag: 'FALSIFICATION_GATE',
    blurb: 'Adversarial checks can only lower confidence or block — never raise.'
  },
  CREDENTIAL_CHECK: {
    label: 'Credential check',
    tag: 'SOLANA_ANCHOR',
    blurb: 'Score and confidence issued on Solana, tamper-proof and verifiable.'
  }
};

export const STAGE_ORDER = [
  'INGESTION',
  'STATIC_ANALYSIS',
  'OUTCOME_ANALYSIS',
  'SCORING',
  'REVIEWER_PASS',
  'SKEPTIC_PASS',
  'CREDENTIAL_CHECK'
] as PipelineStage[];

/** Derive honest "dimensional competency" bars from real evidence (fallback). */
export function barsFromEvidence(
  evidence: { type: string; metricName: string | null; value: number | null; positive: boolean }[],
  totalRepos: number
): { label: string; pct: number }[] {
  const count = (t: string) => evidence.filter((e) => e.type === t && e.positive).length;
  const open = evidence.filter((e) => (e.type === 'SECURITY_FINDING' || e.type === 'STATIC_FINDING') && !e.positive);
  const survival =
    evidence.find((e) => e.type === 'CODE_SURVIVAL')?.value ??
    (evidence.find((e) => e.type === 'CODE_SURVIVAL')?.metricName ? 0.85 : 0.6);
  const neg = evidence.find((e) => e.metricName === 'negative_test_ratio')?.value ?? 0;
  const months = count('ACTIVITY_MONTH');
  const merges = count('EXTERNAL_MERGE');
  const ownReviewed = count('OWN_PRB_REVIEWED');
  const tests = count('REPO_TESTS_GREEN_CI');

  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v * 100)));
  const arch = clamp(survival);
  const peer = clamp(Math.min(1, (0.5 * merges + 0.3 * ownReviewed) / 6));
  const cross = clamp(Math.min(1, totalRepos / 4));
  const sec = clamp(1 - Math.min(1, open.length / 6) * 0.5 - Math.max(0, neg - 0.5));
  const stable = clamp(Math.min(1, (0.4 * months + 0.3 * tests + 0.3) / 6));

  return [
    { label: '01. Code Architecture & Modularity', pct: arch },
    { label: '02. Peer Review Acceptance & Consensus', pct: peer },
    { label: '03. Cross-Repository Impact', pct: cross },
    { label: '04. Vulnerability & Security Clearance', pct: sec },
    { label: '05. Maintainer Retention & Stability', pct: stable }
  ];
}