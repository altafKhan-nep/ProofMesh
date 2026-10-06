import { describe, expect, it } from 'vitest';
import type { ParsedAttestation } from '../src/index';
import { parseCredentialLayout, verify, verifyConstraints } from '../src/index';

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

import {
  fromBase58,
  toBase58,
  isOnCurve,
  deriveCredentialPda,
  LAYOUT,
  SEED_PREFIX,
  TOTAL_ACCOUNT_LEN,
  STATUS_ISSUED,
  STATUS_EXPIRED,
  STATUS_REVOKED,
} from '../src/layout';

describe('base58 <-> bytes round-trip', () => {
  it('is lossless for a real devnet pubkey', () => {
    const addr = '6TGUP796erCCpxhosXToA4YNv4dxwz1yc7rmTvZEYagZ';
    expect(toBase58(fromBase58(addr))).toBe(addr);
  });
});

describe('PDA derivation (Solana find_program_address parity)', () => {
  it('derives deterministic off-curve addresses with a valid bump', async () => {
    const a = await deriveCredentialPda(
      '6TGUP796erCCpxhosXToA4YNv4dxwz1yc7rmTvZEYagZ',
      'solana-anchor'
    );
    const b = await deriveCredentialPda(
      '6TGUP796erCCpxhosXToA4YNv4dxwz1yc7rmTvZEYagZ',
      'solana-anchor'
    );
    expect(a.address).toBe(b.address);
    expect(a.address.length).toBe(44); // base58 Solana pubkey
    expect(a.bump).toBeGreaterThanOrEqual(0);
    expect(a.bump).toBeLessThanOrEqual(255);
    expect(isOnCurve(fromBase58(a.address))).toBe(false); // PDA must fall off the curve
  });

  it('different skill produces a different PDA', async () => {
    const a = await deriveCredentialPda(
      '6TGUP796erCCpxhosXToA4YNv4dxwz1yc7rmTvZEYagZ',
      'solana-anchor'
    );
    const b = await deriveCredentialPda(
      '6TGUP796erCCpxhosXToA4YNv4dxwz1yc7rmTvZEYagZ',
      'typescript'
    );
    expect(a.address).not.toBe(b.address);
  });
});

/** Minimal *valid* Credential payload; override individual fields per test. */
function buildCredential(over: { status?: number } = {}): Uint8Array {
  const buf = new Uint8Array(LAYOUT.structLen);
  const pubkey = fromBase58('6TGUP796erCCpxhosXToA4YNv4dxwz1yc7rmTvZEYagZ');
  buf.set(pubkey, LAYOUT.authorityOffset);
  buf.set(pubkey, LAYOUT.walletOffset);
  const enc = new TextEncoder();
  buf.set(enc.encode('solana-anchor'), LAYOUT.schemaOffset);
  buf.set(enc.encode('pow.solana-anchor.v1'), LAYOUT.analyzerOffset);
  buf[LAYOUT.skillScoreOffset] = 86;
  buf[LAYOUT.confidencePctOffset] = 92;
  buf[LAYOUT.levelOffset] = 2;
  buf[LAYOUT.statusOffset] = over.status ?? STATUS_ISSUED;
  const issued = 1726711200;
  const dv = new DataView(buf.buffer);
  dv.setBigInt64(LAYOUT.issuedAtOffset, BigInt(issued), true);
  dv.setBigInt64(LAYOUT.expiresAtOffset, BigInt(issued + 180 * 86400), true);
  return buf;
}

describe('binary credential layout (Anchor ABI mirror)', () => {
  it('parses a real account at exact offsets', () => {
    // Build the exact post-discriminator struct bytes the Anchor program
    // serializes (programs/proofmesh-gate/src/lib.rs).
    const buf = new Uint8Array(LAYOUT.structLen);
    const wallet = fromBase58('6TGUP796erCCpxhosXToA4YNv4dxwz1yc7rmTvZEYagZ');
    buf.set(wallet, LAYOUT.authorityOffset);
    buf.set(wallet, LAYOUT.walletOffset);
    const enc = new TextEncoder();
    buf.set(enc.encode('solana-anchor'), LAYOUT.schemaOffset);
    buf[LAYOUT.skillScoreOffset] = 86;
    buf[LAYOUT.confidencePctOffset] = 92;
    buf[LAYOUT.levelOffset] = 2;
    buf[LAYOUT.issuerTierOffset] = 1;
    buf.fill(0xab, LAYOUT.evidenceRootOffset, LAYOUT.evidenceRootOffset + 32);
    buf.set(enc.encode('pow-analyzer'), LAYOUT.analyzerOffset);
    buf[LAYOUT.statusOffset] = STATUS_ISSUED;

    const setI64 = (off: number, val: number) => {
      const dv = new DataView(buf.buffer, off, 8);
      dv.setBigUint64(0, BigInt(val), true);
    };
    const issued = 1726711200; // 2024-09-19
    setI64(LAYOUT.issuedAtOffset, issued);
    setI64(LAYOUT.expiresAtOffset, issued + 180 * 86400);

    const parsed = parseCredentialLayout(buf, 'pda-placeholder');
    expect(parsed).not.toBeNull();
    expect(parsed!.wallet).toBe('6TGUP796erCCpxhosXToA4YNv4dxwz1yc7rmTvZEYagZ');
    expect(parsed!.skillId).toBe('solana-anchor');
    expect(parsed!.skillScore).toBe(86);
    expect(parsed!.confidencePercent).toBe(92);
    expect(parsed!.level).toBe(2);
    expect(parsed!.status).toBe('ISSUED');
    expect(parsed!.schema).toBe('solana-anchor');
    expect(parsed!.expiresAt).toBe(new Date((issued + 180 * 86400) * 1000).toISOString());
  });

  it('rejects an all-zero account (no skill id / timestamps)', () => {
    expect(parseCredentialLayout(new Uint8Array(LAYOUT.structLen), 'x')).toBeNull();
  });

  it('rejects an unknown status byte instead of assuming ISSUED', () => {
    const buf = buildCredential();
    buf[LAYOUT.statusOffset] = 255;
    expect(parseCredentialLayout(buf, 'x')).toBeNull();
  });

  it('rejects an out-of-range level', () => {
    const buf = buildCredential();
    buf[LAYOUT.levelOffset] = 200;
    expect(parseCredentialLayout(buf, 'x')).toBeNull();
  });

  it('rejects an over-long account (exact length required)', () => {
    expect(parseCredentialLayout(new Uint8Array(LAYOUT.structLen + 900), 'x')).toBeNull();
  });

  it('rejects an absurd expiry that would throw on toISOString', () => {
    const buf = buildCredential();
    const dv = new DataView(buf.buffer, LAYOUT.expiresAtOffset, 8);
    dv.setBigInt64(0, 0x7fffffffffffffffn, true); // i64::MAX
    expect(parseCredentialLayout(buf, 'x')).toBeNull();
  });

  it('returns null for truncated/empty accounts', () => {
    expect(parseCredentialLayout(new Uint8Array(0), 'x')).toBeNull();
    expect(parseCredentialLayout(new Uint8Array(40), 'x')).toBeNull();
  });

  it('maps revoked status', () => {
    // A realistic fixture: the parser now rejects all-zero records (no skill
    // id, no timestamps), so a bare zeroed buffer is no longer valid input.
    const buf = buildCredential({ status: STATUS_REVOKED });
    const parsed = parseCredentialLayout(buf, 'pda');
    expect(parsed!.status).toBe('REVOKED');
  });
});

describe('status mapping', () => {
  it('constants align with the program (0=ISSUED 1=EXPIRED 2=REVOKED)', () => {
    expect(STATUS_ISSUED).toBe(0);
    expect(STATUS_EXPIRED).toBe(1);
    expect(STATUS_REVOKED).toBe(2);
    expect(SEED_PREFIX).toBe('credential');
    // sanity: discriminator + struct = 173 bytes, as declared in lib.rs
    expect(TOTAL_ACCOUNT_LEN).toBe(173);
  });
});

describe('base58 round-trip (regression)', () => {
  it('decodes the all-ones (zero) pubkey to exactly 32 bytes', () => {
    // The sentinel byte used to survive the trailing-zero trim, making this
    // decode to 33 bytes and rejecting the System Program address.
    const out = fromBase58('11111111111111111111111111111111');
    expect(out.length).toBe(32);
    expect(toBase58(out)).toBe('11111111111111111111111111111111');
  });

  it('round-trips a set of real-looking pubkeys', () => {
    for (const k of [
      '6TGUP796erCCpxhosXToA4YNv4dxwz1yc7rmTvZEYagZ',
      'So11111111111111111111111111111111111111112',
      '6hrtRLHSL3aKQifdz1prM1APBCRAz2XjghqxfNxBkJeV',
      '11111111111111111111111111111111'
    ]) {
      expect(toBase58(fromBase58(k))).toBe(k);
    }
  });
});

describe('expiry parsing fails closed', () => {
  const att = (expiresAt: string) => ({
    attestationAddress: 'a',
    wallet: 'w',
    skillId: 'solana-anchor',
    skillLabel: 'Solana / Anchor',
    skillScore: 90,
    confidencePercent: 90,
    level: 1 as const,
    issuerAddress: '6TGUP796erCCpxhosXToA4YNv4dxwz1yc7rmTvZEYagZ',
    schema: 'solana-anchor',
    analyzerVersion: 'pow.solana-anchor.v1',
    evidenceRoot: 'r',
    issuedAt: '2024-01-01T00:00:00.000Z',
    expiresAt,
    status: 'ISSUED' as const
  });

  it.each(['', 'garbage', 'not-a-date', 'NaN'])(
    'treats %j as expired',
    (bad) => {
      const g = verifyConstraints(att(bad), { minScore: 0, minConfidence: 0 });
      expect(g.valid).toBe(false);
      expect(g.reasons.join(' ')).toMatch(/expir/i);
    }
  );

  it('treats a future date as valid', () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(verifyConstraints(att(future), { minScore: 0, minConfidence: 0 }).valid).toBe(true);
  });

  it('rejects an out-of-range level', () => {
    const g = verifyConstraints({ ...att('2999-01-01T00:00:00.000Z'), level: 200 as never }, { minScore: 0, minConfidence: 0 });
    expect(g.valid).toBe(false);
  });
});

describe('issuer allowlist semantics', () => {
  const att = {
    attestationAddress: 'a',
    wallet: 'w',
    skillId: 'solana-anchor',
    skillLabel: 'Solana / Anchor',
    skillScore: 90,
    confidencePercent: 90,
    level: 1 as const,
    issuerAddress: 'ATTACKER',
    schema: 'solana-anchor',
    analyzerVersion: 'pow.solana-anchor.v1',
    evidenceRoot: 'r',
    issuedAt: '2024-01-01T00:00:00.000Z',
    expiresAt: '2999-01-01T00:00:00.000Z',
    status: 'ISSUED' as const
  };

  it('an EMPTY allowlist trusts nobody (previously trusted everybody)', () => {
    const g = verifyConstraints(att, { minScore: 0, minConfidence: 0, issuerAllowlist: [] });
    expect(g.valid).toBe(false);
  });

  it('undefined allowlist means "no opinion"', () => {
    expect(verifyConstraints(att, { minScore: 0, minConfidence: 0 }).valid).toBe(true);
  });

  it('a matching allowlist passes', () => {
    expect(
      verifyConstraints(att, { minScore: 0, minConfidence: 0, issuerAllowlist: ['ATTACKER'] }).valid
    ).toBe(true);
  });
});

