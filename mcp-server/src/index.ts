#!/usr/bin/env node
/**
 * ProofMesh MCP server — read-only tools for agent triage.
 *
 * Connects to a running ProofMesh API (default http://localhost:4000) and
 * exposes five read-only tools:
 *   1. get_verified_skills  — list credentials for a wallet or GitHub handle
 *   2. search_developers   — filter candidates by skill/score/level
 *   3. explain_evidence     — dimension scores + top evidence for a credential
 *   4. verify_credential    — validate an on-chain attestation
 *   5. triage_applicants    — rank applicants against a job requirement
 *
 * No writes, no mutations. All data comes from the live API.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { SKILLS, LEVEL_INFO, type CredentialLevel } from '@proofmesh/shared-types';

/** Offsets and raw account bytes are untrusted; clamp before indexing. */
function clampLevel(level: number): CredentialLevel {
  return (Number.isFinite(level) ? Math.min(3, Math.max(0, Math.trunc(level))) : 0) as CredentialLevel;
}

const API_BASE = process.env.PROOFMESH_API_URL ?? 'http://localhost:4000';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`API ${res.status}: ${body.error ?? res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Like `apiFetch`, but a 404 is a legitimate ANSWER, not a failure.
 *
 * `/api/verify/:wallet/:skill` answers 404 with a structured
 * `{ valid: false, reason: 'credential_not_found' }` body when no credential
 * exists. Throwing on that turned a normal "this wallet has no credential"
 * result into an opaque transport error, so the agent could not distinguish
 * "not credentialed" from "the API is broken".
 */
async function apiFetchAllowing404<T>(path: string, init?: RequestInit): Promise<T | null> {
  const res = await fetch(`${API_BASE}${path}`, init);
  if (res.status === 404) return (await res.json().catch(() => ({}))) as T;
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(`API ${res.status}: ${body.error ?? res.statusText}`);
  }
  return res.json() as Promise<T>;
}

/** Path segments are caller-controlled; never interpolate them raw. */
function seg(value: string): string {
  return encodeURIComponent(value);
}

interface EvidenceResponse {
  developer: { githubHandle: string; githubUsername: string; avatarUrl: string | null };
  repos: Array<{ fullName: string; primaryLanguage: string | null; starsAtSnapshot: number }>;
  evidence: Array<{ type: string; description: string; sourceUrl: string | null; positive: boolean }>;
  score: {
    skillId: string;
    shownScore: number;
    confidence: number;
    evidenceUnits: number;
    dimensions: Array<{ dimension: string; score: number; evidenceUnits: number }>;
  } | null;
  credential: {
    skillId: string;
    skillScore: number;
    confidencePercent: number;
    level: number;
    issuerAddress: string;
    expiresAt: string;
    status: string;
    attestationAddress: string;
    evidenceRoot: string;
    reportUri: string;
  } | undefined;
}

/** `/api/search` returns a bare `CandidateDeveloper[]`. */
type SearchResponse = Array<{
  githubHandle: string;
  githubUsername: string;
  avatarUrl: string | null;
  score: { shownScore: number; confidence: number; skillId: string };
  level: number;
}>;

interface VerifyResponse {
  valid: boolean;
  wallet: string;
  skillId: string;
  skillLabel: string;
  score: number;
  confidence: number;
  level: number;
  levelLabel: string;
  issuerAddress: string;
  attestationAddress: string;
  evidenceRoot: string;
  reportUri: string;
  dev: { handle: string; githubUsername: string; avatarUrl: string | null };
  evidence: Array<{ type: string; description: string; sourceUrl: string | null; positive: boolean }>;
  repos: Array<{ fullName: string; primaryLanguage: string | null; starsAtSnapshot: number }>;
  issuedAt: string;
  expiresAt: string;
  status: string;
  reasons?: string[];
}

const server = new McpServer({
  name: 'proofmesh',
  version: '2.4.1'
});

server.registerTool(
  'get_verified_skills',
  {
    title: 'Get Verified Skills',
    description:
      'List all verified skill credentials for a developer, looked up by Solana wallet address or GitHub handle.',
    inputSchema: {
      wallet: z.string().optional().describe('Solana wallet address (base58)'),
      github_handle: z.string().optional().describe('GitHub handle (e.g. "octocat")')
    }
  },
  async ({ wallet, github_handle }) => {
    if (!wallet && !github_handle) {
      return { content: [{ type: 'text', text: 'Error: provide wallet or github_handle' }] };
    }
    const handle = wallet
      ? await resolveHandleByWallet(wallet)
      : github_handle!;
    if (!handle) {
      return { content: [{ type: 'text', text: `No developer found for wallet ${wallet}` }] };
    }
    const data = await apiFetch<EvidenceResponse>(`/api/evidence/${seg(handle)}`);
    if (!data.score || !data.credential) {
      return {
        content: [
          {
            type: 'text',
            text: `No credential for ${handle}. Score: ${data.score?.shownScore ?? 'N/A'}/100, confidence: ${data.score?.confidence ?? 'N/A'}.`
          }
        ]
      };
    }
    const c = data.credential;
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              handle: data.developer.githubHandle,
              skill: c.skillId,
              skillLabel: SKILLS[c.skillId as keyof typeof SKILLS]?.label ?? c.skillId,
              score: c.skillScore,
              confidence: c.confidencePercent,
              level: c.level,
              levelLabel: LEVEL_INFO[clampLevel(c.level)]?.label ?? 'Unknown',
              issuer: c.issuerAddress,
              attestationAddress: c.attestationAddress,
              evidenceRoot: c.evidenceRoot,
              reportUri: c.reportUri,
              expiresAt: c.expiresAt,
              status: c.status
            },
            null,
            2
          )
        }
      ]
    };
  }
);

server.registerTool(
  'search_developers',
  {
    title: 'Search Developers',
    description:
      'Search verified developers by skill, minimum score, minimum confidence, and minimum level. Returns ranked candidates.',
    inputSchema: {
      skills: z.array(z.enum(Object.keys(SKILLS) as [string, ...string[]])).optional(),
      min_score: z.number().min(0).max(100).optional(),
      min_confidence: z.number().min(0).max(1).optional(),
      min_level: z.number().min(1).max(3).optional(),
      limit: z.number().min(1).max(50).optional()
    }
  },
  async ({ skills, min_score, min_confidence, min_level, limit }) => {
    // `/api/search` is POST-only and reads its filters from the JSON body.
    // It returns a BARE array, not { candidates: [...] }.
    const rows = await apiFetch<SearchResponse>('/api/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        skills,
        minScore: min_score,
        minConfidence: min_confidence,
        minLevel: min_level,
        limit
      })
    });
    if (rows.length === 0) {
      return { content: [{ type: 'text', text: 'No developers match the criteria.' }] };
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            rows.map((c) => ({
              handle: c.githubHandle,
              skill: c.score.skillId,
              score: c.score.shownScore,
              confidence: c.score.confidence,
              level: c.level,
              levelLabel: LEVEL_INFO[clampLevel(c.level)]?.label ?? 'Unknown'
            })),
            null,
            2
          )
        }
      ]
    };
  }
);

server.registerTool(
  'explain_evidence',
  {
    title: 'Explain Evidence',
    description:
      'Given a wallet and skill, return the dimension-by-dimension score breakdown and top evidence items that support or refute the credential.',
    inputSchema: {
      wallet: z.string().describe('Solana wallet address'),
      skill: z.enum(Object.keys(SKILLS) as [string, ...string[]]).describe('Skill ID')
    }
  },
  async ({ wallet, skill }) => {
    const handle = await resolveHandleByWallet(wallet);
    if (!handle) {
      return { content: [{ type: 'text', text: `No developer found for wallet ${wallet}` }] };
    }
    // Always scope to the requested skill. Without `?skill=` the API returns its
    // default pack, which silently mislabels the breakdown as another skill.
    const data = await apiFetch<EvidenceResponse>(`/api/evidence/${seg(handle)}?skill=${seg(skill)}`);
    if (!data.score) {
      return { content: [{ type: 'text', text: `No ${skill} score for ${handle}.` }] };
    }
    if (data.score.skillId !== skill) {
      return {
        content: [
          {
            type: 'text',
            text: `No ${skill} score for ${handle} (API returned ${data.score.skillId}).`
          }
        ]
      };
    }
    const topEvidence = data.evidence
      .slice()
      .sort((a, b) => (b.positive ? 1 : 0) - (a.positive ? 1 : 0))
      .slice(0, 10);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              handle: data.developer.githubHandle,
              skill: data.score.skillId,
              shownScore: data.score.shownScore,
              confidence: data.score.confidence,
              evidenceUnits: data.score.evidenceUnits,
              dimensions: data.score.dimensions,
              topEvidence: topEvidence.map((e) => ({
                type: e.type,
                description: e.description,
                source: e.sourceUrl,
                positive: e.positive
              })),
              repos: data.repos.map((r) => ({
                name: r.fullName,
                language: r.primaryLanguage,
                stars: r.starsAtSnapshot
              }))
            },
            null,
            2
          )
        }
      ]
    };
  }
);

server.registerTool(
  'verify_credential',
  {
    title: 'Verify Credential',
    description:
      'Verify an on-chain credential attestation by wallet and skill. Returns validity, score, confidence, level, and evidence root.',
    inputSchema: {
      wallet: z.string().describe('Solana wallet address'),
      skill: z.enum(Object.keys(SKILLS) as [string, ...string[]]).describe('Skill ID')
    }
  },
  async ({ wallet, skill }) => {
    const data = await apiFetchAllowing404<VerifyResponse>(`/api/verify/${seg(wallet)}/${seg(skill)}`);
    if (!data || !data.valid) {
      const reasons = data?.reasons ?? (data as { reason?: string } | null)?.reason ?? ['credential_not_found'];
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ valid: false, wallet, skill, reasons }, null, 2)
          }
        ]
      };
    }
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            {
              valid: true,
              wallet,
              skill: data.skillId,
              skillLabel: data.skillLabel,
              score: data.score,
              confidence: data.confidence,
              level: data.level,
              levelLabel: data.levelLabel,
              issuer: data.issuerAddress,
              attestationAddress: data.attestationAddress,
              evidenceRoot: data.evidenceRoot,
              reportUri: data.reportUri,
              developer: data.dev,
              issuedAt: data.issuedAt,
              expiresAt: data.expiresAt,
              status: data.status
            },
            null,
            2
          )
        }
      ]
    };
  }
);

server.registerTool(
  'triage_applicants',
  {
    title: 'Triage Applicants',
    description:
      'Rank a list of applicant wallets against a job requirement (skill + minimum score). Returns fit assessment for each.',
    inputSchema: {
      requirement: z.object({
        skill: z.enum(Object.keys(SKILLS) as [string, ...string[]]).describe('Required skill'),
        min_score: z.number().min(0).max(100).optional().describe('Minimum shown score'),
        min_level: z.number().min(1).max(3).optional().describe('Minimum credential level')
      }),
      applicants: z
        .array(z.string())
        .min(1)
        .max(50)
        .describe('List of applicant Solana wallet addresses')
    }
  },
  async ({ requirement, applicants }) => {
    const results = [];
    for (const wallet of applicants) {
      try {
        const data = await apiFetchAllowing404<VerifyResponse>(
          `/api/verify/${seg(wallet)}/${seg(requirement.skill)}`
        );
        if (!data || !data.valid) {
          const reasons = data?.reasons ?? (data as { reason?: string } | null)?.reason ?? ['not_found'];
          results.push({ wallet, fit: 'no_credential', reasons });
          continue;
        }
        const scoreOk = requirement.min_score == null || data.score >= requirement.min_score;
        const levelOk = requirement.min_level == null || data.level >= requirement.min_level;
        const fit = scoreOk && levelOk ? 'strong' : scoreOk ? 'partial' : 'weak';
        results.push({
          wallet,
          fit,
          score: data.score,
          confidence: data.confidence,
          level: data.level,
          levelLabel: data.levelLabel,
          developer: data.dev.handle,
          gaps: [
            ...(!scoreOk ? [`score ${data.score} < min ${requirement.min_score}`] : []),
            ...(!levelOk ? [`level ${data.level} < min ${requirement.min_level}`] : [])
          ]
        });
      } catch {
        results.push({ wallet, fit: 'error', reasons: ['lookup_failed'] });
      }
    }
    results.sort((a, b) => {
      const order = { strong: 0, partial: 1, weak: 2, no_credential: 3, error: 4 };
      return (order[a.fit as keyof typeof order] ?? 5) - (order[b.fit as keyof typeof order] ?? 5);
    });
    return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
  }
);

async function resolveHandleByWallet(wallet: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/api/developers`);
    if (!res.ok) return null;
    const devs = (await res.json()) as Array<{ githubHandle: string; linkedWallets: Array<{ wallet: string }> }>;
    const match = devs.find((d) => d.linkedWallets.some((w) => w.wallet === wallet));
    return match?.githubHandle ?? null;
  } catch {
    return null;
  }
}

const transport = new StdioServerTransport();
await server.connect(transport);
