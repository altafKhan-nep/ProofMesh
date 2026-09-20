import type {
  AnalysisJob,
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
  consistency: [45, 55, 63, 70, 76, 82, 87, 91, 95, 98]
} as const;

export type ReferenceCorpus = Record<DimensionId, readonly number[]>;

/**
 * Deterministic percentile: proportion of corpus values strictly below
 * `value`, with ties split at the halfway point. Returns 0–100.
 * At or below the corpus minimum a value ranks floor (0).
 */
export function percentile(value: number, corpus: readonly number[]): number {
  if (corpus.length === 0) return 50;
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
  signedCommitRatio: number; // 0–1
  maintainerAttestations: number;
  analyzerCoverage: number; // 0.3–1.0
}

/** Pure evidence-unit accounting → E. */
export function computeEvidenceUnits(input: AccountingInput): number {
  const { unitValues } = CALIBRATION;
  const base =
    input.externalMergedPRs * unitValues.externalMergedPR +
    input.ownReviewedPRs * unitValues.ownReviewedPR +
    input.reposWithTestsGreenCi * unitValues.repoTestsGreenCi +
    Math.min(input.activityMonths, CALIBRATION.activityMonthCap) * unitValues.activityMonth +
    (input.signedCommitRatio >= 0.5 ? unitValues.signedCommitBonus : 0) +
    input.maintainerAttestations * unitValues.maintainerAttestation;
  const coverage = clamp(input.analyzerCoverage, 0.3, 1.0);
  return round(base * coverage, 4);
}

/** c = 1 − exp(−E / E0). */
export function computeConfidence(evidenceUnits: number): number {
  const c = 1 - Math.exp(-evidenceUnits / CALIBRATION.E0);
  return round(c, 6);
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
  };
}

/**
 * Credential eligibility (ARCHITECTURE.md §6):
 *   c ≥ 0.60 AND language coverage ≥ 50% AND (≥ 2 distinct repos OR ≥ 1 external merged PR)
 */
export function evaluateEligibility(
  confidence: number,
  languageCoverage: number,
  distinctRepos: number,
  externalMergedPRs: number
): Eligibility {
  const confidenceMet = confidence >= CALIBRATION.minConfidence;
  const coverageMinMet = languageCoverage >= CALIBRATION.minLanguageCoverage;
  const reposMet =
    distinctRepos >= CALIBRATION.minRepos || externalMergedPRs >= 1;

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
  if (reasons.length === 0) {
    reasons.push('Evidence volume and coverage clear the issuance threshold.');
  }

  return { passed: reasons.length === 1 && reasons[0]!.includes('clear the issuance'), requirements: { confidenceMet, coverageMinMet, reposMet }, reasons };
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

  return { quality, security, architecture, testing, consistency };
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
  const raw = dimensions.reduce(
    (acc, d) => acc + DIMENSION_WEIGHTS[d.dimension] * d.score,
    0
  );
  return round(raw, 2);
}

// ---------------------------------------------------------------------------
// Full scoring + level
// ---------------------------------------------------------------------------

export function computeLevel(shownScore: number, confidence: number, tier2Attestations: number): 0 | 1 | 2 | 3 {
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
  return 1; // at least "Verified" if eligibility passed; caller gates on eligibility anyway
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
  /** actual distinct public repos the developer owns (used for the ≥2-repos gate) */
  distinctRepos?: number;
}): ScoreSnapshot {
  const corpus = input.corpus ?? DEFAULT_CORPUS;
  const cap = input.confidenceCap ?? 1.0;

  const evidenceUnits = computeEvidenceUnits(input.accounting);
  let confidence = computeConfidence(evidenceUnits);
  confidence = round(Math.min(confidence, cap), 4);

  const dimensions = computeDimensionScores(input.dimensionSignals, corpus);
  const rawScore = computeRawScore(dimensions);
  const priorScore = input.priorScore ?? CALIBRATION.priorPercentile;
  const shownScore = computeShownScore(rawScore, confidence, priorScore);

  const eligibility = evaluateEligibility(
    confidence,
    input.languageCoverage,
    input.distinctRepos ?? input.accounting.externalMergedPRs + input.accounting.ownReviewedPRs,
    input.accounting.externalMergedPRs
  );

  return {
    id: crypto.randomUUID(),
    developerId: '',
    skillId: input.skillId,
    rawScore,
    shownScore,
    confidence,
    evidenceUnits,
    priorScore,
    dimensions,
    cohort: `CORPUS-${Object.values(corpus)
      .map((c) => c.length)
      .join('x')}`,
    snapshotCommitSha: null,
    scoredAt: new Date().toISOString(),
    analyzerVersion: input.skillId,
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

  const signedC = evidence.find((e) => e.type === 'SIGNED_COMMIT_RATIO');
  const signedCommitRatio = signedC?.value ?? 0;

  const maintainerAttestations = evidence
    .filter((e) => e.type === 'MAINTAINER_ATTESTATION' && e.positive)
    .reduce((acc, e) => acc + (e.value ?? 1), 0);

  const coverageItem = evidence.find((e) => e.metricName === 'analyzer_coverage');
  const analyzerCoverage = coverageItem?.value ?? 1.0;

  return {
    externalMergedPRs,
    ownReviewedPRs,
    reposWithTestsGreenCi,
    activityMonths,
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