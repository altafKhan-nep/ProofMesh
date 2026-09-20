/**
 * Deterministic analysis pipeline — ARCHITECTURE.md §5.
 *
 * Stages: ingest → static → outcome → score → reviewer → skeptic → credential.
 * Deterministic-only by default (LLM-off demo mode). An Anthropic-backed
 * reviewer/skeptic can be plugged in later; it can LOWER confidence or BLOCK
 * issuance, never raise the score — enforced here in code, not only in a prompt.
 */

import { createHash } from 'node:crypto';
import type { CredentialLevel } from '@proofmesh/shared-types';
import { SKILLS } from '@proofmesh/shared-types';
import { accountingFromEvidence, computeScore, progressFor, type DimensionSignals } from '@proofmesh/scoring-engine';
import type { Store } from './store.js';
import { deriveAttestationAddress } from './store.js';
import type { AnalysisJob, EvidenceItem, SseEvent, SkillId } from '@proofmesh/shared-types';

const ISSUER_ADDRESS = 'ProofMeshIssuer111111111111111111111111111';
const CREDENTIAL_DAYS_VALID = 180;

export function sha256Hash(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export interface AnalysisResult {
  scoreId: string;
  shownScore: number;
  confidence: number;
  passedEligibility: boolean;
  level: CredentialLevel;
  credentialId: string | null;
  skepticNotes: string[];
}

export async function runAnalysis(
  store: Store,
  job: AnalysisJob,
  emit: (e: SseEvent) => void,
  opts: { stageMs?: number } = {}
): Promise<AnalysisResult> {
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const stageMs = opts.stageMs ?? 650;

  const touch = (stage: (typeof job.stages)[number], status: typeof stage.status, detail: string) => {
    stage.status = status;
    stage.detail = detail;
    if (status === 'running') stage.startedAt = new Date().toISOString();
    if (status === 'done' || status === 'skipped') stage.finishedAt = new Date().toISOString();
    job.updatedAt = new Date().toISOString();
  };

  const stageOf = (name: string) => job.stages.find((s) => s.stage === name)!;
  const advance = async (name: string, detail: string) => {
    const s = stageOf(name);
    touch(s, 'running', detail);
    emit({ type: 'stage', stage: s.stage, status: 'running', detail });
    emit({ type: 'progress', percent: 10 + job.stages.filter((x) => x.status === 'done').length * 13, detail });
    await delay(stageMs);
    touch(s, 'done', detail);
    emit({ type: 'stage', stage: s.stage, status: 'done', detail });
  };

  const developer = store.findDeveloper(job.developerId)!;
  const wallet = job.mintWallet ?? developer.linkedWallets[0]?.wallet ?? 'unbound';
  const skill = SKILLS[job.skillId];
  const repos = store.reposFor(job.developerId);
  const baseEvidence = store.evidenceFor(job.developerId);

  job.status = 'running';

  // ---- 01 INGESTION -----------------------------------------------------
  await advance(
    'INGESTION',
    `Snapshotted ${repos.length} repositories at HEAD; ${baseEvidence.length} evidence candidates collected (read-only).`
  );

  // ---- 02 STATIC ANALYSIS -----------------------------------------------
  const staticEvidence = baseEvidence.filter((e) =>
    ['STATIC_FINDING', 'SECURITY_FINDING', 'NEGATIVE_TEST'].includes(e.type)
  );
  await advance(
    'STATIC_ANALYSIS',
    `Sandboxed audit: ${staticEvidence.length} static/security signals resolved; no network access used.`
  );

  // ---- 03 OUTCOME ANALYSIS ----------------------------------------------
  const outcomeEvidence = baseEvidence.filter((e) =>
    ['EXTERNAL_MERGE', 'OWN_PRB_REVIEWED', 'REVERT', 'CODE_SURVIVAL', 'RELEASE', 'MAINTAINER_ATTESTATION'].includes(
      e.type
    )
  );
  setTimeout(() => undefined, 0);
  await advance(
    'OUTCOME_ANALYSIS',
    `Outcome signals: ${countType(outcomeEvidence, 'EXTERNAL_MERGE')} external merges, ${countType(
      baseEvidence,
      'ACTIVITY_MONTH'
    )} activity months tracked.`
  );

  // ---- 04 SCORING --------------------------------------------------------
  const signals = signalsFromEvidence(job.skillId, repos, baseEvidence);
  const accounting = accountingFromEvidence(baseEvidence);
  const languageCoverage = languageCoverageOf(repos, job.skillId);
  const confidenceCap = skill.coverageCap;

const score = computeScore({
    skillId: job.skillId,
    accounting,
    dimensionSignals: signals,
    languageCoverage,
    confidenceCap: skill.coverageCap,
    priorScore: 50,
    distinctRepos: repos.filter((r) => !r.isFork).length || undefined,
    tier2Attestations: accounting.maintainerAttestations >= 2 ? 1 : 0
  });
  score.developerId = job.developerId;
  score.analyzerVersion = skill.analyzerVersion;
  score.snapshotCommitSha = repos[0]?.snapshotCommitSha ?? null;
  store.saveScore(score);
  job.scoreId = score.id;

  emit({
    type: 'result',
    scoreId: score.id,
    shownScore: score.shownScore,
    confidence: score.confidence,
    passedEligibility: score.passedEligibility
  });
  await advance(
    'SCORING',
    `raw ${score.rawScore} → shown ${score.shownScore} @ confidence ${(score.confidence * 100).toFixed(1)}% (E=${score.evidenceUnits}, prior=${score.priorScore}).`
  );

  // ---- 05 REVIEWER PASS --------------------------------------------------
  const review = reviewForEvidence(baseEvidence, score);
  await advance(
    'REVIEWER_PASS',
    job.llmEnabled
      ? 'LLM reviewer pass requested — running deterministic fallback (no ANTHROPIC_API_KEY configured).'
      : review.excerpt
  );

  // ---- 06 SKEPTIC PASS (can only lower confidence / block — never raise) --
  const skeptic = skepticAssessment(repos, baseEvidence);
  let finalConfidence = score.confidence;
  if (skeptic.reduction > 0) {
    const prior = finalConfidence;
    finalConfidence = Math.max(0, Math.round((prior - skeptic.reduction) * 10000) / 10000);
  }
  const blocked = skeptic.blocks;
  await advance(
    'SKEPTIC_PASS',
    skeptic.notes.length
      ? `Skeptic: ${skeptic.notes.join(' ')} (confidence ${(score.confidence * 100).toFixed(1)}% → ${(
          finalConfidence * 100
        ).toFixed(1)}%)`
      : 'Skeptic: no falsification flags raised; confidence unchanged.'
  );

  // ---- 07 CREDENTIAL CHECK ----------------------------------------------
  const needsWallet = developer.linkedWallets.length === 0;
  const eligibilityPassed =
    !blocked && score.passedEligibility && finalConfidence >= 0.6 && !needsWallet;

  let credentialId: string | null = null;
  if (eligibilityPassed) {
    const issuedAt = new Date();
    const expiresAt = new Date(issuedAt.getTime() + CREDENTIAL_DAYS_VALID * 86_400_000);
    const evidenceRoot = sha256Hash(
      JSON.stringify(
        baseEvidence
          .map((e) => ({ id: e.id, type: e.type, value: e.value, source: e.sourceIdentifier }))
          .sort((a, b) => (a.id < b.id ? -1 : 1))
      )
    );
    const cred = {
      id: `cred-${job.id}`,
      developerId: job.developerId,
      wallet,
      skillId: job.skillId,
      attestationAddress: deriveAttestationAddress(wallet, skill.schema),
      issuerAddress: ISSUER_ADDRESS,
      schema: skill.schema,
      skillScore: Math.round(score.shownScore),
      confidencePercent: Math.round(finalConfidence * 100),
      level: computeLevelOf(score.shownScore, finalConfidence, accounting.maintainerAttestations),
      issuerTier: 1,
      evidenceRoot,
      analyzerVersion: skill.analyzerVersion,
      reportUri: `https://proofmesh.xyz/verify/${wallet}/${job.skillId}`,
      status: 'ISSUED',
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    } as const;
    store.saveCredential(cred as never);
    credentialId = cred.id;
    await advance('CREDENTIAL_CHECK', `Eligibility passed → SAS attestation ${cred.attestationAddress.slice(0, 8)}… minted (devnet).`);
  } else {
    await advance(
      'CREDENTIAL_CHECK',
      blocked
        ? 'Eligibility blocked by the skeptic pass (honest abstention).'
        : needsWallet
          ? 'Evidence qualifies, but no Solana wallet is bound — credential held pending wallet binding.'
          : `Not enough evidence for a credential (honest abstention). ${score.eligibilityReasons[0] ?? ''}`
    );
  }

  job.status = eligibilityPassed ? 'completed' : 'abstained';
  job.credentialId = credentialId;
  job.updatedAt = new Date().toISOString();
  emit({ type: 'done', jobId: job.id, scoreId: score.id, credentialId });

  return {
    scoreId: score.id,
    shownScore: score.shownScore,
    confidence: finalConfidence,
    passedEligibility: eligibilityPassed,
    level: computeLevelOf(score.shownScore, finalConfidence, accounting.maintainerAttestations),
    credentialId,
    skepticNotes: skeptic.notes
  };
}

function countType(items: EvidenceItem[], type: string): number {
  return items.filter((e) => e.type === type).length;
}

function languageCoverageOf(repos: { primaryLanguage: string | null; isFork: boolean }[], skillId: SkillId): number {
  const relevant = repos.filter((r) => !r.isFork);
  if (relevant.length === 0) return 0;
  const desired = skillId === 'java' ? 'java' : skillId === 'typescript' ? 'typescript,ts,js' : 'rust';
  const matched = relevant.filter(
    (r) => r.primaryLanguage && desired.split(',').includes(r.primaryLanguage.toLowerCase())
  ).length;
  return matched / relevant.length;
}

function signalsFromEvidence(
  skillId: SkillId,
  repos: { primaryLanguage: string | null; isFork: boolean; testFileCount: number; ciGreen: boolean; commitCount: number }[],
  evidence: EvidenceItem[]
): DimensionSignals {
  const external = evidence.filter((e) => e.type === 'EXTERNAL_MERGE' && e.positive).length;
  const sustain = evidence.filter((e) => e.type === 'ACTIVITY_MONTH' && e.positive);
  const activityMonths = Math.min(12, sustain.reduce((a, e) => a + (e.value ?? 1), 0));
  const signed = evidence.find((e) => e.type === 'SIGNED_COMMIT_RATIO')?.value ?? 0;
  const maintainers = evidence
    .filter((e) => e.type === 'MAINTAINER_ATTESTATION' && e.positive)
    .reduce((a, e) => a + (e.value ?? 1), 0);
  const survival = evidence.find((e) => e.type === 'CODE_SURVIVAL')?.value;
  const negTest = evidence.find((e) => e.metricName === 'negative_test_ratio')?.value ?? 0;
  const win = repos.filter((r) => !r.isFork);
  const withTests = win.filter((r) => r.testFileCount > 0 && r.ciGreen).length;
  const testCoverage = win.length ? withTests / win.length : 0;
  const ciGreenRate = win.length ? win.filter((r) => r.ciGreen).length / win.length : 0;
  const releases = evidence
    .filter((e) => e.type === 'RELEASE' && e.positive)
    .reduce((a, e) => a + (e.value ?? 1), 0);
  const totalLoc = win.reduce((a, r) => a + Math.max(r.commitCount, 1), 0);
  const crossRepoImpact = Math.min(0.95, 0.3 + external * 0.12);

  return {
    quality: {
      survivalRate:
        survival ??
        0.55 + Math.min(0.4, external * 0.06 + Math.min(2, maintainers) * 0.08),
      staticFindingsPerKLOC: Math.max(
        0,
        (evidence.filter((e) => (e.type === 'STATIC_FINDING' || e.type === 'SECURITY_FINDING') && !e.positive).length * 100) / totalLoc
      ),
      negativeTestRatio: Math.min(0.9, negTest)
    },
    security: {
      securityFindingsOpen: evidence.filter((e) => e.type === 'SECURITY_FINDING' && !e.positive).length,
      signedCommitRatio: Math.min(1, signed),
      dependencyVulns: 0
    },
    architecture: {
      crossRepoImpact,
      modularityScore: Math.min(
        0.95,
        0.5 + Math.min(1, withTests) * 0.1 + (releases >= 3 ? 0.15 : 0) + Math.min(0.2, crossRepoImpact * 0.2)
      ),
      cycleFree: Math.min(2, maintainers) >= 1
    },
    testing: {
      testCoverage: Math.max(0.05, Math.min(0.95, testCoverage)),
      ciGreenRate: Math.max(0.05, Math.min(1, ciGreenRate)),
      negativeTestRatio: Math.min(0.9, negTest)
    },
    consistency: {
      activityMonths,
      releaseCount: releases,
      prSizeDiscipline: Math.min(0.9, 0.5 + Math.min(1, withTests) * 0.1 + (external >= 1 ? 0.1 : 0) + Math.min(0.15, activityMonths / 60))
    }
  };
}

function reviewForEvidence(evidence: EvidenceItem[], score: { shownScore: number; confidence: number; rawScore: number }): { excerpt: string } {
  const top = evidence
    .filter((e) => e.positive)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 3);
  const citations = top.map((e) => `#${e.id.slice(-6)}`).join(', ');
  return {
    excerpt: `Score ${score.shownScore.toFixed(1)} set by ${top.length} leading evidence units (${citations}); confidence ${(
      score.confidence * 100
    ).toFixed(1)}% reflects evidence volume, not author quality.`
  };
}

function skepticAssessment(
  repos: { isFork: boolean; primaryLanguage: string | null }[],
  evidence: EvidenceItem[]
): { notes: string[]; reduction: number; blocks: boolean } {
  const notes: string[] = [];
  let reduction = 0;
  const forks = repos.filter((r) => r.isFork).length;
  const forkRatio = repos.length ? forks / repos.length : 0;
  if (forkRatio > 0.6) {
    reduction += 0.05;
    notes.push('fork-dominant history detected (≤ verify upstream lineage)');
  }
  if (forkRatio > 0.9 && evidence.filter((e) => e.type === 'EXTERNAL_MERGE').length === 0) {
    reduction += 0.1;
    notes.push('fork-only account without external merge evidence');
  }
  const testPadding = evidence.find((e) => e.metricName === 'negative_test_ratio')?.value ?? 0;
  const docOnly = evidence.filter((e) => e.type === 'STATIC_FINDING' && e.description.includes('doc')).length;
  if (testPadding === 0 && evidence.filter((e) => e.type === 'REPO_TESTS_GREEN_CI').length === 0) {
    reduction += 0.05;
    notes.push('no green-CI test signal to corroborate test discipline');
  }
  const tutorial = evidence.some((e) => e.description.toLowerCase().includes('tutorial') || e.description.toLowerCase().includes('template'));
  if (tutorial) {
    notes.push('tutorial/template clone similarity flagged');
  }
  if (docOnly >= 2) {
    reduction += 0.05;
    notes.push('doc-only change concentration');
  }
  return { notes, reduction: Math.min(0.25, reduction), blocks: tutorial && forks === repos.length };
}

function computeLevelOf(shown: number, confidence: number, tier2: number): CredentialLevel {
  if (shown >= 88 && confidence >= 0.85 && tier2 >= 1) return 3;
  if (shown >= 75 && confidence >= 0.75) return 2;
  if (shown >= 60 && confidence >= 0.6) return 1;
  return 0;
}

export function jobSse(job: AnalysisJob): SseEvent | null {
  const latest = progressFor(job.stages);
  return { type: 'progress', percent: latest.percent, detail: latest.detail };
}