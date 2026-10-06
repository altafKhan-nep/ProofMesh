import type {
  AnalysisJob,
  CredentialLevel,
  DimensionId,
  DimensionScore,
  EvidenceAccounting,
  EvidenceItem,
  ScoreSnapshot,
  SkillId
} from '@proofmesh/shared-types';
import { CALIBRATION, DIMENSIONS, DIMENSION_WEIGHTS, LEVEL_INFO } from '@proofmesh/shared-types';

// ---------------------------------------------------------------------------
// Reference corpus — deterministic seeding percentiles.
//
// ARCHITECTURE.md §6:  s_d ∈ [0,100] = percentile of the developer's signal
// vs. a reference corpus of comparable repos. When a real corpus is supplied
// at runtime we rank against it; otherwise this calibrated default corpus is
// used so the engine is reproducible and unit-testable offline.
// ---------------------------------------------------------------------------

export const DEFAULT_CORPUS = {
  quality: [58, 62, 66, 70, 74, 78, 82, 86, 90, 94],
  security: [55, 60, 65, 70, 75, 80, 85, 90, 94, 97],
  architecture: [50, 58, 64, 70, 76, 82, 87, 91, 95, 98],
  testing: [40, 50, 60, 68, 75, 82, 88, 92, 96, 99],
  consistency: [45, 55, 63, 70, 76, 82, 87, 91, 95, 98],
  // Round-2: star-backed reach on a log scale (ARCHITECTURE.md §6). These values
  // are 100·log10(1+stars)/log10(1+1e6) at stars ≈ [5,20,60,150,400,1k,3k,10k,40k,150k].
  traction: [13, 22, 30, 36, 43, 50, 58, 67, 77, 87]
} as const;

export type ReferenceCorpus = Record<DimensionId, readonly number[]>;

/**
 * Deterministic percentile: proportion of corpus values strictly below
 * `value`, with ties split at the halfway point. Returns 0–100.
 * At or below the corpus minimum a value ranks floor (0).
 */
export function percentile(value: number, corpus: readonly number[]): number {
  if (corpus.length === 0) return 50;
  // A signal that could not be computed earns NO credit (0): absence of
  // evidence is not evidence of quality. Returning NaN here instead would
  // propagate through `computeDimensionScores` into the persisted
  // rawScore/shownScore, where nothing could catch it.
  if (!Number.isFinite(value)) return 0;
  let below = 0;
  let equal = 0;
  for (const v of corpus) {
    if (v < value) below += 1;
    else if (v === value) equal += 1;
  }
  if (below === 0) return 0;
  return ((below + 0.5 * equal) / corpus.length) * 100;
}

export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

export const round = (v: number, dp = 2): number => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

// ---------------------------------------------------------------------------
// Evidence accounting (ARCHITECTURE.md §6)
// ---------------------------------------------------------------------------

export interface AccountingInput {
  externalMergedPRs: number; // capped by distinct repos
  ownReviewedPRs: number;
  reposWithTestsGreenCi: number; // capped per repo
  activityMonths: number; // capped at 12
  tractionRepos?: number; // capped at 4 (round-2: repos ≥ 200 stars)
  signedCommitRatio: number; // 0–1
  maintainerAttestations: number;
  analyzerCoverage: number; // 0.3–1.0
}

/**
 * Finite, non-negative count. Callers pass values derived from the GitHub API
 * and from persisted JSON, so `NaN`/`undefined`/negative are all reachable and
 * must not reach the arithmetic.
 */
const count = (v: number | undefined): number =>
  typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;

/** Pure evidence-unit accounting → E. */
export function computeEvidenceUnits(input: AccountingInput): number {
  const { unitValues } = CALIBRATION;
  const base =
    count(input.externalMergedPRs) * unitValues.externalMergedPR +
    count(input.ownReviewedPRs) * unitValues.ownReviewedPR +
    count(input.reposWithTestsGreenCi) * unitValues.repoTestsGreenCi +
    Math.min(count(input.activityMonths), CALIBRATION.activityMonthCap) * unitValues.activityMonth +
    Math.min(count(input.tractionRepos), CALIBRATION.tractionRepoCap) * unitValues.tractionRepo +
    (input.signedCommitRatio >= 0.5 ? unitValues.signedCommitBonus : 0) +
    count(input.maintainerAttestations) * unitValues.maintainerAttestation;
  const coverage = clamp(Number.isFinite(input.analyzerCoverage) ? input.analyzerCoverage : 0.3, 0.3, 1.0);
  return round(base * coverage, 4);
}

/** c = 1 − exp(−E / E0). Always in [0, 1]. */
export function computeConfidence(evidenceUnits: number): number {
  // A negative E makes exp() overflow and c hugely negative (verified E = -210
  // produced -2.5e14), which then flowed into shownScore and into user-facing
  // eligibility prose. E is evidence volume, so it cannot be negative.
  const e = Math.max(0, Number.isFinite(evidenceUnits) ? evidenceUnits : 0);
  const c = 1 - Math.exp(-e / CALIBRATION.E0);
  return round(clamp(c, 0, 1), 6);
}

/** shown_score = prior + c·(raw − prior). */
export function computeShownScore(rawScore: number, confidence: number, priorScore: number): number {
  return round(priorScore + confidence * (rawScore - priorScore), 2);
}

export interface Eligibility {
  passed: boolean;
  reasons: string[];
  requirements: {
    confidenceMet: boolean;
    coverageMinMet: boolean;
    reposMet: boolean;
    individualAccount: boolean;
  };
}

/**
 * Credential eligibility (ARCHITECTURE.md §6):
 *   c ≥ 0.60 AND language coverage ≥ 50%
 *   AND (≥ 2 distinct repos OR ≥ 1 external merged PR)
 *   AND account type = individual GitHub user
 *
 * The account-type rule lives here, not only in the API pipeline:
 * `ScoreSnapshot.passedEligibility` is persisted and publicly served, so it
 * has to be meaningful on its own. This is the rule that keeps org/bot
 * accounts (`nestjs`, `spring-projects`) out of the credentialed set — the
 * round-3 back-test showed they out-score real maintainers on every measured
 * signal, so no score threshold can substitute for it.
 */
export function evaluateEligibility(
  confidence: number,
  languageCoverage: number,
  distinctRepos: number,
  externalMergedPRs: number,
  accountType: 'User' | 'Organization' | 'Bot' = 'User'
): Eligibility {
  const confidenceMet = confidence >= CALIBRATION.minConfidence;
  const coverageMinMet = languageCoverage >= CALIBRATION.minLanguageCoverage;
  const reposMet =
    distinctRepos >= CALIBRATION.minRepos || externalMergedPRs >= 1;
  const individualAccount = accountType === 'User';

  const reasons: string[] = [];
  if (!confidenceMet) {
    reasons.push(
      `Confidence ${(confidence * 100).toFixed(1)}% below the ${(CALIBRATION.minConfidence * 100).toFixed(
        0
      )}% issuance threshold.`
    );
  }
  if (!coverageMinMet) {
    reasons.push(
      `Language coverage ${(languageCoverage * 100).toFixed(0)}% below the ${
        CALIBRATION.minLanguageCoverage * 100
      }% minimum — only ${''}of the codebase was analyzable.`
    );
  }
  if (!reposMet) {
    reasons.push(
      `Need ≥ ${CALIBRATION.minRepos} distinct public repos or ≥ 1 externally merged PR (found ${distinctRepos} repos / ${externalMergedPRs} external merges).`
    );
  }
  if (!individualAccount) {
    reasons.push(`Credentials attest an individual developer; this is a ${accountType} account.`);
  }
  if (reasons.length === 0) {
    reasons.push('Evidence volume and coverage clear the issuance threshold.');
  }

  // Derived from the computed booleans, never by searching the prose above.
  // The previous implementation used `reasons[0].includes('clear the
  // issuance')`, so editing that English sentence silently flipped issuance
  // for every developer in the system.
  return {
    passed: confidenceMet && coverageMinMet && reposMet && individualAccount,
    requirements: { confidenceMet, coverageMinMet, reposMet, individualAccount },
    reasons
  };
}

// ---------------------------------------------------------------------------
// Dimension signals → dimension scores
// ---------------------------------------------------------------------------

export interface DimensionSignals {
  quality: { survivalRate: number; staticFindingsPerKLOC: number; negativeTestRatio: number };
  security: { securityFindingsOpen: number; signedCommitRatio: number; dependencyVulns: number };
  architecture: { crossRepoImpact: number; modularityScore: number; cycleFree: boolean };
  testing: { testCoverage: number; ciGreenRate: number; negativeTestRatio: number };
  consistency: { activityMonths: number; releaseCount: number; prSizeDiscipline: number };
  traction: { starTotal: number };
}

/**
 * Normalize raw signals into 0–100 "excellent scores" (higher = better).
 * These are pre-percentile calibrations, then ranked against the corpus.
 */
export function normalizeSignals(signals: DimensionSignals): Record<DimensionId, number> {
  const {
    survivalRate,
    staticFindingsPerKLOC,
    negativeTestRatio: negQ
  } = signals.quality;
  const {
    securityFindingsOpen,
    signedCommitRatio,
    dependencyVulns
  } = signals.security;
  const { crossRepoImpact, modularityScore, cycleFree } = signals.architecture;
  const { testCoverage, ciGreenRate, negativeTestRatio: negT } = signals.testing;
  const { activityMonths, releaseCount, prSizeDiscipline } = signals.consistency;
  const { starTotal } = signals.traction;

  const quality =
    0.5 * survivalRate * 100 +
    0.25 * clamp(100 - staticFindingsPerKLOC * 25, 0, 100) +
    0.25 * clamp(50 + negQ * 50, 0, 100);

  const security =
    0.4 * clamp(100 - securityFindingsOpen * 15, 0, 100) +
    0.4 * (signedCommitRatio * 100) +
    0.2 * clamp(100 - dependencyVulns * 20, 0, 100);

  const architecture =
    0.45 * crossRepoImpact * 100 +
    0.4 * clamp(modularityScore * 100, 0, 100) +
    0.15 * (cycleFree ? 100 : 40);

  const testing =
    0.4 * clamp(testCoverage * 100, 0, 100) +
    0.35 * clamp(ciGreenRate * 100, 0, 100) +
    0.25 * clamp(50 + negT * 50, 0, 100);

  const consistency =
    0.5 * clamp((activityMonths / CALIBRATION.activityMonthCap) * 100, 0, 100) +
    0.25 * clamp(Math.min(releaseCount, 12) * 8, 0, 100) +
    0.25 * clamp(prSizeDiscipline * 100, 0, 100);

  // Round-2 traction — star-backed reach on a log scale (ARCHITECTURE.md §6).
  // saturates at ~100k combined stars; corpus ranks the remainder.
  const traction = round((100 * Math.log10(1 + Math.max(0, starTotal))) / Math.log10(1 + 1e5), 2);

  // Every dimension is finally clamped to the documented 0–100 contract.
  //
  // Several terms above multiply a raw signal by 100 without clamping
  // (`survivalRate`, `signedCommitRatio`, `crossRepoImpact`, `prSizeDiscipline`,
  // `quality`'s first term), so e.g. `survivalRate: 5` yielded `quality: 300`.
  // A non-finite input likewise produced NaN, which previously reached the
  // persisted rawScore. Clamping here means a bad signal earns no credit
  // rather than corrupting the whole credential.
  const bounded = (v: number): number => (Number.isFinite(v) ? clamp(v, 0, 100) : 0);

  return {
    quality: bounded(quality),
    security: bounded(security),
    architecture: bounded(architecture),
    testing: bounded(testing),
    consistency: bounded(consistency),
    traction: bounded(traction)
  };
}

export function computeDimensionScores(
  signals: DimensionSignals,
  corpus: ReferenceCorpus = DEFAULT_CORPUS
): DimensionScore[] {
  const normalized = normalizeSignals(signals);
  return DIMENSIONS.map((dimension) => ({
    dimension,
    score: round(percentile(normalized[dimension], corpus[dimension]), 2),
    evidenceUnits: 0,
    notes: [`Signal normalized to ${round(normalized[dimension], 1)} then ranked against the reference corpus.`]
  }));
}

export function computeRawScore(dimensions: DimensionScore[]): number {
  const raw = dimensions.reduce((acc, d) => {
    const weight = DIMENSION_WEIGHTS[d.dimension];
    // Guard rather than trust: `DIMENSION_WEIGHTS[unknown]` is `undefined`,
    // and `undefined * score` is NaN, which propagates into rawScore,
    // shownScore and the persisted snapshot. `dimension` was widened to
    // `string` while DIMENSIONS lacked `as const`, so this was reachable.
    if (weight === undefined) {
      throw new Error(`computeRawScore: unknown dimension ${JSON.stringify(d.dimension)}`);
    }
    return acc + weight * d.score;
  }, 0);
  return round(raw, 2);
}

/**
 * Content address for the reference corpus a score was computed against.
 * "Deterministic and auditable" is the product's central claim, so two scores
 * measured against different corpora must never share an id.
 */
function cohortDigest(corpus: ReferenceCorpus, skillId: SkillId): string {
  const canonical = DIMENSIONS.map((d) => `${d}:${corpus[d].join(',')}`).join('|');
  let h = 0x811c9dc5;
  const input = `${skillId}::${canonical}`;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${input.length.toString(16)}-${h.toString(16).padStart(8, '0')}`;
}

// ---------------------------------------------------------------------------
// Full scoring + level
// ---------------------------------------------------------------------------

/**
 * Awarded credential level, or 0 when nothing is earned.
 *
 * NOTE: this previously returned a floor of 1 while the API's own
 * `computeLevelOf` returned 0 for the same inputs, so the level written on-chain
 * depended on which copy you called. There is now exactly one ladder.
 */
export function computeLevel(
  shownScore: number,
  confidence: number,
  tier2Attestations: number
): CredentialLevel {
  const levels: Array<[3, number, number] | [2, number, number] | [1, number, number]> = [
    [3, LEVEL_INFO[3].minScore, LEVEL_INFO[3].minConfidence],
    [2, LEVEL_INFO[2].minScore, LEVEL_INFO[2].minConfidence],
    [1, LEVEL_INFO[1].minScore, LEVEL_INFO[1].minConfidence]
  ];
  for (const [level, minScore, minConf] of levels) {
    if (shownScore >= minScore && confidence >= minConf) {
      if (level === 3 && tier2Attestations < 1) continue; // Expert needs ≥1 Tier-2 attestation
      return level;
    }
  }
  return 0;
}

/** Deterministic-only full score. Inputs mirror a scoring-engine run, never an LLM. */
export function computeScore(input: {
  skillId: SkillId;
  accounting: AccountingInput;
  dimensionSignals: DimensionSignals;
  languageCoverage: number;
  corpus?: ReferenceCorpus;
  confidenceCap?: number;
  priorScore?: number;
  tier2Attestations?: number;
  /**
   * Actual distinct non-fork public repos the developer owns.
   *
   * REQUIRED, and deliberately not derived: the previous fallback
   * (`externalMergedPRs + ownReviewedPRs`) counted *PRs* while satisfying the
   * *repos* gate, so one repo with six reviewed PRs passed "≥2 distinct repos"
   * — and double-counted, since externalMergedPRs is itself already a distinct
   * repo count. Fail closed instead of guessing.
   */
  distinctRepos: number;
  /** GitHub account type; only `User` may hold a ProofMesh credential. */
  accountType?: 'User' | 'Organization' | 'Bot';
  /** Caller-supplied identity — keeps `computeScore` free of impure defaults. */
  id?: string;
  developerId?: string;
  analyzerVersion?: string;
}): ScoreSnapshot {
  const corpus = input.corpus ?? DEFAULT_CORPUS;
  const cap = input.confidenceCap ?? 1.0;

  const evidenceUnits = computeEvidenceUnits(input.accounting);
  const confidence = round(clamp(Math.min(computeConfidence(evidenceUnits), cap), 0, 1), 4);

  const dimensions = computeDimensionScores(input.dimensionSignals, corpus);
  const rawScore = computeRawScore(dimensions);
  const priorScore = input.priorScore ?? CALIBRATION.priorPercentile;
  const shownScore = clamp(computeShownScore(rawScore, confidence, priorScore), 0, 100);

  const eligibility = evaluateEligibility(
    confidence,
    input.languageCoverage,
    input.distinctRepos,
    input.accounting.externalMergedPRs,
    input.accountType ?? 'User'
  );

  return {
    id: input.id ?? crypto.randomUUID(),
    developerId: input.developerId ?? '',
    skillId: input.skillId,
    rawScore,
    shownScore,
    confidence,
    evidenceUnits,
    priorScore,
    dimensions,
    // Content-addressed: two corpora with identical shapes but different
    // values (verified: [1,2] vs [90,99] per dimension, rawScore 100 vs 18)
    // previously produced the same `CORPUS-2x2x2x2x2x2` id.
    cohort: `CORPUS-${cohortDigest(corpus, input.skillId)}`,
    snapshotCommitSha: null,
    scoredAt: new Date().toISOString(),
    analyzerVersion: input.analyzerVersion ?? input.skillId,
    passedEligibility: eligibility.passed,
    eligibilityReasons: eligibility.reasons
  };
}

// ---------------------------------------------------------------------------
// Build accounting directly from an evidence trail (reproducible)
// ---------------------------------------------------------------------------

export function accountingFromEvidence(evidence: EvidenceItem[]): AccountingInput {
  const externalMergedPRs = distinctRepos(evidence.filter((e) => e.type === 'EXTERNAL_MERGE' && e.positive));
  const ownReviewedPRs = evidence.filter((e) => e.type === 'OWN_PRB_REVIEWED' && e.positive).length;
  const reposWithTestsGreenCi = distinctRepos(
    evidence.filter((e) => e.type === 'REPO_TESTS_GREEN_CI' && e.positive)
  );
  const activityMonths = evidence
    .filter((e) => e.type === 'ACTIVITY_MONTH' && e.positive)
    .reduce((acc, e) => acc + (e.value ?? 1), 0);

  const tractionRepos = distinctRepos(
    evidence.filter((e) => e.type === 'REPO_TRACTION' && e.positive)
  );

  const signedC = evidence.find((e) => e.type === 'SIGNED_COMMIT_RATIO');
  const signedCommitRatio = signedC?.value ?? 0;

  // Tier-2 attestations count DISTINCT attesters, not raw items: `sourceIdentifier`
  // carries the attester identity, so one wallet cannot farm confidence by
  // attesting repeatedly. Items without an identifier (legacy/seeded evidence)
  // fall back to counting each item once.
  const attestationItems = evidence.filter((e) => e.type === 'MAINTAINER_ATTESTATION' && e.positive);
  const identified = new Set(
    attestationItems.map((e) => e.sourceIdentifier).filter((id): id is string => Boolean(id))
  );
  const unidentified = attestationItems.filter((e) => !e.sourceIdentifier).length;
  const maintainerAttestations = identified.size + unidentified;

  const coverageItem = evidence.find((e) => e.metricName === 'analyzer_coverage');
  const analyzerCoverage = coverageItem?.value ?? 1.0;

  return {
    externalMergedPRs,
    ownReviewedPRs,
    reposWithTestsGreenCi,
    activityMonths,
    tractionRepos,
    signedCommitRatio,
    maintainerAttestations,
    analyzerCoverage
  };
}

function distinctRepos(items: EvidenceItem[]): number {
  return new Set(items.map((i) => i.sourceIdentifier ?? i.sourceUrl ?? i.id)).size;
}

export interface JobProgress {
  percent: number;
  stage: string;
  detail: string;
}

/** Map a worker's stage list → SSE percent progress. Deterministic. */
export function progressFor(stages: AnalysisJob['stages']): JobProgress {
  const total = stages.length || 1;
  const done = stages.filter((s) => s.status === 'done').length;
  const running = stages.find((s) => s.status === 'running');
  const percent = Math.min(99, Math.round((done / total) * 100));
  return {
    percent,
    stage: running?.stage ?? stages[stages.length - 1]?.stage ?? 'SCORING',
    detail: running?.detail ?? ''
  };
}