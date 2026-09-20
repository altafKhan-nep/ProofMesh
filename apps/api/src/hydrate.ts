/**
 * Boot hydration — runs the real pipeline for seeded developers at startup
 * (and after `/api/reset`) so the public verify page, badges and sponsor
 * console are live immediately, using the exact same path a fresh analysis
 * takes, just with zero stage delays.
 */

import type { SseEvent } from '@proofmesh/shared-types';
import type { Store } from './store.js';
import { runAnalysis } from './pipeline.js';

export const SEEDED_RUNS = [
  ['alexander-vance', 'solana-anchor'],
  ['maria-chen', 'typescript'],
  ['devraj-patel', 'solana-anchor']
] as const;

export async function hydrateSeededRuns(store: Store): Promise<void> {
  const noop = (_e: SseEvent) => undefined;
  for (const [handle, skill] of SEEDED_RUNS) {
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
  }
}