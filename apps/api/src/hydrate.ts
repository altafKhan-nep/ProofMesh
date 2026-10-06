/**
 * Boot hydration — ingests a REAL GitHub account from the public GitHub API,
 * then runs the real pipeline for it (and after `/api/reset`) so the public
 * verify page, badges and sponsor console are live immediately, using the
 * exact same path a fresh analysis takes, just with zero stage delays.
 *
 * The hydrated developer is a real account (never a fabricated fixture), and
 * analysis is live ingestion + scoring, so every "seeded" number on first
 * boot is real. If the unauthenticated GitHub API rate limit is hit, hydration
 * is retried once the limit resets (or sooner if a GITHUB_TOKEN is provided).
 */

import type { SseEvent } from '@proofmesh/shared-types';
import type { Store } from './store.js';
import { runAnalysis } from './pipeline.js';
import { GitHubRateLimitedError, ingestGitHub } from './github.js';

export const SEEDED_RUNS = [
  ['altafKhan-nep', 'solana-anchor'],
  ['altafKhan-nep', 'typescript']
] as const;

async function ensureRealDeveloper(store: Store, handle: string): Promise<boolean> {
  if (store.findDeveloper(handle)) return true;
  const ingested = await ingestGitHub(store, handle, { maxDetailRepos: 4 });
  if (store.developers.has(ingested.developer.id)) return true;
  store.developers.set(ingested.developer.id, ingested.developer);
  store.repos.set(ingested.developer.id, ingested.repos);
  store.evidence.set(ingested.developer.id, ingested.evidence);
  return !!store.findDeveloper(handle);
}

const RESET_RE = /\bresets\s+\d{4}-\d{2}-\d{2}T[\d:.]+Z/;

function resetDelayMs(err: Error): number {
  const m = RESET_RE.exec(err.message);
  const ts = m ? Date.parse(m[0].replace('resets ', '')) : NaN;
  const delay = Number.isNaN(ts) ? 60 * 60_000 : ts - Date.now() + 5_000;
  return Math.max(5_000, delay);
}

let retryScheduled = false;

function scheduleRetry(store: Store, err: Error): void {
  if (retryScheduled) return;
  retryScheduled = true;
  const delay = resetDelayMs(err);
  setTimeout(() => {
    retryScheduled = false;
    void hydrateSeededRuns(store);
  }, delay).unref();
}

export async function hydrateSeededRuns(store: Store): Promise<void> {
  const noop = (_e: SseEvent) => undefined;
  for (const [handle, skill] of SEEDED_RUNS) {
    try {
      if (!(await ensureRealDeveloper(store, handle))) continue;
      const dev = store.findDeveloper(handle);
      if (!dev) continue;
      if (store.scoreFor(dev.id, skill)) continue;
      const job = store.createJob({
        developerId: dev.id,
        githubUsername: dev.githubHandle,
        skillId: skill,
        llmEnabled: false
      });
      await runAnalysis(store, job, noop, { stageMs: 0 });
    } catch (err) {
      // Boot hydration must never take the API down (offline boot / rate limits).
      if (err instanceof GitHubRateLimitedError) scheduleRetry(store, err);
    }
  }
}