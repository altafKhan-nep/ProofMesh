/**
 * Tier-2 attestations — independent maintainer vouching for a developer's skill.
 *
 * ARCHITECTURE.md §11 lists "account renting / ghostwriting" as unsolved in the
 * MVP, with "timed live challenge, Tier-2 attestations" as the roadmap. This is
 * that roadmap item.
 *
 * An attestation says: *"I have commit access to this repository, and I vouch for
 * this developer's work on it."* The bar is therefore **repo ownership**, not
 * reputation — anyone can be an expert, but only someone whose proven GitHub
 * identity owns the repo can speak for it.
 *
 * Rules enforced here (and in the route):
 *   - The attester's OAuth-proven GitHub login must own the repository.
 *   - **No self-attestation**: the attester may not be the developer being vouched
 *     for. This is the property that makes a Tier-2 attestation independent.
 *   - **Liveness**: the signature covers a server-issued, single-use, short-TTL
 *     challenge naming the developer, repo and skill. A captured signature cannot
 *     be replayed, nor redirected at a different repo or person.
 *   - **Offline verifiable**: the signed message and signature are stored, so a
 *     third party can re-verify the attestation without trusting this backend
 *     (the same property the wallet binding advertises).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Developer, EvidenceItem, RepoSnapshot } from '@proofmesh/shared-types';

export const ATTESTATION_TTL_MS = 10 * 60_000;

/** What a stored attestation looks like — all of it independently verifiable. */
export interface AttestationRecord {
  id: string;
  /** Developer being vouched for. */
  subjectHandle: string;
  subjectDeveloperId: string;
  /** Attester's proven GitHub login (they own `repo`). */
  attesterLogin: string;
  /** Attester's wallet — the key that signed. */
  attesterWallet: string;
  /** `owner/full_name` of the repository the claim is about. */
  repo: string;
  skill: string;
  statement: string;
  /** Exact SIWS-shaped message that was signed. */
  signedMessage: string;
  /** base64 ed25519 signature over `signedMessage`. */
  signature: string;
  nonce: string;
  domain: string;
  issuedAt: string;
  expiresAt: string;
  createdAt: string;
}

export interface AttestationInput {
  subject: Developer;
  repo: string;
  skill: string;
  attesterLogin: string;
  attesterWallet: string;
  statement?: string;
}

/** Ownership is checked against ingested repos, so the claim is evidence-backed. */
export function repoOwnedBy(repos: RepoSnapshot[], fullName: string, login: string): boolean {
  const target = fullName.toLowerCase();
  const owner = login.toLowerCase();
  return repos.some((r) => r.fullName.toLowerCase() === target && r.owner.toLowerCase() === owner);
}

export function repoExists(repos: RepoSnapshot[], fullName: string): boolean {
  const target = fullName.toLowerCase();
  return repos.some((r) => r.fullName.toLowerCase() === target);
}

/** Self-attestation is the thing that would make Tier-2 worthless. */
export function isSelfAttestation(subjectHandle: string, attesterLogin: string): boolean {
  return subjectHandle.toLowerCase() === attesterLogin.toLowerCase();
}

export function attestationId(attesterWallet: string, subjectHandle: string, repo: string, nonce: string): string {
  return `att-${createHash('sha256').update(`${attesterWallet}|${subjectHandle}|${repo}|${nonce}`).digest('hex').slice(0, 16)}`;
}

export function buildAttestationStatement(input: {
  subjectHandle: string;
  repo: string;
  skill: string;
}): string {
  return `I have commit access to ${input.repo} and vouch for @${input.subjectHandle}'s ${input.skill} work in this repository.`;
}

/**
 * Turn an attestation into a scoring evidence item. `sourceIdentifier` carries
 * the attester so the engine can count *distinct* attesters — otherwise one
 * wallet could mint unlimited confidence by attesting repeatedly.
 */
export function attestationEvidence(record: AttestationRecord, analysisRunId = 'attestation'): EvidenceItem {
  return {
    id: `ev-${record.id}`,
    analysisRunId,
    type: 'MAINTAINER_ATTESTATION',
    description: `@${record.attesterLogin} (repo owner of ${record.repo}) attests @${record.subjectHandle}'s ${record.skill} work.`,
    sourceUrl: null,
    // The attester identity, so the engine can count DISTINCT attesters.
    sourceIdentifier: record.attesterWallet,
    metricName: 'maintainer_attestation',
    value: 1,
    positive: true,
    sourceVersion: 'attestation-v1',
    capturedAt: record.createdAt
  };
}

export interface VerifyAttestationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Offline verification: recompute the nonce binding and re-check the signature
 * with the attester's public key. Callable by anyone holding the record — this
 * function deliberately takes no server state.
 */
export async function verifyAttestationOffline(
  record: Pick<AttestationRecord, 'signedMessage' | 'signature' | 'attesterWallet' | 'nonce' | 'repo' | 'subjectHandle'>,
  verify: (message: string, signatureB64: string, wallet: string) => boolean
): Promise<VerifyAttestationResult> {
  // The nonce in the record must appear in the signed message, or the signature
  // was made for a different challenge.
  if (!record.signedMessage.includes(`Nonce: ${record.nonce}`)) {
    return { valid: false, reason: 'nonce_not_in_message' };
  }
  if (!record.signedMessage.includes(record.subjectHandle)) {
    return { valid: false, reason: 'subject_not_in_message' };
  }
  if (!record.signedMessage.includes(record.repo)) {
    return { valid: false, reason: 'repo_not_in_message' };
  }
  if (!verify(record.signedMessage, record.signature, record.attesterWallet)) {
    return { valid: false, reason: 'invalid_signature' };
  }
  return { valid: true };
}

/** Constant-time nonce comparison for challenge redemption. */
export function nonceMatches(a: string, b: string): boolean {
  const ab = Buffer.from(createHash('sha256').update(a).digest('hex'), 'hex');
  const bb = Buffer.from(createHash('sha256').update(b).digest('hex'), 'hex');
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
