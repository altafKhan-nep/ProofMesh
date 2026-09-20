import { describe, expect, it } from 'vitest';
import type { EvidenceItem, SkillId } from '@proofmesh/shared-types';
import {
  accountingFromEvidence,
  computeConfidence,
  computeEvidenceUnits,
  computeScore,
  computeShownScore,
  evaluateEligibility,
  percentile
} from '../src/index';

const uuid = (n: number) => `e-${n}`;

let itemId = 0;
function evidence(
  type: EvidenceItem['type'],
  positive = true,
  value: number | null = null,
  source: string | null = 'repos/acme'
): EvidenceItem {
  itemId += 1;
  return {
    id: uuid(itemId),
    analysisRunId: 'run-1',
    type,
    description: type,
    sourceUrl: source ? `https://github.com/${source}` : null,
    sourceIdentifier: source,
    metricName: null,
    value,
    positive,
    sourceVersion: 'pow.solana-anchor.v1',
    capturedAt: new Date().toISOString()
  };
}

describe('percentile', () => {
  it('returns 0 for the minimum and 100 for above-max', () => {
    const corpus = [10, 20, 30, 40, 50];
    expect(percentile(10, corpus)).toBe(0);
    expect(percentile(51, corpus)).toBe(100);
  });
  it('splits ties at the halfway point', () => {
    // below=1, equal=2 → (1 + 0.5·2) / 4 = 0.5 → 50
    expect(percentile(30, [10, 30, 30, 50])).toBe(50);
  });
});

describe('computeEvidenceUnits', () => {
  it('computes E from the §6 accounting formula', () => {
    const E = computeEvidenceUnits({
      externalMergedPRs: 12,
      ownReviewedPRs: 6,
      reposWithTestsGreenCi: 3,
      activityMonths: 18,
      signedCommitRatio: 0.7,
      maintainerAttestations: 1,
      analyzerCoverage: 0.95
    });
    // (12*3 + 6*2 + 3*2 + min(18,12)*0.5 + 2 + 1*5) * 0.95 = 67 * 0.95
    expect(E).toBeCloseTo(63.65, 4);
  });
  it('caps activity at 12 months', () => {
    const a = computeEvidenceUnits({ externalMergedPRs: 0, ownReviewedPRs: 0, reposWithTestsGreenCi: 0, activityMonths: 50, signedCommitRatio: 0, maintainerAttestations: 0, analyzerCoverage: 1 });
    expect(a).toBe(6); // 12 * 0.5
  });
  it('awards the signed-commit bonus only at or above 0.5', () => {
    const no = computeEvidenceUnits({ externalMergedPRs: 0, ownReviewedPRs: 0, reposWithTestsGreenCi: 0, activityMonths: 0, signedCommitRatio: 0.49, maintainerAttestations: 0, analyzerCoverage: 1 });
    const yes = computeEvidenceUnits({ externalMergedPRs: 0, ownReviewedPRs: 0, reposWithTestsGreenCi: 0, activityMonths: 0, signedCommitRatio: 0.5, maintainerAttestations: 0, analyzerCoverage: 1 });
    expect(no).toBe(0);
    expect(yes).toBe(2);
  });
  it('clamps analyzer coverage to the 0.3–1.0 range', () => {
    // 2 external merges × 3 units = 6; coverage clamped to 0.3 → 6 * 0.3
    const low = computeEvidenceUnits({ externalMergedPRs: 2, ownReviewedPRs: 0, reposWithTestsGreenCi: 0, activityMonths: 0, signedCommitRatio: 0, maintainerAttestations: 0, analyzerCoverage: 0.1 });
    expect(low).toBeCloseTo(1.8, 4);
  });
});

describe('confidence + shrinkage', () => {
  it('c = 1 − exp(−E/E0) with E0 = 30', () => {
    expect(computeConfidence(63.65)).toBeCloseTo(0.880168, 6);
  });
  it('shrinks thin evidence toward the prior', () => {
    const shown = computeShownScore(95, 0.05, 50);
    expect(shown).toBeCloseTo(52.25, 2);
  });
});

describe('eligibility', () => {
  it('passes at c≥0.60, coverage≥50%, ≥2 repos or ≥1 external merge', () => {
    const r = evaluateEligibility(0.88, 0.9, 3, 12);
    expect(r.passed).toBe(true);
  });
  it('fails on thin evidence (low confidence) — the honest abstention state', () => {
    const r = evaluateEligibility(0.02, 1.0, 1, 0);
    expect(r.passed).toBe(false);
    expect(r.reasons[0]).toMatch(/Confidence/);
  });
  it('fails when coverage is below 50%', () => {
    const r = evaluateEligibility(0.9, 0.4, 5, 0);
    expect(r.passed).toBe(false);
    expect(r.reasons[0]).toMatch(/Language coverage/);
  });
  it('fails when both repo and external-merge requirements miss', () => {
    const r = evaluateEligibility(0.9, 0.9, 1, 0);
    expect(r.passed).toBe(false);
    expect(r.reasons.some((x) => x.includes('2 distinct public repos'))).toBe(true);
  });
});

describe('computeScore (full deterministic run)', () => {
  const strongSignals = {
    quality: { survivalRate: 0.92, staticFindingsPerKLOC: 0.1, negativeTestRatio: 0.31 },
    security: { securityFindingsOpen: 0, signedCommitRatio: 0.7, dependencyVulns: 0 },
    architecture: { crossRepoImpact: 0.88, modularityScore: 0.9, cycleFree: true },
    testing: { testCoverage: 0.74, ciGreenRate: 0.97, negativeTestRatio: 0.28 },
    consistency: { activityMonths: 18, releaseCount: 9, prSizeDiscipline: 0.85 }
  };

  it('produces a strong score with confidence ~0.88', () => {
    const s = computeScore({
      skillId: 'solana-anchor',
      accounting: {
        externalMergedPRs: 12,
        ownReviewedPRs: 6,
        reposWithTestsGreenCi: 3,
        activityMonths: 18,
        signedCommitRatio: 0.7,
        maintainerAttestations: 1,
        analyzerCoverage: 0.95
      },
      dimensionSignals: strongSignals,
      languageCoverage: 0.9
    });
    expect(s.confidence).toBeCloseTo(0.8803, 3);
    expect(s.passedEligibility).toBe(true);
    // shown = 50 + 0.8803*(raw − 50) must lie within [raw, 50] and > threshold
    expect(s.shownScore).toBeGreaterThanOrEqual(60);
    expect(s.shownScore).toBeLessThanOrEqual(s.rawScore);
    expect(s.rawScore).toBeGreaterThanOrEqual(0);
    expect(s.rawScore).toBeLessThanOrEqual(100);
  });

  it('abstains (no eligibility) when evidence is thin', () => {
    const thin = {
      quality: { survivalRate: 0.3, staticFindingsPerKLOC: 2, negativeTestRatio: 0.05 },
      security: { securityFindingsOpen: 2, signedCommitRatio: 0.2, dependencyVulns: 1 },
      architecture: { crossRepoImpact: 0.1, modularityScore: 0.3, cycleFree: false },
      testing: { testCoverage: 0.1, ciGreenRate: 0.2, negativeTestRatio: 0.05 },
      consistency: { activityMonths: 1, releaseCount: 0, prSizeDiscipline: 0.2 }
    };
    const s = computeScore({
      skillId: 'solana-anchor',
      accounting: {
        externalMergedPRs: 0,
        ownReviewedPRs: 0,
        reposWithTestsGreenCi: 0,
        activityMonths: 1,
        signedCommitRatio: 0.2,
        maintainerAttestations: 0,
        analyzerCoverage: 1.0
      },
      dimensionSignals: thin,
      languageCoverage: 0.6
    });
    expect(s.confidence).toBeCloseTo(0.01653, 4);
    expect(s.passedEligibility).toBe(false);
    expect(s.shownScore).toBeLessThan(55); // shrunk hard toward prior
  });

  it('respects a confidence cap for light packs (confidence ≤ 0.75)', () => {
    const s = computeScore({
      skillId: 'typescript',
      accounting: {
        externalMergedPRs: 12,
        ownReviewedPRs: 6,
        reposWithTestsGreenCi: 3,
        activityMonths: 18,
        signedCommitRatio: 0.7,
        maintainerAttestations: 1,
        analyzerCoverage: 0.95
      },
      dimensionSignals: strongSignals,
      languageCoverage: 0.9,
      confidenceCap: 0.75
    });
    expect(s.confidence).toBeLessThanOrEqual(0.75);
  });

  it('is reproducible: same inputs → same numeric outputs (deterministic)', () => {
    const options = {
      skillId: 'solana-anchor' as SkillId,
      accounting: {
        externalMergedPRs: 12,
        ownReviewedPRs: 6,
        reposWithTestsGreenCi: 3,
        activityMonths: 18,
        signedCommitRatio: 0.7,
        maintainerAttestations: 1,
        analyzerCoverage: 0.95
      },
      dimensionSignals: strongSignals,
      languageCoverage: 0.9
    };
    const a = computeScore(options);
    const b = computeScore(options);
    expect(a.shownScore).toBe(b.shownScore);
    expect(a.rawScore).toBe(b.rawScore);
    expect(a.confidence).toBe(b.confidence);
    expect(a.dimensions.map((d) => d.score)).toEqual(b.dimensions.map((d) => d.score));
  });
});

describe('accountingFromEvidence', () => {
  it('maps a typed evidence trail into the accounting input, de-duplicating by repo', () => {
    const trail: EvidenceItem[] = [
      evidence('EXTERNAL_MERGE', true, null, 'org/rustlings'), // PR1
      evidence('EXTERNAL_MERGE', true, null, 'org/rustlings'), // PR2 same repo → distinct reps = 1
      evidence('EXTERNAL_MERGE', true, null, 'org/solana-program-library'),
      evidence('OWN_PRB_REVIEWED', true, null, 'me/own-repo'),
      evidence('OWN_PRB_REVIEWED', true, null, 'me/own-repo'),
      evidence('REPO_TESTS_GREEN_CI', true, null, 'me/own-repo'),
      evidence('ACTIVITY_MONTH', true, 9, 'me/own-repo'),
      evidence('SIGNED_COMMIT_RATIO', true, 0.8, 'me/own-repo'),
      evidence('MAINTAINER_ATTESTATION', true, 1, 'org/rustlings'),
      evidence( 'STATIC_FINDING', false) // unused in accounting
    ];
    const acc = accountingFromEvidence(trail);
    expect(acc.externalMergedPRs).toBe(2);
    expect(acc.ownReviewedPRs).toBe(2);
    expect(acc.reposWithTestsGreenCi).toBe(1);
    expect(acc.activityMonths).toBe(9);
    expect(acc.signedCommitRatio).toBe(0.8);
    expect(acc.maintainerAttestations).toBe(1);
    expect(acc.analyzerCoverage).toBe(1);
  });
});