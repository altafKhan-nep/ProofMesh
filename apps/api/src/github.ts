/**
 * Real GitHub ingestion — the phase-2 "live" path (ARCHITECTURE.md §5.1).
 *
 * Pulls public GitHub data over the REST API (unauthenticated, rate-limited)
 * and synthesizes RepoSnapshot[] + EvidenceItem[] strictly from signals the
 * public API can actually attest. Anything the API cannot verify honestly stays
 * absent (0) rather than invented: test/CI forensics, signed commits, and
 * merge identity beyond the public event feed are deliberately not fabricated.
 *
 * Rate budget per sync: 1 (profile) + 1 (repos) + 1 (events) + 2×N detail
 * repos (commits page + releases). Default N=6 → ~15 calls of the 60/hr core
 * limit, leaving headroom for repeated demo restarts.
 */

import type {
  Developer,
  EvidenceItem,
  EvidenceType,
  RepoSnapshot
} from '@proofmesh/shared-types';
import type { Store } from './store.js';

const GITHUB_API = 'https://api.github.com';
const USER_AGENT = 'proofmesh-verifier (deterministic ingestion)';
const GH_HEADERS: Record<string, string> = {
  accept: 'application/vnd.github+json',
  'user-agent': USER_AGENT,
  'x-github-api-version': '2022-11-28'
};
if (process.env.GITHUB_TOKEN) GH_HEADERS.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

export class GitHubRateLimitedError extends Error {
  constructor(resetAt: string) {
    super(`GitHub API rate limit reached; resets ${new Date(resetAt).toISOString()}`);
    this.name = 'GitHubRateLimitedError';
  }
}

interface GhUser {
  login: string;
  avatar_url: string | null;
  created_at: string;
}

interface GhRepo {
  name: string;
  full_name: string;
  owner: { login: string };
  fork: boolean;
  language: string | null;
  stargazers_count: number;
  default_branch: string;
  pushed_at: string;
}

interface GhRelease {
  draft: boolean;
  prerelease: boolean;
}

interface GhEvent {
  type: string;
  created_at: string;
  repo?: { name: string };
  payload?: {
    action?: string;
    pull_request?: { merged?: boolean; merged_at?: string | null; number?: number };
  };
}

export interface IngestedDeveloper {
  developer: Developer;
  repos: RepoSnapshot[];
  evidence: EvidenceItem[];
  sources: string[];
}

const LANG_CANON: Record<string, string | null> = {
  rust: 'rust',
  typescript: 'typescript',
  ts: 'typescript',
  javascript: 'javascript',
  java: 'java',
  go: 'go',
  python: 'python',
  c: 'c',
  'c++': 'c++',
  'c#': 'c#',
  swift: 'swift',
  kotlin: 'kotlin',
  php: 'php',
  ruby: 'ruby',
  vue: 'vue',
  solidity: 'solana-anchor' // legacy passthrough guard; solana-anchor is a skill, not a GH language
};

function canonLanguage(lang: string | null): string | null {
  if (!lang) return null;
  return LANG_CANON[lang.toLowerCase()] ?? lang.toLowerCase();
}

async function ghFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, { headers: GH_HEADERS });
  const remaining = res.headers.get('x-ratelimit-remaining');
  if (res.status === 403 || res.status === 429 || remaining === '0') {
    throw new GitHubRateLimitedError(res.headers.get('x-ratelimit-reset') ?? '');
  }
  if (res.status === 404) throw new Error('github_user_not_found');
  if (!res.ok) throw new Error(`github_error_${res.status}`);
  return (await res.json()) as T;
}

function commitCountFromLink(link: string | null): number {
  if (!link) return 0;
  const last = /<([^>]+)>;\s*rel="last"/.exec(link);
  if (!last) return 0;
  const m = /[?&]page=(\d+)/.exec(last[1]);
  return m ? Number(m[1]) : 0;
}

async function ghFetchPageCount(path: string): Promise<number> {
  const res = await fetch(`${GITHUB_API}${path}`, { headers: GH_HEADERS });
  if (!res.ok) return 0;
  const link = res.headers.get('link');
  return commitCountFromLink(link) || (await res.json()).length || 0;
}

function monthKey(t: string): string {
  return t.slice(0, 7);
}

/**
 * Ingest a live GitHub user (cached in the store). Bounded API budget; never
 * fabricates unverifiable signals.
 */
export async function ingestGitHub(
  store: Store,
  username: string,
  opts: { maxDetailRepos?: number } = {}
): Promise<IngestedDeveloper> {
  const key = `github-sync:${username.toLowerCase()}`;
  const cached = (store.metadata ?? new Map()).get(key);
  if (cached) return JSON.parse(cached) as IngestedDeveloper;

  const maxDetail = opts.maxDetailRepos ?? 6;

  const profile = await ghFetch<GhUser>(`/users/${encodeURIComponent(username)}`);
  const ghRepos = await ghFetch<GhRepo[]>(
    `/users/${encodeURIComponent(username)}/repos?per_page=100&sort=pushed`
  );

  const owned = ghRepos.filter((r) => r.owner.login.toLowerCase() === username.toLowerCase());
  const ownNames = new Set(owned.map((r) => r.full_name.toLowerCase()));
  const detail = [...owned]
    .sort((a, b) => new Date(b.pushed_at).getTime() - new Date(a.pushed_at).getTime())
    .slice(0, maxDetail);

  const commitCounts = new Map<string, number>();
  const releaseCounts = new Map<string, number>();
  await Promise.all(
    detail.map(async (r) => {
      commitCounts.set(
        r.full_name,
        await ghFetchPageCount(`/repos/${r.full_name}/commits?per_page=1`)
      );
      try {
        const rels = await ghFetch<GhRelease[]>(`/repos/${r.full_name}/releases?per_page=100`);
        releaseCounts.set(
          r.full_name,
          rels.filter((x) => !x.draft && !x.prerelease).length
        );
      } catch {
        releaseCounts.set(r.full_name, 0);
      }
    })
  );

  const repos: RepoSnapshot[] = owned.map((r) => ({
    id: `repo-live-${r.full_name}`,
    developerId: `live-${username}`,
    owner: r.owner.login,
    name: r.name,
    fullName: r.full_name,
    defaultBranch: r.default_branch,
    primaryLanguage: canonLanguage(r.language),
    snapshotCommitSha: null,
    isFork: r.fork,
    starsAtSnapshot: r.stargazers_count,
    snapshotAt: new Date(r.pushed_at).toISOString(),
    commitCount: commitCounts.get(r.full_name) ?? 0,
    prCount: 0,
    testFileCount: 0,
    ciGreen: false
  }));

  // Public event feed (up to 100 recent events) → activity months + real merges.
  let events: GhEvent[] = [];
  try {
    events = await ghFetch<GhEvent[]>(
      `/users/${encodeURIComponent(username)}/events/public?per_page=100`
    );
  } catch {
    events = [];
  }

  const months = new Set<string>();
  for (const e of events) months.add(monthKey(e.created_at));
  const activityMonths = Math.min(12, months.size);

  const evidence: EvidenceItem[] = [];
  for (let i = 0; i < activityMonths; i++) {
    evidence.push(
      liveEv(username, 'ACTIVITY_MONTH', `Sustained public activity — month ${i + 1} (GitHub event feed).`, '', null, 1)
    );
  }

  const seenMerges = new Set<string>();
  for (const e of events) {
    if (
      e.type !== 'PullRequestEvent' ||
      e.payload?.action !== 'closed' ||
      !e.payload?.pull_request?.merged
    )
      continue;
    const repo = e.repo?.name ?? '';
    const pr = e.payload?.pull_request?.number ?? 0;
    if (!repo || pr === 0) continue;
    const id = `${repo}#${pr}`;
    if (ownNames.has(repo.toLowerCase())) continue; // own-repo PRs are not external
    if (seenMerges.has(id)) continue;
    seenMerges.add(id);
    evidence.push(
      liveEv(username, 'EXTERNAL_MERGE', `Merged PR into ${repo}#${pr} — repo not owned by this account.`, repo, repo, 1)
    );
  }

  for (const [full, n] of releaseCounts) {
    if (n > 0)
      evidence.push(liveEv(username, 'RELEASE', `${n} stable release${n === 1 ? '' : 's'} of ${full}.`, full, full, n));
  }

  const dev: Developer = {
    id: `live-${username}`,
    githubId: `gh-live-${username}`,
    githubUsername: username,
    githubHandle: username,
    avatarUrl: profile.avatar_url,
    linkedWallets: [],
    createdAt: new Date(profile.created_at).toISOString(),
    updatedAt: new Date().toISOString()
  };

  const result: IngestedDeveloper = { developer: dev, repos, evidence, sources: [] };
  const meta = store.metadata ?? new Map<string, string>();
  meta.set(key, JSON.stringify(result));
  store.metadata = meta;
  return result;
}

function nowIso(): string {
  return new Date().toISOString();
}

function liveEv(
  developerId: string,
  type: EvidenceType,
  description: string,
  sourceUrl: string,
  sourceIdentifier: string | null,
  value: number
): EvidenceItem {
  return {
    id: `ev-live-${developerId}-${type}-${String(sourceIdentifier).replace(/[^a-z0-9]/gi, '').slice(0, 10)}`,
    analysisRunId: 'live',
    type,
    description,
    sourceUrl: sourceUrl ? `https://github.com/${sourceUrl}` : null,
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
    positive: true,
    sourceVersion: 'live.github.v1',
    capturedAt: nowIso()
  };
}