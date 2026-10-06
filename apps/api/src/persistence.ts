import pg from 'pg';
import type { Store } from './store.js';
import type { AnalysisJob, Credential, Developer, EvidenceItem, Invite, Listing, RepoSnapshot, ScoreSnapshot, SiwsChallenge, ActionProofChallenge as ActionChallenge } from '@proofmesh/shared-types';
import type { AttestationRecord } from './attestation.js';

const DATABASE_URL = process.env.DATABASE_URL;

let pool: pg.Pool | undefined;

function getPool(): pg.Pool {
  if (!pool) {
    if (!DATABASE_URL) throw new Error('DATABASE_URL is not set');
    pool = new pg.Pool({ connectionString: DATABASE_URL });
  }
  return pool;
}

export async function initDb(): Promise<void> {
  if (!DATABASE_URL) return;
  const p = getPool();
  await p.query(`
    CREATE TABLE IF NOT EXISTS store_snapshots (
      id INT PRIMARY KEY DEFAULT 1,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

function snapshot(store: Store): Record<string, unknown> {
  return {
    developers: [...store.developers.values()],
    repos: [...store.repos.entries()],
    evidence: [...store.evidence.entries()],
    scores: [...store.scores.entries()],
    credentials: [...store.credentials.entries()],
    jobs: [...store.jobs.entries()],
    listings: store.listings,
    invites: store.invites,
    metadata: Object.fromEntries(store.metadata),
    // Deliberately NOT persisted. `store.consumeChallenge` deletes on use; a
    // snapshot written up to 5s earlier would reload an already-redeemed nonce
    // after a crash, making a captured SIWS/action signature replayable for the
    // remainder of its TTL. Nonces are short-lived by design, so the safe move
    // is to forget them on restart.
    challenges: [],
    actionChallenges: [],
    attestations: [...store.attestations.entries()],
    audit: store.auditList()
  };
}

export async function loadSnapshot(store: Store): Promise<void> {
  if (!DATABASE_URL) return;
  const p = getPool();
  const res = await p.query('SELECT data FROM store_snapshots WHERE id = 1');
  if (res.rows.length === 0) return;
  const data = res.rows[0].data as Record<string, unknown>;
  if (!data) return;
  // Replace rather than merge. Loading into a non-empty store left rows the
  // snapshot had deleted, and `listings.push` duplicated every listing.
  store.resetToEmpty();
  if (Array.isArray(data.developers)) for (const d of data.developers as never[]) store.developers.set((d as any).id, d as any);
  if (Array.isArray(data.repos)) for (const [k, v] of data.repos as [string, RepoSnapshot[]][]) store.repos.set(k, v);
  if (Array.isArray(data.evidence)) for (const [k, v] of data.evidence as [string, EvidenceItem[]][]) store.evidence.set(k, v);
  if (Array.isArray(data.scores))
    for (const [, v] of data.scores as [string, ScoreSnapshot][]) store.saveScore(v);
  if (Array.isArray(data.credentials))
    for (const [, v] of data.credentials as [string, Credential][]) store.saveCredential(v);
  if (Array.isArray(data.jobs))
    for (const [k, v] of data.jobs as [string, AnalysisJob][]) {
      // A job snapshotted mid-flight has no live worker; leaving it 'running'
      // made it hang in the UI forever.
      if (v.status === 'running') {
        v.status = 'failed';
        v.error = 'Interrupted by an API restart; re-run the analysis.';
      }
      store.jobs.set(k, v);
    }
  if (Array.isArray(data.listings)) store.listings.push(...(data.listings as never[]));
  if (Array.isArray(data.invites)) store.invites.push(...(data.invites as never[]));
  if (data.metadata && typeof data.metadata === 'object') {
    for (const [k, v] of Object.entries(data.metadata)) store.metadata.set(k, String(v));
  }
  if (Array.isArray(data.challenges)) for (const [k, v] of data.challenges as [string, SiwsChallenge][]) store.challenges.set(k, v);
  if (Array.isArray(data.actionChallenges)) for (const [k, v] of data.actionChallenges as [string, ActionChallenge][]) store.actionChallenges.set(k, v);
  if (Array.isArray(data.attestations)) for (const [k, v] of data.attestations as [string, AttestationRecord][]) store.attestations.set(k, v);
  // The audit ring was serialised every 5s but never restored, so
  // `/api/admin/audit` only ever showed events since the last restart.
  if (Array.isArray(data.audit)) store.auditRestore(data.audit as never[]);
}

export async function saveSnapshot(store: Store): Promise<void> {
  if (!DATABASE_URL) return;
  const p = getPool();
  const data = snapshot(store);
  await p.query(
    `INSERT INTO store_snapshots (id, data, updated_at) VALUES (1, $1, NOW())
     ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [JSON.stringify(data)]
  );
}

export function startPersistenceLoop(store: Store, intervalMs = 5000): NodeJS.Timeout {
  const timer = setInterval(() => {
    saveSnapshot(store).catch((err) => console.error('snapshot save failed:', err));
  }, intervalMs);
  timer.unref();
  return timer;
}
