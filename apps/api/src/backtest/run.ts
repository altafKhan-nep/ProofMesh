/**
 * Validation back-test runner (ARCHITECTURE.md §13, BUILD_PROMPT §12).
 *
 * For each labeled real GitHub account:
 *   1. ingest live public GitHub data (disk-cached in ./cache so re-runs and
 *      tuning iterations are free and reproducible),
 *   2. predict the credential outcome through the SAME production path the API
 *      uses (pipeline.predictCredential — never a local re-sim),
 *   3. compare against the ground-truth label and roll up confusion metrics.
 *
 * `--tune` additionally sweeps E0 over the SAME evidence (re-deriving each
 * account's evidence units) and prints the configuration that best separates
 * positives from negatives under the shownScore>=60 / confidence>=0.6 gate,
 * so the calibration constant is tuned data-first rather than assumed.
 *
 * Budget: unauthenticated GitHub is 60 requests/hr. Fast mode costs 2 requests
 * per account (repos + events). A GITHUB_TOKEN (5k/hr) lifts the cap; accounts
 * are always cached to disk, so partial runs resume cleanly.
 *
 *   GITHUB_TOKEN=xxx pnpm backtest
 *   BACKTEST_BUDGET=120 pnpm backtest        # raise the request ceiling
 *   pnpm backtest --tune                      # sweep E0 + print best-accuracy config
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LABELS } from './labels.js';
import type { BacktestLabel } from './labels.js';
import { ingestGitHub } from '../github.js';
import type { IngestedDeveloper } from '../github.js';
import { predictCredential, languageCoverageOf } from '../pipeline.js';
import { Store } from '../store.js';
import type { EvidenceItem, SkillId } from '@proofmesh/shared-types';
import { normalizeSignals, round } from '@proofmesh/scoring-engine';
import type { DimensionSignals } from '@proofmesh/scoring-engine';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.join(HERE, 'cache');
const OUT_PATH = path.resolve(HERE, '../../../..', 'docs/backtest-round-1.json');

const BUDGET = Number(process.env.BACKTEST_BUDGET ?? 58);
const TUNE = process.argv.includes('--tune');

/** Precise request accounting so we never blow the unauthenticated budget. */
let used = 0;
const realFetch = globalThis.fetch;
if (!process.env.BACKTEST_NO_COUNT) {
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url =
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input);
    if (url.startsWith('https://api.github.com/')) {
      if (used >= BUDGET) throw new Error('BACKTEST_BUDGET_EXHAUSTED');
      used += 1;
    }
    return realFetch(input as RequestInfo, init);
  };
}

const CURRENT_E0 = 30; // shared-types CALIBRATION.E0

interface RunRow {
  handle: string;
  skill: SkillId;
  label: boolean;
  labelConfidence: BacktestLabel['confidence'];
  rationale: string;
  predicted: boolean;
  match: boolean;
  shownScore: number;
  rawScore: number;
  confidence: number;
  evidenceUnits: number;
  level: number;
  blocked: boolean;
  languageCoverage: number;
  externalMerges: number;
  activityMonths: number;
  repos: number;
  normalizedSignals: Record<string, number> | null;
  skepticNotes: string[];
  eligibilityReasons: string[];
  covered: boolean;
  error?: string;
}

function evidenceStats(evidence: EvidenceItem[]): { merges: number; activity: number } {
  const merges = evidence.filter((e) => e.type === 'EXTERNAL_MERGE' && e.positive).length;
  const activity = evidence
    .filter((e) => e.type === 'ACTIVITY_MONTH' && e.positive)
    .reduce((a, e) => a + (e.value ?? 1), 0);
  return { merges, activity };
}

function summarize(rows: RunRow[]): Record<string, unknown> {
  const covered = rows.filter((r) => r.covered);
  const tp = covered.filter((r) => r.label && r.predicted).length;
  const fp = covered.filter((r) => !r.label && r.predicted).length;
  const tn = covered.filter((r) => !r.label && !r.predicted).length;
  const fn = covered.filter((r) => r.label && !r.predicted).length;
  const total = tp + fp + tn + fn;
  const precision = total ? round(tp / (tp + fp || 1), 4) : 0;
  const recall = total ? round(tp / (tp + fn || 1), 4) : 0;
  const accuracy = total ? round((tp + tn) / total, 4) : 0;
  const f1 = precision + recall ? round((2 * precision * recall) / (precision + recall), 4) : 0;
  return {
    covered: covered.length,
    total: rows.length,
    confusion: { tp, fp, tn, fn },
    precision,
    recall,
    accuracy,
    f1,
    note: 'positive = credential SHOULD be issued. Imbalanced classes by design (curated maintainers + abstain cases).'
  };
}

function highConfidenceRows(rows: RunRow[]): RunRow[] {
  return rows.filter((r) => r.covered && r.labelConfidence === 'high');
}

function tune(rows: RunRow[]): Record<string, unknown> {
  // Re-derive evidence units E per account from the CURRENT confidence:
  //   confidence = 1 − exp(−E/currentE0)  →  E = −currentE0 · ln(1 − confidence)
  // Then sweep E0 against the SAME E while holding the shownScore>=60 gate.
  const use = highConfidenceRows(rows);
  if (use.length === 0) return { skipped: 'no high-confidence covered rows to tune against' };
  const evid = use.map((r) => {
    const c = Math.min(0.999999, r.confidence);
    return { row: r, E: -CURRENT_E0 * Math.log(1 - c) };
  });

  let best: { e0: number; acc: number; tp: number; fp: number; tn: number; fn: number } | null = null;
  const sweep: Array<{ e0: number; acc: number; tp: number; fp: number; tn: number; fn: number }> = [];
  for (let e0 = 2; e0 <= 80; e0 += 2) {
    let tp = 0;
    let fp = 0;
    let tn = 0;
    let fn = 0;
    for (const { row, E } of evid) {
      const conf = 1 - Math.exp(-E / e0);
      const pred = conf >= 0.6 && row.shownScore >= 60 && !row.blocked;
      if (pred === row.label) (pred ? (tp += 1) : (tn += 1));
      else if (pred) fp += 1;
      else fn += 1;
    }
    const acc = (tp + tn) / (tp + fp + tn + fn || 1);
    sweep.push({ e0, acc: round(acc, 4), tp, fp, tn, fn });
    if (!best || acc > best.acc) best = { e0, acc: round(acc, 4), tp, fp, tn, fn };
  }
  return {
    method: 'sweep E0 over the SAME per-account evidence units, holding shownScore>=60 and confidence>=0.6; other constants fixed',
    basis: 'high-confidence labels only',
    best,
    current: { e0: CURRENT_E0 },
    curve: sweep
  };
}

const DIMS: Array<keyof DimensionSignals> = ['quality', 'security', 'architecture', 'testing', 'consistency', 'traction'];

function percentileOf(values: number[], pct: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (pct / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return round(sorted[lo]!);
  return round(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo));
}

/**
 * Propose a reference corpus (ARCHITECTURE.md §6) derived from the REAL
 * normalized dimension signals of label-positive developers, so the
 * "rank vs reference corpus of comparable repos" default is no longer a
 * hand-set constant that floors every live developer.
 */
function proposeCorpus(rows: RunRow[]): Record<string, unknown> {
  const positives = rows.filter((r) => r.covered && r.label && r.normalizedSignals);
  if (positives.length === 0) return { skipped: 'no covered label-positive rows with signals' };
  const perDim: Record<keyof DimensionSignals, number[]> = {
    quality: [],
    security: [],
    architecture: [],
    testing: [],
    consistency: [],
    traction: []
  };
  for (const r of positives) {
    for (const d of DIMS) perDim[d]!.push(r.normalizedSignals![d] ?? 0);
  }
  const bins = [20, 40, 60, 80, 90, 95];
  const corpus: Record<string, number[]> = {};
  for (const d of DIMS) corpus[d] = bins.map((b) => percentileOf(perDim[d]!, b));
  return {
    method: `percentiles ($bins) of label-positive normalized signals, n=${positives.length}`,
    currentDefault: {
      quality: [58, 62, 66, 70, 74, 78, 82, 86, 90, 94],
      security: [55, 60, 65, 70, 75, 80, 85, 90, 94, 97],
      architecture: [50, 58, 64, 70, 76, 82, 87, 91, 95, 98],
      testing: [40, 50, 60, 68, 75, 82, 88, 92, 96, 99],
      consistency: [45, 55, 63, 70, 76, 82, 87, 91, 95, 98],
      traction: [13, 22, 30, 36, 43, 50, 58, 67, 77, 87]
    },
    proposed: corpus
  };
}

async function scoreHandle(label: BacktestLabel, store: Store): Promise<RunRow> {
  const cacheFile = path.join(CACHE_DIR, `${label.handle.toLowerCase()}.json`);
  let ingested: IngestedDeveloper;
  if (fs.existsSync(cacheFile)) {
    ingested = JSON.parse(fs.readFileSync(cacheFile, 'utf8')) as IngestedDeveloper;
  } else {
    try {
      ingested = await ingestGitHub(store, label.handle, { maxDetailRepos: 0, skipProfile: true });
      fs.mkdirSync(CACHE_DIR, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify(ingested));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const base = {
        label: label.positive,
        labelConfidence: label.confidence,
        rationale: label.rationale,
        predicted: false,
        match: false,
        shownScore: 0,
        rawScore: 0,
        confidence: 0,
        evidenceUnits: 0,
        level: 0,
        blocked: false,
        languageCoverage: 0,
        externalMerges: 0,
        activityMonths: 0,
        repos: 0,
        normalizedSignals: null,
        skepticNotes: [],
        eligibilityReasons: [],
        error: message.slice(0, 80)
      };
      return { handle: label.handle, skill: label.skill, ...base, covered: !message.includes('BACKTEST_BUDGET_EXHAUSTED') && !/rate.limit|403|429/i.test(message) };
    }
  }
  const prediction = predictCredential(label.skill, ingested.repos, ingested.evidence);
  const stats = evidenceStats(ingested.evidence);
  const nonForks = ingested.repos.filter((r) => !r.isFork).length;
  return {
    handle: label.handle,
    skill: label.skill,
    label: label.positive,
    labelConfidence: label.confidence,
    rationale: label.rationale,
    predicted: prediction.issued,
    match: prediction.issued === label.positive,
    shownScore: prediction.score.shownScore,
    rawScore: prediction.score.rawScore,
    confidence: prediction.finalConfidence,
    evidenceUnits: prediction.score.evidenceUnits,
    level: prediction.level,
    blocked: prediction.blocked,
    languageCoverage: languageCoverageOf(ingested.repos, label.skill),
    externalMerges: stats.merges,
    activityMonths: stats.activity,
    repos: nonForks,
    normalizedSignals: normalizeSignals(prediction.signals as DimensionSignals) as Record<string, number>,
    skepticNotes: prediction.skepticNotes,
    eligibilityReasons: prediction.reasons,
    covered: true
  };
}

function discrepancies(rows: RunRow[]): string[] {
  return rows
    .filter((r) => r.covered && r.label !== r.predicted)
    .map(
      (r) =>
        `${r.handle} (${r.skill}): ${r.label ? 'POS→abstain' : 'ABSTAIN→POS'} — score=${r.shownScore} conf=${(r.confidence * 100).toFixed(1)}% cov=${(r.languageCoverage * 100).toFixed(0)}% E=${r.evidenceUnits}${r.blocked ? ' [BLOCKED by skeptic]' : ''}`
    );
}

async function main(): Promise<void> {
  const store = new Store();
  const rows: RunRow[] = [];
  for (const label of LABELS) {
    rows.push(await scoreHandle(label, store));
    if (!rows[rows.length - 1]!.covered) break; // budget exhausted — stop cleanly
  }
  const output = {
    round: 1,
    generatedAt: new Date().toISOString(),
    method: 'live GitHub ingestion (fast mode: /users/:u/repos + /users/:u/events/public, detail/deep repos deferred to a tokenized run). Prediction via pipeline.predictCredential — the exact production path, no re-simulation.',
    budget: { limit: 'unauthenticated 60/hr', configured: BUDGET, used },
    labels: {
      total: LABELS.length,
      positives: LABELS.filter((l) => l.positive).length,
      negatives: LABELS.filter((l) => !l.positive).length
    },
    summary: summarize(rows),
    tuning: TUNE ? tune(rows) : undefined,
    corpusProposal: TUNE ? proposeCorpus(rows) : undefined,
    discrepancies: discrepancies(rows).filter((d) => rows.filter((r) => r.covered).length > 0),
    rows
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2));
  console.log(JSON.stringify(output, null, 2));
}

try {
  await main();
} catch (err) {
  console.error(`FAILED: ${(err as Error).message}`);
  process.exitCode = 1;
}