/**
 * Seed script — prints the current deterministic store for inspection.
 * `pnpm seed` from repo root.
 */

import { Store } from './store.js';
import { runAnalysis } from './pipeline.js';
import type { SseEvent } from '@proofmesh/shared-types';

const noop = (_e: SseEvent) => undefined;

async function main(): Promise<void> {
  const store = new Store();

  for (const [handle, skill] of [
    ['alexander-vance', 'solana-anchor'],
    ['maria-chen', 'typescript'],
    ['devraj-patel', 'solana-anchor']
  ] as const) {
    const dev = store.findDeveloper(handle);
    if (!dev) continue;
    const job = store.createJob({
      developerId: dev.id,
      githubUsername: dev.githubHandle,
      skillId: skill,
      llmEnabled: false
    });
    const res = await runAnalysis(store, job, noop, { stageMs: 0 });
    const score = store.scoreFor(dev.id, skill)!;
    console.log(
      `[seeded] @${dev.githubHandle}  ${skill.padEnd(14)} shown=${score.shownScore} conf=${(
        score.confidence * 100
      ).toFixed(1)}%  eligible=${res.passedEligibility}  credential=${res.credentialId ?? '— (abstain)'}`
    );
  }
}

void main();