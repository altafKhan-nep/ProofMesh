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
  /** GitHub account type. ProofMesh credentials are individual-only: Organization
   *  and Bot accounts are never issuance-eligible regardless of repo signals. */
  accountType?: 'User' | 'Organization' | 'Bot';
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
  /**
   * Proof status. `wallet` is proven by a signature over an audience-bound
   * challenge; `github` stays 'pending' until GitHub-side ownership is proven
   * (OAuth). No credential may be minted for a binding that is not verified.
   */
  verified?: { wallet: boolean; github: 'proven' | 'pending' };
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
  | 'RELEASE'
  | 'REPO_TRACTION'; // owned repo with ≥ 200 stars (round-2 public-scan signal)
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
  'RELEASE',
  'REPO_TRACTION'
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
  /** Non-test source files seen in the inspected tree (test-density denominator). */
  sourceFileCount?: number;
  ciGreen: boolean;
  /** Deep-ingest inspected this repo's tree/CI (testFileCount/ciGreen are real, not defaults). */
  inspected?: boolean;
}

// ---------------------------------------------------------------------------
// Scores (ARCHITECTURE.md §6)
// ---------------------------------------------------------------------------

export const DIMENSIONS = [
  'quality',
  'security',
  'architecture',
  'testing',
  'consistency',
  'traction' as const
];
export type DimensionId = (typeof DIMENSIONS)[number];

/** Round-2 weights (ARCHITECTURE.md §6): back-test showed live signals floor
 *  every dimension at percentile 0 except where free repo metadata (stars,
 *  release cadence) actually differentiates. Traction carries 12% so star-backed
 *  reach can move the raw score without dominating it. */
export const DIMENSION_WEIGHTS: Record<DimensionId, number> = {
  quality: 0.18,
  security: 0.22,
  architecture: 0.14,
  testing: 0.22,
  consistency: 0.12,
  traction: 0.12
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
  tractionRepos: number; // distinct owned repos ≥ 200 stars
  signedCommitBonus: number; // 0 or 2
  maintainerAttestations: number;
  analyzerCoverage: number; // 0.3 – 1.0
  totalUnits: number;
}

export const CALIBRATION = {
  /** Round-2 back-test target: public-scan evidence (activity months + traction
   *  repos) must let a genuinely active maintainer clear c ≥ 0.60, where E0=30
   *  structurally capped live confidence at ~11% (see docs/backtest-round-1.json). */
  E0: 8,
  priorPercentile: 50,
  unitValues: {
    externalMergedPR: 3,
    ownReviewedPR: 2,
    repoTestsGreenCi: 2,
    activityMonth: 0.5,
    tractionRepo: 2,
    signedCommitBonus: 2,
    maintainerAttestation: 5
  },
  activityMonthCap: 12,
  tractionRepoStars: 200,
  tractionRepoCap: 4,
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
  | { type: 'done'; jobId: string; scoreId: string | null; credentialId: string | null; attestationAddress: string | null; mintConfirmed: boolean }
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

// ---------------------------------------------------------------------------
// Auth / SIWS (Epic 2 — wallet sign-in + admin console)
// ---------------------------------------------------------------------------

export type AuthRole = 'user' | 'admin';

/** Single-use, time-boxed SIWS challenge issued before a wallet signs. */
export interface SiwsChallenge {
  wallet: string; // base58 pubkey that must sign
  nonce: string; // random, single-use
  message: string; // the exact string the wallet signs (SIWS-shaped)
  domain: string; // e.g. proofmesh.xyz
  uri: string; // page URL the wallet is signing on behalf of
  chainId: string; // "solana:101" (devnet)
  issuedAt: string; // ISO
  expirationTime: string; // ISO
  /** Audience binding: a 'signin' challenge can never be replayed as a 'bind' proof. */
  purpose?: 'signin' | 'bind';
  /** For purpose='bind': the GitHub account the signature authorises. */
  subject?: string;
}

export interface SiwsVerifyRequest {
  wallet: string;
  message: string; // must equal the challenged message (immutable replay guard)
  signature: string; // base64 ed25519 signature over the message bytes
}

export interface AuthSession {
  token: string; // opaque bearer token (256-bit random); also set as an httpOnly cookie
  csrfToken?: string; // double-submit token; readable by JS, echoed in x-pm-csrf
  wallet: string;
  role: AuthRole;
  issuedAt: string;
  expiresAt: string;
  lastSeenAt?: string; // sliding idle window (2h); absolute lifetime stays expiresAt
}

/** A privileged-action proof: the wallet signs this exact request (P2). */
export interface ActionProofChallenge {
  nonce: string;
  wallet: string;
  method: string;
  path: string;
  bodyHash: string;
  issuedAt: string;
  expirationTime: string;
  message: string;
}

export interface AuthMe {
  wallet: string;
  role: AuthRole;
  expiresAt: string;
}