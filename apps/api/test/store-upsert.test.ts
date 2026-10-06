import { describe, expect, it } from 'vitest';
import { Store } from '../src/store.js';
import type { Credential, Developer, ScoreSnapshot, SkillId } from '@proofmesh/shared-types';

/** `search` iterates the developer table, so fixtures need developer rows. */
function developer(id: string, handle: string): Developer {
  return {
    id,
    githubId: handle,
    githubUsername: handle,
    githubHandle: handle,
    accountType: 'User',
    avatarUrl: null,
    linkedWallets: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

/**
 * Regression tests for the store's (developer, skill) upsert semantics.
 *
 * These pin two bugs that made re-analysis impossible:
 *  1. `scoreFor`/`credentialFor` were linear first-match scans over maps keyed
 *     by fresh random ids, so a second analysis of the same developer could
 *     never be observed by any read path.
 *  2. `credentialFor` never checked `expiresAt`, so an expired credential kept
 *     satisfying it — which is why `/api/badge` could print a green VERIFIED
 *     badge for a credential `/api/verify` had already 404'd.
 */

const DEV = 'dev-1';
const SKILL: SkillId = 'solana-anchor';

function score(overrides: Partial<ScoreSnapshot> = {}): ScoreSnapshot {
  return {
    id: 'score-1',
    developerId: DEV,
    skillId: SKILL,
    rawScore: 70,
    shownScore: 70,
    confidence: 0.8,
    evidenceUnits: 10,
    priorScore: 50,
    dimensions: [],
    cohort: 'CORPUS-test',
    snapshotCommitSha: null,
    scoredAt: new Date().toISOString(),
    analyzerVersion: 'pow.solana-anchor.v1',
    passedEligibility: true,
    eligibilityReasons: [],
    ...overrides
  } as ScoreSnapshot;
}

function cred(overrides: Partial<Credential> = {}): Credential {
  return {
    id: 'cred-1',
    developerId: DEV,
    wallet: 'Wallet11111111111111111111111111111111',
    skillId: SKILL,
    attestationAddress: 'Att111',
    issuerAddress: 'Iss111',
    schema: 'pow.solana-anchor.v1',
    skillScore: 70,
    confidencePercent: 80,
    level: 1,
    issuerTier: 1,
    evidenceRoot: 'a'.repeat(64),
    analyzerVersion: 'pow.solana-anchor.v1',
    reportUri: 'https://proofmesh.xyz/verify/x/solana-anchor',
    status: 'ISSUED',
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    ...overrides
  } as Credential;
}

describe('Store score/credential upsert', () => {
  it('returns the newest score after a re-analysis', () => {
    const store = new Store({ seed: false });
    store.saveScore(score({ id: 'score-1', shownScore: 40 }));
    expect(store.scoreFor(DEV, SKILL)?.shownScore).toBe(40);

    // A second analysis previously became invisible: the first record shadowed it.
    store.saveScore(score({ id: 'score-2', shownScore: 82 }));
    expect(store.scoreFor(DEV, SKILL)?.shownScore).toBe(82);
    expect(store.scoreFor(DEV, SKILL)?.id).toBe('score-2');
  });

  it('keeps scores for different skills independent', () => {
    const store = new Store({ seed: false });
    store.saveScore(score({ id: 'a', skillId: 'solana-anchor', shownScore: 30 }));
    store.saveScore(score({ id: 'b', skillId: 'typescript', shownScore: 90 }));
    expect(store.scoreFor(DEV, 'solana-anchor')?.shownScore).toBe(30);
    expect(store.scoreFor(DEV, 'typescript')?.shownScore).toBe(90);
  });

  it('supersedes a re-minted credential for the same pair', () => {
    const store = new Store({ seed: false });
    store.saveCredential(cred({ id: 'cred-1', skillScore: 40, issuedAt: '2026-01-01T00:00:00.000Z' }));
    store.saveCredential(cred({ id: 'cred-2', skillScore: 88, issuedAt: '2026-06-01T00:00:00.000Z' }));
    expect(store.credentialFor(DEV, SKILL)?.id).toBe('cred-2');
  });

  it('does NOT let an older credential overwrite a newer one', () => {
    const store = new Store({ seed: false });
    store.saveCredential(cred({ id: 'new', skillScore: 88, issuedAt: '2026-06-01T00:00:00.000Z' }));
    store.saveCredential(cred({ id: 'old', skillScore: 10, issuedAt: '2026-01-01T00:00:00.000Z' }));
    expect(store.credentialFor(DEV, SKILL)?.id).toBe('new');
  });

  it('treats an expired credential as absent', () => {
    const store = new Store({ seed: false });
    store.saveCredential(cred({ expiresAt: new Date(Date.now() - 1000).toISOString() }));
    expect(store.credentialFor(DEV, SKILL)).toBeUndefined();
  });

  it('treats an unparseable expiry as expired (fail closed)', () => {
    const store = new Store({ seed: false });
    store.saveCredential(cred({ expiresAt: 'garbage' }));
    expect(store.credentialFor(DEV, SKILL)).toBeUndefined();
  });

  it('does not return a non-ISSUED credential', () => {
    const store = new Store({ seed: false });
    store.saveCredential(cred({ status: 'REVOKED' }));
    expect(store.credentialFor(DEV, SKILL)).toBeUndefined();
  });
});

describe('Store.search', () => {
  function seedTwo(store: Store): void {
    store.developers.set('dev-strong', developer('dev-strong', 'strong-dev'));
    store.developers.set('dev-weak', developer('dev-weak', 'weak-dev'));
    const strong = score({ id: 's-strong', developerId: 'dev-strong', shownScore: 95 });
    const weak = score({ id: 's-weak', developerId: 'dev-weak', shownScore: 61 });
    store.saveScore(strong);
    store.saveScore(weak);
    store.saveCredential(
      cred({ id: 'c-strong', developerId: 'dev-strong', skillScore: 95, issuedAt: '2026-06-01T00:00:00.000Z' })
    );
    store.saveCredential(
      cred({ id: 'c-weak', developerId: 'dev-weak', skillScore: 61, issuedAt: '2026-06-01T00:00:00.000Z' })
    );
  }

  it('returns each developer at most once even when they match several skills', () => {
    const store = new Store({ seed: false });
    seedTwo(store);
    // dev-strong also has a typescript credential.
    store.saveScore(score({ id: 's-strong-ts', developerId: 'dev-strong', skillId: 'typescript', shownScore: 91 }));
    store.saveCredential(
      cred({
        id: 'c-strong-ts',
        developerId: 'dev-strong',
        skillId: 'typescript',
        skillScore: 91,
        issuedAt: '2026-06-02T00:00:00.000Z'
      })
    );

    const rows = store.search({ limit: 50 });
    const handles = rows.map((r) => r.githubHandle);
    expect(new Set(handles).size).toBe(handles.length);
  });

  it('clamps a negative limit instead of returning everything', () => {
    const store = new Store({ seed: false });
    seedTwo(store);
    // `slice(0, -1)` used to return the entire candidate set.
    expect(store.search({ limit: -1 }).length).toBeLessThanOrEqual(1);
  });

  it('honours minScore', () => {
    const store = new Store({ seed: false });
    seedTwo(store);
    const rows = store.search({ minScore: 90, limit: 50 });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.score!.shownScore).toBe(95);
  });

  it('excludes expired credentials from results', () => {
    const store = new Store({ seed: false });
    store.developers.set('dev-x', developer('dev-x', 'x-dev'));
    store.saveScore(score({ id: 's-x', developerId: 'dev-x' }));
    store.saveCredential(
      cred({ id: 'c-x', developerId: 'dev-x', expiresAt: new Date(Date.now() - 1000).toISOString() })
    );
    expect(store.search({ limit: 50 })).toHaveLength(0);
  });
});