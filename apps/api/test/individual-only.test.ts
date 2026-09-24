import { describe, expect, it } from 'vitest';
import type { EvidenceItem, RepoSnapshot } from '@proofmesh/shared-types';
import { predictCredential } from '../src/pipeline.js';

function repo(over: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    id: 'r1',
    developerId: 'd1',
    owner: 'acme',
    name: 'lib',
    fullName: 'acme/lib',
    defaultBranch: 'main',
    primaryLanguage: 'typescript',
    snapshotCommitSha: null,
    isFork: false,
    starsAtSnapshot: 900,
    snapshotAt: new Date().toISOString(),
    commitCount: 400,
    prCount: 10,
    testFileCount: 40,
    sourceFileCount: 200,
    ciGreen: true,
    inspected: true,
    ...over
  };
}

function evidence(): EvidenceItem[] {
  const mk = (id: string, type: EvidenceItem['type'], value: number): EvidenceItem => ({
    id,
    analysisRunId: 'test',
    type,
    description: id,
    sourceUrl: null,
    sourceIdentifier: id,
    positive: true,
    value
  });
  return [
    mk('e-tests', 'REPO_TESTS_GREEN_CI', 4),
    mk('e-release', 'RELEASE', 8),
    mk('e-traction', 'REPO_TRACTION', 4),
    mk('e-survival', 'CODE_SURVIVAL', 1),
    mk('e-signed', 'SIGNED_COMMIT_RATIO', 0.9),
    ...Array.from({ length: 12 }, (_, i) => mk(`a${i}`, 'ACTIVITY_MONTH', 1))
  ];
}

describe('individual-only issuance', () => {
  const repos = Array.from({ length: 4 }, (_, i) =>
    repo({ id: `r${i}`, name: `lib${i}`, fullName: `acme/lib${i}` })
  );
  const ev = evidence();

  it('issues a strong INDIVIDUAL account', () => {
    const p = predictCredential('typescript', repos, ev, { accountType: 'User' });
    expect(p.score.shownScore).toBeGreaterThanOrEqual(60);
    expect(p.issued).toBe(true);
  });

  it('refuses an Organization account even when its score clears the bar', () => {
    const org = predictCredential('typescript', repos, ev, { accountType: 'Organization' });
    expect(org.score.shownScore).toBeGreaterThanOrEqual(60);
    expect(org.issued).toBe(false);
    expect(org.reasons.join(' ')).toMatch(/not an individual/i);
  });

  it('refuses a Bot account', () => {
    expect(predictCredential('typescript', repos, ev, { accountType: 'Bot' }).issued).toBe(false);
  });

  it('treats an unknown account type as an individual (seeded/legacy rows)', () => {
    expect(predictCredential('typescript', repos, ev).issued).toBe(true);
  });

  it('still refuses a weak individual (score gate is not bypassed by type)', () => {
    const weak = predictCredential('typescript', [repo({ testFileCount: 0, ciGreen: false, starsAtSnapshot: 0 })], [], {
      accountType: 'User'
    });
    expect(weak.issued).toBe(false);
  });
});
