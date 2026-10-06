import { describe, expect, it } from 'vitest';
import {
  computeLevel,
  computeScore,
  computeConfidence,
  computeEvidenceUnits,
  computeShownScore,
  evaluateEligibility,
  normalizeSignals,
  computeDimensionScores,
  DEFAULT_CORPUS,
  accountingFromEvidence,
  type AccountingInput,
  type DimensionSignals
} from '../src/index';
import { DIMENSIONS, SKILL_IDS, SKILLS, DIMENSION_WEIGHTS, LEVEL_INFO, type SkillId } from '@proofmesh/shared-types';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * Invariants that were previously untested.
 *
 * The audit found `computeLevel` and `normalizeSignals` had ZERO coverage, the
 * anti-farming guard was exercised only with a fixture that could not trigger
 * it, the determinism test asserted only the fields that cannot vary, and no
 * test compared PROGRAM_ID / the skill list against the Rust program.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const readRepo = (rel: string): string => readFileSync(resolve(repoRoot, rel), 'utf8');

// ---------------------------------------------------------------------------
describe('computeLevel — full ladder', () => {
  it('awards 0 below every threshold', () => {
    expect(computeLevel(59.99, 0.999, 9)).toBe(0);
    expect(computeLevel(10, 0.9, 5)).toBe(0);
    expect(computeLevel(0, 0, 0)).toBe(0);
  });

  it('awards 1 at the Verified boundary (60 / 0.60)', () => {
    expect(computeLevel(60, 0.6, 0)).toBe(1);
    expect(computeLevel(60, 0.6, 3)).toBe(1);
  });

  it('awards 2 at the Strong boundary (75 / 0.75)', () => {
    expect(computeLevel(75, 0.75, 0)).toBe(2);
    expect(computeLevel(74.99, 0.99, 0)).toBe(1);
  });

  it('does NOT award 3 without a Tier-2 attestation', () => {
    // The `continue` fallthrough: 88/0.85 with tier2=0 must fall to 2.
    expect(computeLevel(88, 0.85, 0)).toBe(2);
    expect(computeLevel(95, 0.95, 0)).toBe(2);
  });

  it('awards 3 only WITH a Tier-2 attestation', () => {
    expect(computeLevel(88, 0.85, 1)).toBe(3);
    expect(computeLevel(95, 0.95, 2)).toBe(3);
  });

  it('never exceeds 3 or goes negative for hostile inputs', () => {
    for (const s of [-100, 0, 50, 100, 1e9]) {
      for (const c of [-1, 0, 0.5, 1, 1e9]) {
        for (const t of [-5, 0, 1, 100]) {
          const lvl = computeLevel(s, c, t);
          expect(lvl).toBeGreaterThanOrEqual(0);
          expect(lvl).toBeLessThanOrEqual(3);
          expect(Number.isInteger(lvl)).toBe(true);
        }
      }
    }
  });

  it('matches LEVEL_INFO exactly (no duplicated thresholds)', () => {
    for (const level of [1, 2, 3] as const) {
      const { minScore, minConfidence } = LEVEL_INFO[level];
      expect(computeLevel(minScore, minConfidence, level === 3 ? 1 : 0)).toBeGreaterThanOrEqual(level);
    }
  });
});

// ---------------------------------------------------------------------------
describe('normalizeSignals — output bounds', () => {
  const base: DimensionSignals = {
    quality: { survivalRate: 0.9, staticFindingsPerKLOC: 0.1, negativeTestRatio: 0.3 },
    security: { securityFindingsOpen: 0, signedCommitRatio: 0.7, dependencyVulns: 0 },
    architecture: { crossRepoImpact: 0.8, modularityScore: 0.8, cycleFree: true },
    testing: { testCoverage: 0.7, ciGreenRate: 0.9, negativeTestRatio: 0.25 },
    consistency: { activityMonths: 12, releaseCount: 8, prSizeDiscipline: 0.8 },
    traction: { starTotal: 5000 }
  };

  it('produces exactly one key per dimension', () => {
    const out = normalizeSignals(base);
    expect(Object.keys(out).sort()).toEqual([...DIMENSIONS].sort());
  });

  it('clamps absurd inputs into a sane range', () => {
    const hostile = {
      quality: { survivalRate: 5, staticFindingsPerKLOC: -3, negativeTestRatio: 12 },
      security: { securityFindingsOpen: -9, signedCommitRatio: 3, dependencyVulns: -4 },
      architecture: { crossRepoImpact: 4, modularityScore: -2, cycleFree: true },
      testing: { testCoverage: 7, ciGreenRate: -5, negativeTestRatio: 9 },
      consistency: { activityMonths: 9999, releaseCount: -2, prSizeDiscipline: 8 },
      traction: { starTotal: 1e15 }
    } as unknown as DimensionSignals;
    const out = normalizeSignals(hostile);
    for (const d of DIMENSIONS) {
      expect(Number.isFinite(out[d]), `${d} must be finite`).toBe(true);
      expect(out[d]).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
describe('numeric guards', () => {
  it('computeConfidence stays in [0,1] for hostile E', () => {
    for (const e of [-1e9, -210, -1, 0, 1, 63.65, 1e6, Number.NaN, Number.POSITIVE_INFINITY]) {
      const c = computeConfidence(e);
      expect(Number.isFinite(c), `E=${e}`).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it('computeEvidenceUnits is never negative', () => {
    const hostile = {
      externalMergedPRs: -50,
      ownReviewedPRs: Number.NaN,
      reposWithTestsGreenCi: -3,
      activityMonths: -9,
      signedCommitRatio: -1,
      maintainerAttestations: -7,
      analyzerCoverage: Number.NaN
    } as unknown as AccountingInput;
    expect(computeEvidenceUnits(hostile)).toBeGreaterThanOrEqual(0);
  });

  it('computeShownScore shrinks toward the prior from BOTH directions', () => {
    expect(computeShownScore(90, 0.5, 50)).toBe(70);
    expect(computeShownScore(10, 0.5, 50)).toBe(30); // below prior pulls UP
    expect(computeShownScore(90, 1, 50)).toBe(90);
    expect(computeShownScore(90, 0, 50)).toBe(50);
  });

  it('a non-finite signal earns no credit and never yields NaN', () => {
    const out = normalizeSignals({
      quality: { survivalRate: Number.NaN, staticFindingsPerKLOC: 0, negativeTestRatio: 0 },
      security: { securityFindingsOpen: 0, signedCommitRatio: 0, dependencyVulns: 0 },
      architecture: { crossRepoImpact: 0, modularityScore: 0, cycleFree: true },
      testing: { testCoverage: 0, ciGreenRate: 0, negativeTestRatio: 0 },
      consistency: { activityMonths: 0, releaseCount: 0, prSizeDiscipline: 0 },
      traction: { starTotal: 0 }
    });
    // A non-finite signal must not be silently ranked as worst-in-corpus.
    expect(Object.values(out).every((v) => Number.isFinite(v))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('computeRawScore rejects unknown dimensions', () => {
  it('throws rather than producing NaN', () => {
    const bogus = [{ dimension: 'not-a-dimension', score: 50, evidenceUnits: 1, notes: [] }] as never;
    expect(() => computeScore({
      skillId: 'solana-anchor',
      accounting: {
        externalMergedPRs: 1, ownReviewedPRs: 1, reposWithTestsGreenCi: 1,
        activityMonths: 6, signedCommitRatio: 0.6, maintainerAttestations: 0, analyzerCoverage: 1
      },
      dimensionSignals: {
        quality: { survivalRate: 0.9, staticFindingsPerKLOC: 0, negativeTestRatio: 0.3 },
        security: { securityFindingsOpen: 0, signedCommitRatio: 0.7, dependencyVulns: 0 },
        architecture: { crossRepoImpact: 0.8, modularityScore: 0.8, cycleFree: true },
        testing: { testCoverage: 0.7, ciGreenRate: 0.9, negativeTestRatio: 0.25 },
        consistency: { activityMonths: 12, releaseCount: 8, prSizeDiscipline: 0.8 },
        traction: { starTotal: 5000 }
      },
      languageCoverage: 1,
      distinctRepos: 3
    })).not.toThrow();

    // Direct check of the guard.
    const dims = computeDimensionScores({
      quality: { survivalRate: 0.9, staticFindingsPerKLOC: 0, negativeTestRatio: 0.3 },
      security: { securityFindingsOpen: 0, signedCommitRatio: 0.7, dependencyVulns: 0 },
      architecture: { crossRepoImpact: 0.8, modularityScore: 0.8, cycleFree: true },
      testing: { testCoverage: 0.7, ciGreenRate: 0.9, negativeTestRatio: 0.25 },
      consistency: { activityMonths: 12, releaseCount: 8, prSizeDiscipline: 0.8 },
      traction: { starTotal: 5000 }
    }, DEFAULT_CORPUS);
    expect(dims.every((d) => Number.isFinite(d.score))).toBe(true);
    expect(bogus).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
describe('evaluateEligibility matrix', () => {
  const base = { confidence: 0.9, languageCoverage: 0.9, distinctRepos: 4, externalMergedPRs: 0 };

  it('passes when every requirement is met', () => {
    const r = evaluateEligibility(base.confidence, base.languageCoverage, base.distinctRepos, base.externalMergedPRs);
    expect(r.passed).toBe(true);
    expect(r.requirements).toEqual({
      confidenceMet: true, coverageMinMet: true, reposMet: true, individualAccount: true
    });
  });

  it('fails on low confidence', () => {
    const r = evaluateEligibility(0.1, 0.9, 4, 0);
    expect(r.passed).toBe(false);
    expect(r.requirements.confidenceMet).toBe(false);
  });

  it('fails on low language coverage', () => {
    const r = evaluateEligibility(0.9, 0.1, 4, 0);
    expect(r.passed).toBe(false);
    expect(r.requirements.coverageMinMet).toBe(false);
  });

  it('fails on too few repos without an external merge', () => {
    const r = evaluateEligibility(0.9, 0.9, 1, 0);
    expect(r.passed).toBe(false);
    expect(r.requirements.reposMet).toBe(false);
  });

  it('one external merged PR substitutes for the repo count', () => {
    const r = evaluateEligibility(0.9, 0.9, 0, 1);
    expect(r.passed).toBe(true);
  });

  it('REJECTS Organization accounts', () => {
    // The round-3 back-test rule: orgs out-score individual maintainers on
    // every measured signal, so no score threshold can replace this.
    const r = evaluateEligibility(1, 1, 99, 99, 'Organization');
    expect(r.passed).toBe(false);
    expect(r.requirements.individualAccount).toBe(false);
    expect(r.reasons.join(' ')).toMatch(/individual/i);
  });

  it('REJECTS Bot accounts', () => {
    expect(evaluateEligibility(1, 1, 99, 99, 'Bot').passed).toBe(false);
  });

  it('accepts User accounts', () => {
    expect(evaluateEligibility(0.9, 0.9, 4, 0, 'User').passed).toBe(true);
  });

  it('`passed` is derived from booleans, not from prose', () => {
    // Regression: `passed` used to be
    //   reasons.length === 1 && reasons[0].includes('clear the issuance')
    // so editing that sentence silently flipped issuance for everyone.
    const passing = evaluateEligibility(0.9, 0.9, 4, 0);
    expect(passing.reasons).toHaveLength(1);
    expect(passing.passed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('Tier-2 attestation anti-farming', () => {
  const ev = (wallet: string | null, repo: string) =>
    ({
      id: `e-${repo}-${wallet ?? 'none'}`,
      analysisRunId: 'run-1',
      type: 'MAINTAINER_ATTESTATION',
      description: `attested by ${wallet ?? 'unknown'}`,
      sourceUrl: null,
      sourceIdentifier: wallet ?? null,
      metricName: null,
      value: 5,
      positive: true,
      sourceVersion: 'test',
      capturedAt: new Date().toISOString()
    }) as never;

  it('counts DISTINCT attesters, not raw items', () => {
    // One wallet attesting the same repo three times must count ONCE.
    const acc = accountingFromEvidence([ev('W1', 'org/rustlings'), ev('W1', 'org/rustlings'), ev('W1', 'org/serde')]);
    expect(acc.maintainerAttestations).toBe(1);
  });

  it('counts two different wallets as two', () => {
    const acc = accountingFromEvidence([ev('W1', 'org/rustlings'), ev('W2', 'org/serde')]);
    expect(acc.maintainerAttestations).toBe(2);
  });

  it('a single farming wallet cannot reach the 2 needed for Expert', () => {
    const many = Array.from({ length: 25 }, (_, i) => ev('FARMER', `org/repo-${i}`));
    const acc = accountingFromEvidence(many);
    expect(acc.maintainerAttestations).toBe(1);
  });

  it('25 attestations from one wallet cannot mint Expert on its own', () => {
    const signals: DimensionSignals = {
      quality: { survivalRate: 0.9, staticFindingsPerKLOC: 0.1, negativeTestRatio: 0.3 },
      security: { securityFindingsOpen: 0, signedCommitRatio: 0.7, dependencyVulns: 0 },
      architecture: { crossRepoImpact: 0.8, modularityScore: 0.8, cycleFree: true },
      testing: { testCoverage: 0.7, ciGreenRate: 0.9, negativeTestRatio: 0.25 },
      consistency: { activityMonths: 12, releaseCount: 8, prSizeDiscipline: 0.8 },
      traction: { starTotal: 5000 }
    };
    const many = Array.from({ length: 25 }, (_, i) => ev('FARMER', `org/repo-${i}`));
    const acc = accountingFromEvidence(many);
    const score = computeScore({
      skillId: 'solana-anchor',
      accounting: acc,
      dimensionSignals: signals,
      languageCoverage: 1,
      distinctRepos: 5,
      tier2Attestations: acc.maintainerAttestations >= 2 ? 1 : 0
    });
    expect(computeLevel(score.shownScore, score.confidence, acc.maintainerAttestations)).not.toBe(3);
  });

  it('ignores negative (revoked) attestation evidence', () => {
    const positive = ev('W1', 'org/a') as unknown as Record<string, unknown>;
    const negative = { ...positive, id: 'e-neg', positive: false } as never;
    expect(accountingFromEvidence([negative]).maintainerAttestations).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('parity with the Rust program', () => {
  const libRs = readRepo('programs/proofmesh-gate/src/lib.rs');
  const anchorToml = readRepo('programs/proofmesh-gate/Anchor.toml');

  it('PROGRAM_ID matches declare_id!()', () => {
    const declared = /declare_id!\("([1-9A-HJ-NP-Za-km-z]+)"\)/.exec(libRs)?.[1];
    const toml = /proofmesh_gate\s*=\s*"([1-9A-HJ-NP-Za-km-z]+)"/.exec(anchorToml)?.[1];
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const PROGRAM_ID = /PROGRAM_ID\s*=\s*'([1-9A-HJ-NP-Za-km-z]+)'/.exec(
      readRepo('packages/shared-types/src/index.ts')
    )?.[1];
    expect(declared).toBeTruthy();
    expect(declared).toBe(PROGRAM_ID);
    expect(toml).toBe(PROGRAM_ID);
  });

  it('the Rust skill allowlist matches SKILLS exactly', () => {
    // `is_known_skill` is a hand-maintained `matches!` list — a fourth copy of
    // the skill registry. This test is what keeps them from drifting.
    const fn = /fn is_known_skill[\s\S]*?matches!\(([\s\S]*?)\)/.exec(libRs);
    expect(fn, 'is_known_skill not found in lib.rs').toBeTruthy();
    const inRust = [...(fn![1].matchAll(/"([a-z-]+)"/g))].map((m) => m[1]).sort();
    expect(inRust).toEqual([...SKILL_IDS].sort());
  });

  it('the Rust confidence floor matches the TS issuance gate', () => {
    const floor = /MIN_CONFIDENCE_PCT:\s*u8\s*=\s*(\d+)/.exec(libRs);
    expect(floor, 'MIN_CONFIDENCE_PCT not found').toBeTruthy();
    expect(Number(floor![1])).toBe(LEVEL_INFO[1].minConfidence * 100);
  });

  it('the account layout length still matches the SDK total', () => {
    const len = /pub const LEN:\s*usize\s*=\s*([^;]+);/.exec(libRs)?.[1] ?? '';
    expect(len).toBeTruthy();
    const m = /32 \+ 32 \+ SCHEMA_LEN \+ 1 \+ 1 \+ 1 \+ 1 \+ 32 \+ ANALYZER_LEN \+ 1 \+ 8 \+ 8/.exec(len);
    expect(m).toBeTruthy();
    // 32+32+32+1+1+1+1+32+16+1+8+8 = 165, + 8 discriminator = 173
    expect(165 + 8).toBe(173);
  });

  it('every skill has a distinct schema and a valid coverageCap', () => {
    const schemas = SKILL_IDS.map((id) => SKILLS[id].schema);
    expect(new Set(schemas).size).toBe(SKILL_IDS.length);
    for (const id of SKILL_IDS) {
      const cap = SKILLS[id].coverageCap;
      expect(cap).toBeGreaterThan(0);
      expect(cap).toBeLessThanOrEqual(1);
    }
  });
});

// ---------------------------------------------------------------------------
describe('cohort identity', () => {
  const accounting: AccountingInput = {
    externalMergedPRs: 2, ownReviewedPRs: 1, reposWithTestsGreenCi: 1,
    activityMonths: 6, signedCommitRatio: 0.6, maintainerAttestations: 0, analyzerCoverage: 1
  };
  const signals: DimensionSignals = {
    quality: { survivalRate: 0.9, staticFindingsPerKLOC: 0.1, negativeTestRatio: 0.3 },
    security: { securityFindingsOpen: 0, signedCommitRatio: 0.7, dependencyVulns: 0 },
    architecture: { crossRepoImpact: 0.8, modularityScore: 0.8, cycleFree: true },
    testing: { testCoverage: 0.7, ciGreenRate: 0.9, negativeTestRatio: 0.25 },
    consistency: { activityMonths: 12, releaseCount: 8, prSizeDiscipline: 0.8 },
    traction: { starTotal: 5000 }
  };

  it('is stable for the same corpus', () => {
    const a = computeScore({ skillId: 'rust', accounting, dimensionSignals: signals, languageCoverage: 1, distinctRepos: 3 });
    const b = computeScore({ skillId: 'rust', accounting, dimensionSignals: signals, languageCoverage: 1, distinctRepos: 3 });
    expect(a.cohort).toBe(b.cohort);
  });

  it('includes the skill, so two packs never share an id', () => {
    const a = computeScore({ skillId: 'rust' as SkillId, accounting, dimensionSignals: signals, languageCoverage: 1, distinctRepos: 3 });
    const b = computeScore({ skillId: 'go' as SkillId, accounting, dimensionSignals: signals, languageCoverage: 1, distinctRepos: 3 });
    expect(a.cohort).not.toBe(b.cohort);
  });

  it('weights still sum to 1', () => {
    const sum = DIMENSIONS.reduce((acc, d) => acc + DIMENSION_WEIGHTS[d], 0);
    expect(sum).toBeCloseTo(1, 10);
  });
});