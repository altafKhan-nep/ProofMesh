/**
 * Security audit log (P3).
 *
 * Records who did what, when, and how it ended. Never records secrets: session
 * tokens, CSRF tokens, signatures and SIWS message bodies are redacted by
 * construction — callers pass intent, not credentials.
 *
 * Storage is a bounded in-memory ring (Store-backed) so a burst cannot exhaust
 * memory; the same seam as the rest of Store, so a durable sink (Postgres/S3)
 * can replace it without touching call sites.
 */
import { randomUUID } from 'node:crypto';
import type { AuditEvent, AuditOutcome, AuditEventType } from '@proofmesh/shared-types';

export const AUDIT_CAPACITY = 1000;

/** Field names that must never reach the log, even if a caller passes them. */
const FORBIDDEN_META = new Set([
  'token',
  'csrftoken',
  'csrf',
  'signature',
  'message',
  'secret',
  'password',
  'authorization',
  'cookie'
]);

export interface AuditInput {
  type: AuditEventType;
  outcome: AuditOutcome;
  actor?: string;
  role?: AuditEvent['role'];
  method?: string;
  route?: string;
  reason?: string;
  ip?: string;
  meta?: Record<string, string | number | boolean | undefined>;
}

function scrubMeta(
  meta: Record<string, string | number | boolean | undefined> | undefined
): Record<string, string | number | boolean> | undefined {
  if (!meta) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (FORBIDDEN_META.has(k.toLowerCase())) continue;
    if (v === undefined) continue;
    out[k] = typeof v === 'string' ? v.slice(0, 120) : v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** Build a redacted audit event. */
export function auditEvent(input: AuditInput): AuditEvent {
  return {
    id: randomUUID(),
    at: new Date().toISOString(),
    type: input.type,
    outcome: input.outcome,
    ...(input.actor ? { actor: input.actor } : {}),
    ...(input.role ? { role: input.role } : {}),
    ...(input.method ? { method: input.method } : {}),
    ...(input.route ? { route: input.route } : {}),
    ...(input.reason ? { reason: input.reason.slice(0, 80) } : {}),
    ...(input.ip ? { ip: input.ip } : {}),
    ...(scrubMeta(input.meta) ? { meta: scrubMeta(input.meta) } : {})
  };
}

/** Bounded, newest-first audit ring. */
export class AuditLog {
  private events: AuditEvent[] = [];

  constructor(private readonly capacity: number = AUDIT_CAPACITY) {}

  record(input: AuditInput): AuditEvent {
    const event = auditEvent(input);
    this.events.unshift(event);
    if (this.events.length > this.capacity) this.events.length = this.capacity;
    return event;
  }

  list(opts: { limit?: number; type?: AuditEventType; outcome?: AuditOutcome } = {}): AuditEvent[] {
    let out = this.events;
    if (opts.type) out = out.filter((e) => e.type === opts.type);
    if (opts.outcome) out = out.filter((e) => e.outcome === opts.outcome);
    return out.slice(0, Math.min(opts.limit ?? 100, this.capacity));
  }

  get size(): number {
    return this.events.length;
  }

  clear(): void {
    this.events = [];
  }

  /**
   * Re-insert a persisted event verbatim.
   *
   * Restoring (rather than re-recording) keeps the original timestamp and id,
   * so a restored audit trail is indistinguishable from a continuous one.
   */
  restore(event: AuditEvent): void {
    this.events.unshift(event);
    if (this.events.length > this.capacity) this.events.length = this.capacity;
  }
}
