/**
 * ProofMesh shared domain types.
 *
 * Mirrors ARCHITECTURE.md §7.1 (Postgres model) and §6 (scoring model).
 * These are the only types that flows between apps, workers and the SDK.
 */

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export interface Developer {
  id: string;
  githubId: string;
  githubUsername: string;
  githubHandle: string;
  avatarUrl: string | null;
  linkedWallets: WalletBinding[];
  createdAt: string;
  updatedAt: string;
}

export interface WalletBinding {
  id: string;
  developerId: string;
  wallet: string; // base58 Solana pubkey
  signedMessage: string; // base64 signed SIWS message
  nonce: string;
  domain: string;
  gistUrl: string | null;
  boundAt: string;
}

// ---------------------------------------------------------------------------
// Evidence model (ARCHITECTURE.md §7.1)
// ---------------------------------------------------------------------------

export type EvidenceType =
  | 'EXTERNAL_MERGE' // merged PR into a repo the developer does not own
  | 'OWN_PRB_REVIEWED' // own-repo PR with independent review
  | 'REPO_TESTS_GREEN_CI' // repo with tests + green CI
  | 'ACTIVITY_MONTH' // month of sustained activity
  | 'SIGNED_COMMIT_RATIO' // signed-commit ratio >= 0.5
  | 'MAINTAINER_ATTESTATION' // independent maintainer attestation (+5)
  | 'STATIC_FINDING' // static-analysis finding (good or bad)
  | 'SECURITY_FINDING'
  | 'NEGATIVE_TEST' // negative-test (asserting rejection) detected
  | 'REVERT' // post-merge revert / fix-up
  | 'CODE_SURVIVAL' // authored lines still present after 90 days
  | 'REVIEW_REVIEWED'
  | 'RELEASE';
export const EVIDENCE_TYPES: EvidenceType[] = [
  'EXTERNAL_MERGE',
  'OWN_PRB_REVIEWED',
  'REPO_TESTS_GREEN_CI',
  'ACTIVITY_MONTH',
  'SIGNED_COMMIT_RATIO',
  'MAINTAINER_ATTESTATION',
  'STATIC_FINDING',
  'SECURITY_FINDING',
  'NEGATIVE_TEST',
  'REVERT',
  'CODE_SURVIVAL',
  'REVIEW_REVIEWED',
  'RELEASE'
];

/** A single, source-linked, typed fact. Derived metrics and hashes only — never raw repo contents. */
export interface EvidenceItem {
  id: string;
  analysisRunId: string;
  type: EvidenceType;
  /** human-readable description shown on the report page */
  description: string;
  /** source URL on GitHub (PR, commit, release, …) */
  sourceUrl: string | null;
  sourceIdentifier: string | null; // PR #482, sha, tag …
  metricName: string | null;
  value: number | null;
  /** whether this item is positive evidence for the credential */
  positive: boolean;
  /** deterministic analyzer version that produced it */
  sourceVersion: string;
  capturedAt: string;
}

export interface RepoSnapshot {
  id: string;
  developerId: string;
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  primaryLanguage: string | null;
  snapshotCommitSha: string | null;
  isFork: boolean;
  starsAtSnapshot: number;
  snapshotAt: string;
  commitCount: number;
  prCount: number;
  testFileCount: number;
  ciGreen: boolean;
}

// ---------------------------------------------------------------------------
// Scores (ARCHITECTURE.md §6)
// ---------------------------------------------------------------------------

export const DIMENSIONS = [
  'quality',
  'security',
  'architecture',
  'testing',
  'consistency'
] as const;
export type DimensionId = (typeof DIMENSIONS)[number];

export const DIMENSION_WEIGHTS: Record<DimensionId, number> = {
  quality: 0.2,
  security: 0.25,
  architecture: 0.15,
  testing: 0.25,
  consistency: 0.15
};

/** Winning levels (ARCHITECTURE.md §6) */
export type CredentialLevel = 0 | 1 | 2 | 3; // 0 = no credential, 1=Verified 2=Strong 3=Expert
export const LEVEL_INFO: Record<number, { label: string; minScore: number; minConfidence: number }> = {
  0: { label: 'Not Enough Evidence', minScore: 0, minConfidence: 0 },
  1: { label: 'Verified', minScore: 60, minConfidence: 0.6 },
  2: { label: 'Strong', minScore: 75, minConfidence: 0.75 },
  3: { label: 'Expert', minScore: 88, minConfidence: 0.85 }
};

export interface DimensionScore {
  dimension: DimensionId;
  /** percentile 0-100 against reference corpus */
  score: number;
  /** evidence units contributed from this dimension's signals */
  evidenceUnits: number;
  notes: string[];
}

export interface ScoreSnapshot {
  id: string;
  developerId: string;
  skillId: SkillId;
  rawScore: number; // weighted sum 0-100, before shrinkage
  shownScore: number; // prior + c·(raw − prior)
  confidence: number; // c = 1 − exp(−E/E0)
  evidenceUnits: number; // E
  priorScore: number; // corpus median
  dimensions: DimensionScore[];
  cohort: string;
  snapshotCommitSha: string | null;
  scoredAt: string;
  analyzerVersion: string;
  passedEligibility: boolean;
  eligibilityReasons: string[];
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export const SKILLS = {
  'solana-anchor': {
    id: 'solana-anchor',
    label: 'Solana / Anchor',
    analyzerVersion: 'pow.solana-anchor.v1',
    coverageCap: 1.0,
    schema: 'pow.solana-anchor.v1'
  },
  typescript: {
    id: 'typescript',
    label: 'TypeScript',
    analyzerVersion: 'pow.typescript.v1',
    coverageCap: 0.75, // light pack — confidence capped at 0.75
    schema: 'pow.typescript.v1'
  },
  java: {
    id: 'java',
    label: 'Java',
    analyzerVersion: 'pow.java.v1',
    coverageCap: 0.75,
    schema: 'pow.java.v1'
  }
} as const;

export type SkillId = keyof typeof SKILLS;

// ---------------------------------------------------------------------------
// Credentials (on-chain SAS representation — ARCHITECTURE.md §7.2)
// ---------------------------------------------------------------------------

export type CredentialStatus = 'ISSUED' | 'EXPIRED' | 'REVOKED';

export interface Credential {
  id: string;
  developerId: string;
  wallet: string;
  skillId: SkillId;
  /** SAS attestation address / PDA */
  attestationAddress: string;
  issuerAddress: string;
  schema: string;
  skillScore: number; // u8 0-100, already shrunk
  confidencePercent: number; // u8 0-100
  level: CredentialLevel; // 1=Verified 2=Strong 3=Expert
  issuerTier: number; // 1=automated …
  evidenceRoot: string; // 32-byte hash hex
  analyzerVersion: string;
  reportUri: string;
  status: CredentialStatus;
  issuedAt: string;
  expiresAt: string; // now + 180 days
}

// ---------------------------------------------------------------------------
// Analysis jobs / pipeline
// ---------------------------------------------------------------------------

export const PIPELINE_STAGES = [
  'INGESTION',
  'STATIC_ANALYSIS',
  'OUTCOME_ANALYSIS',
  'SCORING',
  'REVIEWER_PASS',
  'SKEPTIC_PASS',
  'CREDENTIAL_CHECK'
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'abstained';

export interface PipelineStageStatus {
  stage: PipelineStage;
  status: 'pending' | 'running' | 'done' | 'skipped';
  detail: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface AnalysisJob {
  id: string;
  developerId: string;
  githubUsername: string;
  skillId: SkillId;
  status: JobStatus;
  stages: PipelineStageStatus[];
  error: string | null;
  scoreId: string | null;
  credentialId: string | null;
  createdAt: string;
  updatedAt: string;
  /** enable LLM passes (feature-flagged; deterministic-only fallback) */
  llmEnabled: boolean;
  /** wallet the credential must be minted to (from the analyze caller, or null → developer's first bound wallet) */
  mintWallet: string | null;
}

// ---------------------------------------------------------------------------
// Evidence units accounting (ARCHITECTURE.md §6)
// ---------------------------------------------------------------------------

export interface EvidenceAccounting {
  externalMergedPRs: number;
  ownReviewedPRs: number;
  reposWithTestsGreenCi: number;
  activityMonths: number;
  signedCommitBonus: number; // 0 or 2
  maintainerAttestations: number;
  analyzerCoverage: number; // 0.3 – 1.0
  totalUnits: number;
}

export const CALIBRATION = {
  E0: 30,
  priorPercentile: 50,
  unitValues: {
    externalMergedPR: 3,
    ownReviewedPR: 2,
    repoTestsGreenCi: 2,
    activityMonth: 0.5,
    signedCommitBonus: 2,
    maintainerAttestation: 5
  },
  activityMonthCap: 12,
  minConfidence: 0.6,
  minLanguageCoverage: 0.5,
  minRepos: 2
} as const;

// ---------------------------------------------------------------------------
// Sponsor console
// ---------------------------------------------------------------------------

export interface Sponsor {
  id: string;
  name: string;
  wallet: string | null;
  tier: number;
}

export interface Listing {
  id: string;
  sponsorId: string;
  title: string;
  description: string;
  requiredSkills: SkillId[];
  minScore: number;
  minConfidence: number;
  minLevel: number;
  activeWithinDays: number;
  inviteUrl: string | null;
  createdAt: string;
}

export interface Invite {
  id: string;
  listingId: string;
  developerId: string | null;
  wallet: string | null;
  status: 'sent' | 'accepted' | 'declined';
  message: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Public verify / badge
// ---------------------------------------------------------------------------

export interface VerifyResult {
  valid: boolean;
  wallet: string;
  skillId: SkillId;
  skillLabel: string;
  score: number;
  confidence: number;
  level: CredentialLevel;
  issuerAddress: string;
  schema: string;
  analyzerVersion: string;
  evidenceRoot: string;
  reportUri: string;
  issuedAt: string;
  expiresAt: string;
  status: CredentialStatus;
}

export interface VerifierOptions {
  minScore?: number;
  minConfidence?: number;
  issuerAllowlist?: string[];
}

// ---------------------------------------------------------------------------
// API DTOs
// ---------------------------------------------------------------------------

export interface AnalyzeRequest {
  developerId?: string;
  githubUsername?: string;
  skillId: SkillId;
  llmEnabled?: boolean;
  /** explicit repo full names; when empty, the pipeline infers from the developer profile */
  repos?: string[];
  /** Solana wallet address the caller wants to bind & mint the credential to */
  wallet?: string;
}

export interface BindWalletRequest {
  githubUsername: string;
  wallet: string;
}

export interface AnalyzeResponse {
  job: AnalysisJob;
}

export type SseEvent =
  | { type: 'stage'; stage: PipelineStage; status: PipelineStageStatus['status']; detail: string }
  | { type: 'progress'; percent: number; detail: string }
  | { type: 'result'; scoreId: string; shownScore: number; confidence: number; passedEligibility: boolean }
  | { type: 'done'; jobId: string; scoreId: string | null; credentialId: string | null }
  | { type: 'error'; message: string };

export interface EvidenceReport {
  developer: Developer;
  snapshot: {
    repos: RepoSnapshot[];
    score: ScoreSnapshot | null;
    credential: Credential | null;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface SearchDevelopersQuery {
  skills?: SkillId[];
  minScore?: number;
  minConfidence?: number;
  minLevel?: number;
  activeWithinDays?: number;
  limit?: number;
}

export type CandidateDeveloper = Developer &
  Partial<{ score: ScoreSnapshot; level: CredentialLevel; skillId: SkillId }>;