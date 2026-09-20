import { describe, expect, it } from 'vitest';
import type { ParsedAttestation } from '../src/index';
import { verify, verifyConstraints } from '../src/index';

const valid: ParsedAttestation = {
  attestationAddress: 'AjXpD9vnYtnNhgUUBwQxQfTTtBbTLCvLHT',
  wallet: '7xGqYtRZLJ4XZiQn69NCHsWkY1mTVMLqmL',
  skillId: 'solana-anchor',
  skillLabel: 'Solana / Anchor',
  skillScore: 86,
  confidencePercent: 92,
  level: 2,
  issuerAddress: 'ProofMeshIssuer111111111111111111111111111',
  schema: 'pow.solana-anchor.v1',
  analyzerVersion: 'pow.solana-anchor.v1',
  evidenceRoot: 'a4f9...',
  issuedAt: '2026-09-20T00:00:00.000Z',
  expiresAt: '2027-03-20T00:00:00.000Z',
  status: 'ISSUED'
};

describe('verifyConstraints', () => {
  it('passes a healthy attestation against thresholds', () => {
    const r = verifyConstraints(valid, { minScore: 75, minConfidence: 0.75, issuerAllowlist: [valid.issuerAddress] });
    expect(r.valid).toBe(true);
    expect(r.reasons).toHaveLength(0);
  });
  it('fails below min score', () => {
    const r = verifyConstraints(valid, { minScore: 90, minConfidence: 0 });
    expect(r.valid).toBe(false);
    expect(r.reasons[0]).toMatch(/Score 86 below minimum 90/);
  });
  it('fails below min confidence', () => {
    const r = verifyConstraints(valid, { minScore: 0, minConfidence: 0.95 });
    expect(r.valid).toBe(false);
    expect(r.reasons.some((x) => x.includes('Confidence'))).toBe(true);
  });
  it('rejects an issuer outside the allowlist', () => {
    const r = verifyConstraints(valid, { minScore: 0, minConfidence: 0, issuerAllowlist: ['SomeoneElse'] });
    expect(r.valid).toBe(false);
    expect(r.reasons[0]).toMatch(/not in allowlist/);
  });
  it('rejects expired, revoked, or level-0 credentials', () => {
    const expired = { ...valid, expiresAt: '2026-01-01T00:00:00.000Z' };
    const revoked = { ...valid, status: 'REVOKED' as const };
    const lvl0 = { ...valid, level: 0 as const };
    expect(verifyConstraints(expired, { minScore: 0, minConfidence: 0 }).valid).toBe(false);
    expect(verifyConstraints(revoked, { minScore: 0, minConfidence: 0 }).valid).toBe(false);
    expect(verifyConstraints(lvl0, { minScore: 0, minConfidence: 0 }).valid).toBe(false);
  });
});

describe('verify (RPC-only, injected reader)', () => {
  it('never calls the backend and validates entirely against the RPC attestation', async () => {
    const result = await verify('7xGqYtRZLJ4XZiQn69NCHsWkY1mTVMLqmL', 'solana-anchor', {
      minScore: 75,
      minConfidence: 0.75,
      readAttestation: async () => valid
    });
    expect(result.valid).toBe(true);
    expect(result.score).toBe(86);
    expect(result.confidence).toBeCloseTo(0.92, 2);
    expect(result.reportUri).toMatch(/^https:\/\/proofmesh\.xyz\/verify\//);
  });
  it('reports invalid when no attestation exists on-chain', async () => {
    const result = await verify('random-wallet', 'solana-anchor', {
      readAttestation: async () => null
    });
    expect(result.valid).toBe(false);
  });
});