import IORedis from 'ioredis';
import { Queue, Worker, UnrecoverableError, type Job } from 'bullmq';
import type { Store } from './store.js';
import { runAnalysis } from './pipeline.js';
import { emitFact } from './fact-bus.js';
import type { AnalysisJob, SseEvent } from '@proofmesh/shared-types';

const REDIS_URL = process.env.REDIS_URL;

/** How long to wait for Redis before giving up and degrading to in-process. */
const READY_TIMEOUT_MS = Number(process.env.REDIS_READY_TIMEOUT_MS ?? 5_000);
/** Analysis retry policy — a transient GitHub/RPC error must not lose the job. */
const ATTEMPTS = Number(process.env.ANALYSIS_ATTEMPTS ?? 3);

let connection: IORedis | undefined;
let queue: Queue | undefined;
let worker: Worker | undefined;
let degradedReason: string | undefined;

/** Human-readable description of how jobs are actually being run. */
export function queueMode(): { mode: 'bullmq' | 'in-process'; reason?: string } {
  return queue ? { mode: 'bullmq' } : { mode: 'in-process', reason: degradedReason ?? 'REDIS_URL not set' };
}

function failJob(job: AnalysisJob, err: unknown): void {
  job.status = 'failed';
  job.error = err instanceof Error ? err.message : String(err);
  emitFact(job.id, { type: 'error', message: job.error });
}

/**
 * Connect to Redis and start the worker.
 *
 * Never throws and never hangs: a missing/unreachable/slow Redis degrades to
 * in-process execution so the API can still boot and serve. The caller can
 * start this *after* `app.listen()` without risking an outage.
 */
export async function startAnalysisQueue(store: Store): Promise<void> {
  if (!REDIS_URL) {
    degradedReason = 'REDIS_URL not set';
    console.warn(`[queue] disabled — ${degradedReason}; analyses run in-process`);
    return;
  }

  connection = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    // ioredis emits 'error' on connect failure. With no listener Node throws,
    // which would take the process down during boot.
    connectionName: 'proofmesh-analysis'
  });
  connection.on('error', (err: Error) => {
    console.error(`[queue] redis error: ${err.message}`);
  });

  const ready = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), READY_TIMEOUT_MS);
    connection!.once('ready', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });

  if (!ready) {
    degradedReason = `redis not ready within ${READY_TIMEOUT_MS}ms`;
    console.warn(`[queue] degraded — ${degradedReason}; analyses run in-process`);
    connection.disconnect();
    connection = undefined;
    return;
  }

  queue = new Queue('proofmesh-analysis', {
    connection,
    defaultJobOptions: {
      attempts: ATTEMPTS,
      backoff: { type: 'exponential', delay: 2_000 },
      // Keep Redis small; completed jobs carry no durable state.
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 500 }
    }
  });

  worker = new Worker(
    'proofmesh-analysis',
    async (job: Job<{ jobId: string }>) => {
      const analysisJob = store.jobs.get(job.data.jobId);
      if (!analysisJob) {
        // The in-memory AnalysisJob is gone (restart / reset / other replica).
        // Retrying cannot conjure it back, so fail without burning attempts.
        throw new UnrecoverableError(`unknown analysis job ${job.data.jobId}`);
      }
      try {
        await runAnalysis(store, analysisJob, (e: SseEvent) => emitFact(analysisJob.id, e));
      } catch (err) {
        failJob(analysisJob, err);
        // Rethrow so BullMQ records the failure and applies its retry policy.
        // Otherwise every job is silently marked 'completed'.
        throw err;
      }
    },
    { connection }
  );

  worker.on('failed', (job, err) => {
    console.error(`[queue] job ${job?.id ?? '?'} failed: ${err.message}`);
  });
  worker.on('error', (err) => {
    console.error(`[queue] worker error: ${err.message}`);
  });

  console.log('Redis queue connected');
}

/** Enqueue an analysis. Falls back to in-process execution when Redis is absent. */
export async function queueAnalysisJob(store: Store, job: AnalysisJob): Promise<void> {
  if (queue) {
    // `jobId` is BullMQ's dedupe key — passing it in the payload would not dedupe.
    await queue.add('analyze', { jobId: job.id }, { jobId: job.id });
    return;
  }
  void runAnalysis(store, job, (e: SseEvent) => emitFact(job.id, e)).catch((err) => {
    failJob(job, err);
  });
}

export async function stopAnalysisQueue(): Promise<void> {
  await worker?.close().catch(() => undefined);
  await queue?.close().catch(() => undefined);
  await connection?.quit().catch(() => undefined);
  worker = undefined;
  queue = undefined;
  connection = undefined;
}