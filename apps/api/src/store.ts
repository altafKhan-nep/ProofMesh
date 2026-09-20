/**
 * Deterministic in-memory store with calibrated seed data.
 *
 * Phase-2+ reality: production uses Postgres (Prisma) + Redis (BullMQ) per
 * ARCHITECTURE.md. This store implements the same read/write surface so the
 * whole product runs locally with zero infra; swap `store.ts` for real
 * adapters without touching routes or the pipeline.
 */

import {
  SKILLS,
  type AnalysisJob,
  type CandidateDeveloper,
  type Credential,
  type Developer,
  type EvidenceItem,
  type EvidenceType,
  type Invite,
  type Listing,
  type PIPELINE_STAGES,
  type RepoSnapshot,
  type ScoreSnapshot,
  type SearchDevelopersQuery,
  type SkillId,
  type WalletBinding
} from '@proofmesh/shared-types';

const PIPELINE: (typeof PIPELINE_STAGES)[number][] = [
  'INGESTION',
  'STATIC_ANALYSIS',
  'OUTCOME_ANALYSIS',
  'SCORING',
  'REVIEWER_PASS',
  'SKEPTIC_PASS',
  'CREDENTIAL_CHECK'
];

export class Store {
  readonly developers = new Map<string, Developer>();
  readonly repos = new Map<string, RepoSnapshot[]>();
  readonly evidence = new Map<string, EvidenceItem[]>();
  readonly scores = new Map<string, ScoreSnapshot>();
  readonly credentials = new Map<string, Credential>();
  readonly jobs = new Map<string, AnalysisJob>();
  readonly listings: Listing[] = [];
  readonly invites: Invite[] = [];
  /** opaque sync cache (e.g. live GitHub ingestion) — phase-2 adapter seams */
  metadata = new Map<string, string>();

  constructor() {
    seed(this);
  }

  /** Restore pristine calibrated seed state (demo reset / CI teardown). */
  reset(): void {
    this.developers.clear();
    this.repos.clear();
    this.evidence.clear();
    this.scores.clear();
    this.credentials.clear();
    this.jobs.clear();
    this.listings.length = 0;
    this.invites.length = 0;
    this.metadata.clear();
    seed(this);
  }

  listDevelopers(): Developer[] {
    return [...this.developers.values()];
  }

  findDeveloper(handleOrId: string): Developer | undefined {
    return (
      this.developers.get(handleOrId) ??
      [...this.developers.values()].find(
        (d) => d.githubHandle === handleOrId || d.githubUsername === handleOrId
      )
    );
  }

  findDeveloperByWallet(wallet: string): Developer | undefined {
    if (!wallet) return undefined;
    return [...this.developers.values()].find((d) =>
      d.linkedWallets.some((w) => w.wallet === wallet || w.wallet.endsWith(wallet))
    );
  }

  /** Bind a Solana wallet to a developer (SIWS simulation). Idempotent per wallet. */
  bindWallet(
    developerId: string,
    wallet: string,
    opts: { domain?: string } = {}
  ): WalletBinding {
    if (!wallet) throw new Error('wallet_required');
    const dev = this.developers.get(developerId);
    if (!dev) throw new Error('developer_not_found');
    const existing = dev.linkedWallets.find((w) => w.wallet === wallet);
    if (existing) return existing;
    const binding: WalletBinding = {
      id: `wb-${short(wallet + dev.githubHandle, 10)}`,
      developerId,
      wallet,
      signedMessage: `SIWS:${dev.githubHandle}:${wallet.slice(0, 6)}:signed:${short(wallet, 8)}`,
      nonce: short(wallet + dev.githubHandle, 8),
      domain: opts.domain ?? 'proofmesh.xyz',
      gistUrl: null,
      boundAt: new Date().toISOString()
    };
    dev.linkedWallets = [...dev.linkedWallets, binding];
    dev.updatedAt = new Date().toISOString();
    return binding;
  }

  reposFor(developerId: string): RepoSnapshot[] {
    return this.repos.get(developerId) ?? [];
  }

  evidenceFor(developerId: string): EvidenceItem[] {
    return this.evidence.get(developerId) ?? [];
  }

  scoreFor(developerId: string, skillId: SkillId): ScoreSnapshot | undefined {
    return [...this.scores.values()].find(
      (s) => s.developerId === developerId && s.skillId === skillId
    );
  }

  credentialFor(developerId: string, skillId: SkillId): Credential | undefined {
    return [...this.credentials.values()].find(
      (c) => c.developerId === developerId && c.skillId === skillId && c.status === 'ISSUED'
    );
  }

  createJob(input: {
    developerId: string;
    githubUsername: string;
    skillId: SkillId;
    llmEnabled: boolean;
    mintWallet?: string | null;
  }): AnalysisJob {
    const now = new Date().toISOString();
    const job: AnalysisJob = {
      id: crypto.randomUUID(),
      developerId: input.developerId,
      githubUsername: input.githubUsername,
      skillId: input.skillId,
      status: 'queued',
      stages: PIPELINE.map((stage) => ({
        stage,
        status: 'pending',
        detail: '',
        startedAt: null,
        finishedAt: null
      })),
      error: null,
      scoreId: null,
      credentialId: null,
      createdAt: now,
      updatedAt: now,
      llmEnabled: input.llmEnabled,
      mintWallet: input.mintWallet ?? null
    };
    this.jobs.set(job.id, job);
    return job;
  }

  saveScore(score: ScoreSnapshot): void {
    this.scores.set(score.id, score);
  }

  saveCredential(credential: Credential): void {
    this.credentials.set(credential.id, credential);
  }

  search(query: SearchDevelopersQuery): CandidateDeveloper[] {
    const candidates: CandidateDeveloper[] = [];
    for (const dev of this.developers.values()) {
      const skills =
        query.skills && query.skills.length > 0 ? query.skills : (Object.keys(SKILLS) as SkillId[]);
      for (const skillId of skills) {
        const score = this.scoreFor(dev.id, skillId);
        const cred = this.credentialFor(dev.id, skillId);
        if (!score || !cred) continue;
        if (score.shownScore < (query.minScore ?? 0)) continue;
        if (score.confidence < (query.minConfidence ?? 0)) continue;
        if (cred.level < (query.minLevel ?? 1)) continue;
        const now = Date.now();
        if (
          query.activeWithinDays &&
          now - new Date(cred.issuedAt).getTime() > query.activeWithinDays * 86_400_000
        )
          continue;
        candidates.push({
          ...dev,
          score,
          skillId,
          level: cred.level
        });
      }
    }
    const limit = query.limit ?? 20;
    return candidates
      .sort((a, b) => (b.score as ScoreSnapshot).shownScore - (a.score as ScoreSnapshot).shownScore)
      .slice(0, limit);
  }
}

// ---------------------------------------------------------------------------
// Seed data — calibrated so thresholds produce real outcomes: strong devs
// mint a credential, thin devs honestly abstain, mid devs sit at the edge.
// ---------------------------------------------------------------------------

const ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

function sha256Hex(input: string): string {
  let h1 = 0x811c9dc5 ^ input.length;
  for (let i = 0; i < input.length; i++) h1 = Math.imul(h1 ^ input.charCodeAt(i), 16777619);
  h1 = Math.imul(h1 ^ (h1 >>> 13), 2654435761);
  return (h1 >>> 0).toString(16).padStart(8, '0');
}

function short(seed: string, n = 12): string {
  let h = sha256Hex(seed);
  let out = h.slice(0, n);
  while (out.length < n) {
    h = sha256Hex(h);
    out += h.slice(0, n - out.length);
  }
  return out;
}

export function deriveAttestationAddress(wallet: string, schema: string): string {
  const seed = `attestation:${schema}:${wallet}`;
  let h = parseInt(sha256Hex(seed), 16);
  let out = '';
  for (let i = 0; i < 44; i++) {
    out += ALPHA[h % ALPHA.length];
    h = Math.imul(h, 0x85ebca6b) + 0xc2b2ae35;
    h = (h % 0xffffffff) >>> 0;
  }
  return out;
}

function seed(store: Store): void {
  const now = Date.now();
  const iso = (daysAgo: number, hoursAgo = 0): string =>
    new Date(now - daysAgo * 86_400_000 - hoursAgo * 3_600_000).toISOString();

  const mkDeveloper = (
    id: string,
    githubHandle: string,
    wallet: string,
    boundDaysAgo: number,
    createdAtDaysAgo: number
  ): Developer => {
    const binding: WalletBinding = {
      id: `wb-${id}`,
      developerId: id,
      wallet,
      signedMessage: `SIWS:${githubHandle}:${wallet.slice(0, 6)}:signed:${short(wallet, 8)}`,
      nonce: short(wallet + githubHandle, 8),
      domain: 'proofmesh.xyz',
      gistUrl: null,
      boundAt: iso(boundDaysAgo)
    };
    return {
      id,
      githubId: `gh-${short(githubHandle, 10)}`,
      githubUsername: githubHandle,
      githubHandle,
      avatarUrl: null,
      linkedWallets: [binding],
      createdAt: iso(createdAtDaysAgo),
      updatedAt: iso(Math.min(boundDaysAgo, 10))
    };
  };

  // --------------------------------------------- DEV-1: strong → mints
  const d1 = mkDeveloper('dev-1', 'alexander-vance', '7xGqYtRZLJ4XZiQn69NCHsWkY1mTVMLqmLX4m3md8DwzF3', 90, 700);
  store.developers.set(d1.id, d1);
  store.repos.set(d1.id, coreRepos(d1.id, iso));
  store.evidence.set(d1.id, [
    ...merges(d1.id, iso),
    ev(d1.id, 'OWN_PRB_REVIEWED', 'PR #88 in anchor-audit-toolkit merged after independent review from 2 maintainers.', 'alexander-vance/anchor-audit-toolkit#88', 'anchor-audit-toolkit', iso(75), 1),
    ev(d1.id, 'OWN_PRB_REVIEWED', 'PR #96 in anchor-audit-toolkit — security hardening, single approving reviewer.', 'alexander-vance/anchor-audit-toolkit#96', 'anchor-audit-toolkit', iso(30), 1),
    ev(d1.id, 'OWN_PRB_REVIEWED', 'spl-token-sandbox PRs #4, #9, #12 merged with independent review.', 'alexander-vance/spl-token-sandbox', 'spl-token-sandbox', iso(28), 3),
    ev(d1.id, 'OWN_PRB_REVIEWED', 'solana-ghost-validator PRs #7, #11, #18 — reviewed by two external maintainers each.', 'alexander-vance/solana-ghost-validator', 'ghost-validator', iso(12), 3),
    ev(d1.id, 'OWN_PRB_REVIEWED', 'solana-contrib-graph PRs #2, #5, #6, #8 — small reviewed surface.', 'alexander-vance/solana-contrib-graph', 'contrib-graph', iso(9), 4),
    ev(d1.id, 'REPO_TESTS_GREEN_CI', 'anchor-audit-toolkit ships 61 test files on green CI.', 'alexander-vance/anchor-audit-toolkit', 'anchor-audit-toolkit', iso(70), 0),
    ev(d1.id, 'REPO_TESTS_GREEN_CI', 'spl-token-sandbox: 27 integration tests, CI green.', 'alexander-vance/spl-token-sandbox', 'spl-token-sandbox', iso(30), 0),
    ev(d1.id, 'REPO_TESTS_GREEN_CI', 'anchor-xtasks: 14 tests, CI green.', 'alexander-vance/anchor-xtasks', 'anchor-xtasks', iso(12), 0),
    ev(d1.id, 'REPO_TESTS_GREEN_CI', 'pda-derive-checker: 19 tests, CI green.', 'alexander-vance/pda-derive-checker', 'pda-derive-checker', iso(22), 0),
    ev(d1.id, 'REPO_TESTS_GREEN_CI', 'tx-sim-client: 23 tests, CI green.', 'alexander-vance/tx-sim-client', 'tx-sim-client', iso(18), 0),
    ev(d1.id, 'REPO_TESTS_GREEN_CI', 'demo-program-suite: 34 tests, CI green.', 'alexander-vance/demo-program-suite', 'demo-program-suite', iso(8), 0),
    ev(d1.id, 'REPO_TESTS_GREEN_CI', 'audit-checklist-ai: 16 tests, CI green.', 'alexander-vance/audit-checklist-ai', 'audit-checklist-ai', iso(9), 0),
    ev(d1.id, 'REPO_TESTS_GREEN_CI', 'solana-verify-action: 21 tests, CI green.', 'alexander-vance/solana-verify-action', 'verify-action', iso(6), 0),
    ev(d1.id, 'REPO_TESTS_GREEN_CI', 'contribution-lens: 15 tests, CI green.', 'alexander-vance/contribution-lens', 'contribution-lens', iso(4), 0),
    ev(d1.id, 'REPO_TESTS_GREEN_CI', 'program-account-dsl: 18 tests, CI green.', 'alexander-vance/program-account-dsl', 'program-account-dsl', iso(14), 0),
    ...months(d1.id, 12, iso(460)),
    ev(d1.id, 'SIGNED_COMMIT_RATIO', '312 GPG-signed commits across 4 major releases with zero detected CVE signatures.', 'github.com/alexander-vance', '', iso(20), 0.98),
    ev(d1.id, 'MAINTAINER_ATTESTATION', 'Consensus review approvals from 6 tier-1 maintainers across 3 distinct organizations.', 'github.com/solana-labs', '', iso(60), 4),
    ev(d1.id, 'NEGATIVE_TEST', '31 negative tests detected (wrong-signer, wrong-owner, overflow-rejection) — strongest Solana-specific signal.', 'alexander-vance/anchor-audit-toolkit', 'anchor-audit-toolkit', iso(30), 0.9),
    ev(d1.id, 'CODE_SURVIVAL', '93% of authored lines across 6 repos still live in main after 1 year.', 'alexander-vance/anchor-audit-toolkit', 'anchor-audit-toolkit', iso(50), 0.93),
    ev(d1.id, 'RELEASE', '12 production releases with semver discipline across v1.2.0 → v3.0.1.', 'alexander-vance/anchor-audit-toolkit', 'anchor-audit-toolkit', iso(200), 12),
    ev(d1.id, 'STATIC_FINDING', '0 open security findings; cargo audit clean; gitleaks clean.', 'alexander-vance/anchor-audit-toolkit', 'anchor-audit-toolkit', iso(5), 0)
  ]);

  // --------------------------------------------- DEV-2: thin → abstains
  const d2 = mkDeveloper('dev-2', 'sam-carter', 'A5k2m1BmVLLMdRUMhRui59sZbBcdXoDWnA4xUAVJaa8t', 12, 30);
  store.developers.set(d2.id, d2);
  store.repos.set(d2.id, [
    repo('dev-2', 'sam-carter', 'solana-hello-world', 'rust', false, 4, 3, 0, false, iso(8)),
    repo('dev-2', 'sam-carter', 'bootcamp-fork', 'rust', true, 1, 1, 0, false, iso(3))
  ]);
  store.evidence.set(d2.id, [
    ev(d2.id, 'ACTIVITY_MONTH', 'One month of intermittent activity.', '', '', iso(30), 1),
    ev(d2.id, 'STATIC_FINDING', 'Single tutorial clone: no tests, no CI, mostly template files.', 'sam-carter/solana-hello-world', 'hello-world', iso(8), 0, true)
  ]);

  // --------------------------------------------- DEV-3: mid → edge/abstain
  const d3 = mkDeveloper('dev-3', 'maria-chen', '9zqWgKQaU1T8XKBK9wY3RmN6vC4tJ2pE8sLhF5dA7uG', 45, 400);
  store.developers.set(d3.id, d3);
  store.repos.set(d3.id, [
    repo('dev-3', 'maria-chen', 'typescript-library-kit', 'typescript', false, 45, 30, 14, true, iso(30)),
    repo('dev-3', 'maria-chen', 'findervault', 'typescript', true, 9000, 6, 1, true, iso(10))
  ]);
  store.evidence.set(d3.id, [
    ev(d3.id, 'EXTERNAL_MERGE', 'Merged PR vercel/notion-client#1409 — typed client patch, one-line behavioral test.', 'vercel/notion-client#1409', 'notion-client', iso(120), 1),
    ev(d3.id, 'OWN_PRB_REVIEWED', 'typescript-library-kit PR #7 merged with single review.', 'maria-chen/typescript-library-kit#7', 'ts-kit', iso(20), 1),
    ev(d3.id, 'REPO_TESTS_GREEN_CI', 'typescript-library-kit: 14 test files, CI green.', 'maria-chen/typescript-library-kit', 'ts-kit', iso(25), 0),
    ...months(d3.id, 4, iso(200)),
    ev(d3.id, 'SIGNED_COMMIT_RATIO', 'Signed-commit ratio of 0.4.', '', '', iso(20), 0.4)
  ]);

  // --------------------------------------------- DEV-4: strong #2 (console)
  const d4 = mkDeveloper('dev-4', 'devraj-patel', '4LnQzVcT7oJ9gXWsE2hR1dF6yB5kM3aP8tY2uWqZk', 200, 600);
  store.developers.set(d4.id, d4);
  store.repos.set(d4.id, [
    repo('dev-4', 'project-serum', 'anchor', 'rust', false, 12800, 44, 30, true, iso(120)),
    repo('dev-4', 'devraj-patel', 'serum-dex-ui', 'typescript', false, 205, 31, 18, true, iso(60)),
    repo('dev-4', 'bonfida', 'bonfida', 'rust', false, 640, 29, 24, true, iso(80)),
    repo('dev-4', 'devraj-patel', 'nft-marketplace-anchor', 'rust', false, 89, 22, 27, true, iso(15)),
    repo('dev-4', 'devraj-patel', 'token-vault-program', 'rust', false, 41, 16, 19, true, iso(9)),
    repo('dev-4', 'devraj-patel', 'dao-voting-anchor', 'rust', false, 67, 21, 24, true, iso(6))
  ]);
  store.evidence.set(d4.id, [
    ev(d4.id, 'EXTERNAL_MERGE', 'Merged PR project-serum/anchor#1142 — checked-arithmetic refactor across state handlers.', 'project-serum/anchor#1142', 'anchor', iso(220), 1),
    ev(d4.id, 'EXTERNAL_MERGE', 'Merged PR bonfida/bonfida#906 — domain-name migration support, reviewed twice.', 'bonfida/bonfida#906', 'bonfida', iso(150), 1),
    ev(d4.id, 'EXTERNAL_MERGE', 'Merged PR solana-labs/solana-program-library#6891 — ATA helper for token-2022.', 'solana-labs/solana-program-library#6891', 'spl', iso(100), 1),
    ev(d4.id, 'EXTERNAL_MERGE', 'Merged PR solana-labs/solana-program-library#7022 — inflation-safe withdraw path.', 'solana-labs/solana-program-library#7022', 'spl-2', iso(80), 1),
    ev(d4.id, 'EXTERNAL_MERGE', 'Merged PR metaplex-foundation/metaplex-program-library#221 — authority rotation guard.', 'metaplex-foundation/mpl#221', 'mpl', iso(60), 1),
    ev(d4.id, 'EXTERNAL_MERGE', 'Merged PR drift-labs/drift#1444 — orderbook fee accounting fix.', 'drift-labs/drift#1444', 'drift', iso(45), 1),
    ev(d4.id, 'EXTERNAL_MERGE', 'Merged PR orca-so/whirlpool#98 — decimals handling on swap math.', 'orca-so/whirlpool#98', 'whirlpool', iso(30), 1),
    ev(d4.id, 'OWN_PRB_REVIEWED', 'nft-marketplace-anchor PRs #11, #14, #19 — each independently reviewed.', 'devraj-patel/nft-marketplace-anchor', 'nft-market', iso(20), 2),
    ev(d4.id, 'OWN_PRB_REVIEWED', 'token-vault-program PRs #3, #5 — reviewed by security reviewer.', 'devraj-patel/token-vault-program', 'vault', iso(9), 2),
    ev(d4.id, 'REPO_TESTS_GREEN_CI', 'nft-marketplace-anchor: 27 test files, CI green.', 'devraj-patel/nft-marketplace-anchor', 'nft-market', iso(12), 0),
    ev(d4.id, 'REPO_TESTS_GREEN_CI', 'serum-dex-ui: 18 test files, CI green.', 'devraj-patel/serum-dex-ui', 'serum-dex-ui', iso(30), 0),
    ev(d4.id, 'SIGNED_COMMIT_RATIO', 'Signed-commit ratio of 0.9 across 6 repos.', '', '', iso(30), 0.9),
    ...months(d4.id, 12, iso(450)),
    ev(d4.id, 'MAINTAINER_ATTESTATION', 'Attestations from 3 tier-1/maintainers across 2 organizations.', 'github.com/project-serum', '', iso(45), 2),
    ev(d4.id, 'NEGATIVE_TEST', 'Negative-test ratio 0.9 — deep reject-path coverage across programs.', 'devraj-patel/nft-marketplace-anchor', 'nft-market', iso(15), 0.9),
    ev(d4.id, 'CODE_SURVIVAL', 'Authored lines across 5 repos largely intact in main after 9 months.', 'devraj-patel/nft-marketplace-anchor', 'nft-market', iso(90), 1.0),
    ev(d4.id, 'RELEASE', '6 releases across 3 public projects.', '', '', iso(90), 6)
  ]);

  store.listings.push(
    {
      id: 'lst-1',
      sponsorId: 'spn-1',
      title: 'Anchor security-audit bounty',
      description: '2–4 week scope, security-sensitive token transfer, tests required.',
      requiredSkills: ['solana-anchor'],
      minScore: 75,
      minConfidence: 0.75,
      minLevel: 2,
      activeWithinDays: 30,
      inviteUrl: null,
      createdAt: iso(3)
    },
    {
      id: 'lst-2',
      sponsorId: 'spn-2',
      title: 'TypeScript tooling grant',
      description: 'Open contribution program for developer tooling.',
      requiredSkills: ['typescript'],
      minScore: 60,
      minConfidence: 0.6,
      minLevel: 1,
      activeWithinDays: 90,
      inviteUrl: null,
      createdAt: iso(1)
    }
  );
}

export function repo(
  developerId: string,
  owner: string,
  name: string,
  primaryLanguage: string,
  isFork: boolean,
  stars: number,
  commitCount: number,
  prCount: number,
  ciGreen: boolean,
  snapshotAt: string
): RepoSnapshot {
  return {
    id: `repo-${developerId}-${owner}-${name}`,
    developerId,
    owner,
    name,
    fullName: `${owner}/${name}`,
    defaultBranch: 'main',
    primaryLanguage,
    snapshotCommitSha: null,
    isFork,
    starsAtSnapshot: stars,
    snapshotAt,
    commitCount,
    prCount,
    testFileCount: ciGreen ? Math.max(12, Math.round(prCount * 0.75)) : prCount > 0 ? Math.round(prCount * 0.4) : 0,
    ciGreen
  };
}

export function ev(
  developerId: string,
  type: EvidenceType,
  description: string,
  sourceUrl: string,
  sourceIdentifier: string | null,
  capturedAt: string,
  value: number,
  positive = true
): EvidenceItem {
  return {
    id: `ev-${developerId}-${type}-${short(sourceUrl + description, 10)}`,
    analysisRunId: 'seed',
    type,
    description,
    sourceUrl: sourceUrl.startsWith('http') ? sourceUrl : sourceUrl ? `https://github.com/${sourceUrl}` : null,
    sourceIdentifier: sourceIdentifier || null,
    metricName:
      type === 'ACTIVITY_MONTH'
        ? 'activity_months'
        : type === 'NEGATIVE_TEST'
          ? 'negative_test_ratio'
          : type === 'SIGNED_COMMIT_RATIO'
            ? 'signed_commit_ratio'
            : null,
    value,
    positive,
    sourceVersion: 'pow.solana-anchor.v1',
    capturedAt
  };
}

function months(developerId: string, count: number, start: string): EvidenceItem[] {
  const out: EvidenceItem[] = [];
  for (let i = 0; i < count; i++) {
    out.push(
      ev(developerId, 'ACTIVITY_MONTH', `Sustained activity — month ${i + 1} of regular, gap-tolerant contribution.`, '', '', start, 1)
    );
  }
  return out;
}

/** The showcase dev merges into many distinct upstream repositories. */
const ECOSYSTEM_REPOS: Array<[string, string]> = [
  ['solana-labs', 'solana-program-library'],
  ['metaplex-foundation', 'metaplex-program-library'],
  ['drift-labs', 'drift'],
  ['orca-so', 'whirlpool'],
  ['raydium-io', 'raydium'],
  ['mango-protocol', 'mango-v3'],
  ['switchboard-xyz', 'switchboard-v2'],
  ['bonfida', 'bonfida'],
  ['project-serum', 'serum-dex'],
  ['saber-hq', 'stable-swap'],
  ['everlastingsong', 'protocol'],
  ['sunny-aggregator', 'core'],
  ['solana-developers', 'rust-sdk'],
  ['jito-foundation', 'solana-mev'],
  ['openbook-dex', 'program'],
  ['wormhole-foundation', 'wormhole'],
  ['reactjs', 'react'],
  ['vercel', 'next.js'],
  ['facebook', 'relay'],
  ['vitest-dev', 'vitest'],
  ['eslint', 'eslint'],
  ['microsoft', 'TypeScript'],
  ['tannerlinsley', 'base'],
  ['anuraghazra', 'github-readme-stats'],
  ['reduxjs', 'redux-toolkit'],
  ['puppeteer', 'puppeteer'],
  ['npm', 'cli'],
  ['homebrew', 'homebrew-core']
];

/**
 * A dozen+ active repositories the developer personally maintains; each is a
 * non-fork, test-covered, CI-green codebase so the testing/consistency signals
 * have real structure to read.
 */
const CORE_REPOS: Array<[string, string, string, number, number, number]> = [
  // owner, name, language, stars, commitCount, snapshotDaysAgo
  ['alexander-vance', 'anchor-audit-toolkit', 'rust', 311, 84, 90],
  ['alexander-vance', 'solana-contrib-graph', 'rust', 42, 19, 40],
  ['alexander-vance', 'spl-token-sandbox', 'rust', 128, 33, 30],
  ['alexander-vance', 'pda-derive-checker', 'rust', 76, 22, 25],
  ['alexander-vance', 'tx-sim-client', 'rust', 88, 41, 20],
  ['alexander-vance', 'anchor-xtasks', 'rust', 15, 9, 12],
  ['alexander-vance', 'program-account-dsl', 'rust', 64, 27, 18],
  ['alexander-vance', 'solana-ghost-validator', 'rust', 190, 58, 15],
  ['alexander-vance', 'audit-checklist-ai', 'rust', 23, 14, 10],
  ['alexander-vance', 'demo-program-suite', 'rust', 51, 31, 9],
  ['alexander-vance', 'solana-verify-action', 'typescript', 98, 26, 7],
  ['alexander-vance', 'contribution-lens', 'typescript', 34, 18, 5],
  ['alexander-vance', 'verifiable-docs', 'typescript', 12, 8, 3]
];

function coreRepos(developerId: string, iso: (d: number) => string): RepoSnapshot[] {
  return CORE_REPOS.map(([owner, name, lang, stars, commitCount, days]) =>
    repo(developerId, owner, name, lang, false, stars, commitCount, commitCount, true, iso(days))
  );
}

function merges(developerId: string, iso: (d: number) => string): EvidenceItem[] {
  const PRS = [482, 2104, 1987, 3061, 442, 771, 1288, 2041, 1560, 92, 3402, 958, 1176, 2220, 3067, 773, 5552, 8901, 1130, 45, 611, 9402, 1190, 2051, 3080, 788, 12444, 9981];
  return ECOSYSTEM_REPOS.map(([owner, name], i) => {
    const days = 460 - i * 14;
    const pr = PRS[i % PRS.length] ?? 100 + i;
    return ev(
      developerId,
      'EXTERNAL_MERGE',
      `Merged PR ${owner}/${name}#${pr} — ${i % 3 === 0 ? 'cross-cutting refactor with maintainer review' : i % 3 === 1 ? 'security-hardening change kept in mainline' : 'typed migration accepted upstream'}.`,
      `${owner}/${name}#${pr}`,
      `${owner}/${name}`,
      iso(days),
      1
    );
  });
}