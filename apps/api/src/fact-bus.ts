import type { SseEvent } from '@proofmesh/shared-types';

// ---------------------------------------------------------------------------
// Tiny per-job fact bus (SSE): facts are buffered per job id, then replayed
// to late subscribers. Production swap: Redis pub/sub + BullMQ job state.
// Buffers are capped and pruned once drained so finished jobs do not leak.
// ---------------------------------------------------------------------------

const MAX_BUFFERED_FACTS = 500;
const INACTIVE_JOB_MS = 10 * 60_000;
const buffers = new Map<string, SseEvent[]>();
const subscribers = new Map<string, Set<(e: SseEvent) => void>>();

export function emitFact(jobId: string, e: SseEvent): void {
  const buf = buffers.get(jobId) ?? [];
  if (buf.length >= MAX_BUFFERED_FACTS) buf.shift();
  buf.push(e);
  buffers.set(jobId, buf);
  for (const sub of subscribers.get(jobId) ?? []) sub(e);
}

/** Replay + release: reading drains the buffer so finished jobs can be GC'd. */
export function drain(jobId: string): SseEvent[] {
  const buf = buffers.get(jobId) ?? [];
  if (buf.length > 0) buffers.delete(jobId);
  return buf;
}

export function subscribe(jobId: string, fn: (e: SseEvent) => void): void {
  const set = subscribers.get(jobId) ?? new Set();
  set.add(fn);
  subscribers.set(jobId, set);
}

export function unsubscribe(jobId: string, fn: (e: SseEvent) => void): void {
  const set = subscribers.get(jobId);
  if (!set) return;
  set.delete(fn);
  if (set.size === 0) subscribers.delete(jobId);
}

/** Drop fact buffers for jobs with no active subscribers (they are gone for good). */
export function sweepFactBus(): void {
  if (subscribers.size === 0) {
    buffers.clear();
  } else {
    for (const jobId of buffers.keys()) {
      if (!subscribers.has(jobId)) buffers.delete(jobId);
    }
  }
}

// Keep the fact bus bounded even when jobs finish without a client ever polling.
const factBusSweeper = setInterval(sweepFactBus, 60_000);
factBusSweeper.unref();
