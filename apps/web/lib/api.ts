import type {
  AnalyzeRequest,
  AnalysisJob,
  AuthMe,
  AuthRole,
  CandidateDeveloper,
  Credential,
  Developer,
  EvidenceItem,
  EvidenceReport,
  Listing,
  RepoSnapshot,
  ScoreSnapshot,
  ActionProofChallenge,
  AuditEvent,
  SiwsChallenge,
  SiwsVerifyRequest,
  SseEvent,
  VerifyResult
} from '@proofmesh/shared-types';
import { API_BASE } from './constants';

export class ApiError extends Error {
  constructor(message: string, public status: number, public body: unknown) {
    super(message);
  }
}

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `HTTP ${res.status}`;
    throw new ApiError(msg, res.status, data);
  }
  return data as T;
}

/** Read the readable CSRF cookie so cookie-authenticated writes can be proven. */
function csrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = /(?:^|;\s*)pm_csrf=([^;]+)/.exec(document.cookie);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Browser transport: the session lives in an httpOnly cookie (an XSS cannot read
 * it), so requests must send credentials, and mutations must echo the CSRF
 * cookie in a header. `token` remains available for non-browser clients/tests.
 */
function authHeaders(opts?: { token?: string }): Record<string, string> {
  if (opts?.token) return { authorization: `Bearer ${opts.token}` };
  const csrf = csrfToken();
  return csrf ? { 'x-pm-csrf': csrf } : {};
}

async function get<T>(path: string, opts?: { token?: string }): Promise<T> {
  return json<T>(
    await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      headers: authHeaders(opts)
    })
  );
}

async function post<T>(path: string, body: unknown, opts?: { token?: string }): Promise<T> {
  return json<T>(
    await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...authHeaders(opts) },
      body: JSON.stringify(body)
    })
  );
}

async function del<T>(path: string, token?: string): Promise<T> {
  return json<T>(
    await fetch(`${API_BASE}${path}`, {
      method: 'DELETE',
      credentials: 'include',
      headers: authHeaders({ token })
    })
  );
}

export const api = {
  health: () => get<{ status: string; store: { developers: number; jobs: number }; deterministicOnly: boolean }>('/health'),
  developers: () => get<Developer[]>('/api/developers'),
  developer: (handle: string) => get<Developer>(`/api/developers/${handle}`),
  evidence: (handle: string) => get<EvidenceReport>(`/api/evidence/${handle}`),
  listings: () => get<Listing[]>('/api/listings'),
  search: (q: { skills?: string[]; minScore?: number; minLevel?: number }) =>
    post<CandidateDeveloper[]>('/api/search', q),
  analyze: (body: AnalyzeRequest, token?: string) => post<{ job: AnalysisJob }>('/api/analyze', body, { token }),
  job: (id: string) => get<{ job: AnalysisJob; score: ScoreSnapshot | null }>(`/api/analyze/${id}`),
  post: <T>(path: string, body: unknown = {}, opts?: { token?: string }) => post<T>(path, body, opts),
  authChallenge: (wallet: string) => post<SiwsChallenge>('/api/auth/challenge', { wallet }),
  authVerify: (req: SiwsVerifyRequest) =>
    post<{ token: string; wallet: string; role: AuthRole; expiresAt: string }>('/api/auth/verify', req),
  authMe: (token?: string) => get<AuthMe>('/api/auth/me', { token }),
  /** GitHub OAuth (the GitHub-side proof of a binding). */
  githubOAuthStart: () =>
    get<{ configured: boolean; authorizeUrl: string | null; message?: string }>('/api/auth/github/start'),
  githubOAuthStatus: () => get<{ proven: boolean; login: string | null }>('/api/auth/github/status'),
  bind: (body: { githubUsername: string; wallet: string; message: string; signature: string }) =>
    post<{ developer: Developer; binding: { wallet: string; verified?: { wallet: boolean; github: string } } }>(
      '/api/bind',
      body
    ),
  /** Tier-2 attestations. */
  attest: (body: {
    githubUsername: string;
    repo: string;
    skill: string;
    message: string;
    signature: string;
  }) => post<{ attestation: { id: string; attesterLogin: string; repo: string; skill: string; statement: string }; duplicate: boolean }>('/api/attest', body),
  attestations: (handle: string) =>
    get<{
      developer: string;
      attestations: Array<{
        id: string;
        attesterLogin: string;
        repo: string;
        skill: string;
        statement: string;
        signedMessage: string;
        signature: string;
        issuedAt: string;
      }>;
    }>(`/api/attestations/${handle}`),
  /** P3: security audit trail (admin read). */
  adminAudit: (limit = 25) =>
    get<{ capacity: number; total: number; events: AuditEvent[] }>(`/api/admin/audit?limit=${limit}`),
  authLogout: (token?: string) => post<{ ok: true }>('/api/auth/logout', {}, { token }),
  /**
   * P2: privileged admin actions require a fresh wallet signature bound to this
   * exact method + path + body. The server rejects a proof replayed onto a
   * different action, so a stolen session cookie cannot drive the admin console.
   */
  actionChallenge: (method: string, path: string, action: unknown) =>
    post<ActionProofChallenge>('/api/auth/action-challenge', { method, path, action }),
  adminPost: async <T>(path: string, body: unknown, sign: (message: string) => Promise<string>): Promise<T> => {
    const challenge = await post<ActionProofChallenge>('/api/auth/action-challenge', {
      method: 'POST',
      path,
      action: body
    });
    const signature = await sign(challenge.message);
    return json<T>(
      await fetch(`${API_BASE}${path}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          ...authHeaders(),
          'x-pm-action-nonce': challenge.nonce,
          'x-pm-action-signature': signature
        },
        body: JSON.stringify(body)
      })
    );
  },
  adminDelete: async <T>(path: string, sign: (message: string) => Promise<string>): Promise<T> => {
    const challenge = await post<ActionProofChallenge>('/api/auth/action-challenge', {
      method: 'DELETE',
      path,
      action: {}
    });
    const signature = await sign(challenge.message);
    return json<T>(
      await fetch(`${API_BASE}${path}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: {
          ...authHeaders(),
          'x-pm-action-nonce': challenge.nonce,
          'x-pm-action-signature': signature
        }
      })
    );
  },
  del: <T>(path: string, token?: string) => del<T>(path, token),
  verify: (wallet: string, skill: string) =>
    get<VerifyPayload>(`/api/verify/${encodeURIComponent(wallet)}/${encodeURIComponent(skill)}`),
  badge: (wallet: string, skill: string) => `${API_BASE}/api/badge/${wallet}/${skill}.svg`
};

// ---------------------------------------------------------------------------

export interface VerifyPayload extends Omit<VerifyResult, 'skillScore' | 'confidencePercent'> {
  score: number;
  confidence: number;
  levelLabel: string;
  dev: { handle: string; githubUsername: string; avatarUrl: string | null };
  evidence: EvidenceItem[];
  repos: RepoSnapshot[];
  reportUri: string;
}

type Dims = ScoreSnapshot['dimensions'];

export interface DashboardData {
  handle: string;
  githubUsername: string;
  skillLabel: string;
  score: number;
  confidence: number;
  levelLabel: string;
  status: string;
  attestationAddress: string;
  issuerAddress: string;
  analyzerVersion: string;
  evidenceRoot: string;
  issuedAt: string;
  expiresAt: string;
  evidence: EvidenceItem[];
  repos: RepoSnapshot[];
  dimensions: Dims | null;
  credential: Credential | null;
  verified: boolean;
}

/** Full dashboard source-of-truth: verify payload + optional score snapshot. */
export async function dashboardFor(
  wallet: string,
  skill: string,
  handle?: string
): Promise<DashboardData> {
  const v = await api.verify(wallet, skill);
  let dims: Dims | null = null;
  let credential: Credential | null = null;
  try {
    if (handle) {
      const rep = await api.evidence(handle);
      dims = rep.score?.dimensions ?? null;
      credential = rep.credential ?? null;
    }
  } catch {
    /* optional enhancement */
  }
  const conf = v.confidence;
  return {
    handle: v.dev.handle,
    githubUsername: v.dev.githubUsername,
    skillLabel: v.skillLabel,
    score: v.score,
    confidence: conf,
    levelLabel: v.levelLabel,
    status: v.status,
    attestationAddress:
      (credential as unknown as { attestationAddress?: string } | null)?.attestationAddress ??
      `solana:${wallet.slice(0, 4)}...${wallet.slice(-4)}`,
    issuerAddress: v.issuerAddress,
    analyzerVersion: v.analyzerVersion,
    evidenceRoot: v.evidenceRoot,
    issuedAt: v.issuedAt,
    expiresAt: v.expiresAt,
    evidence: v.evidence,
    repos: v.repos,
    dimensions: dims,
    credential,
    verified: v.valid
  };
}

// ---------------------------------------------------------------------------
// SSE client (fetch-backed, replay-aware). Resolves when the stream sends done.
// ---------------------------------------------------------------------------

export type PrismaStreamKind = 'sse';

export function subscribeJob(
  jobId: string,
  onEvent: (e: SseEvent) => void,
  opts?: { signal?: AbortSignal }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE}/api/analyze/${jobId}/stream`;
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    opts?.signal?.addEventListener('abort', onAbort);

    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new ApiError(`stream ${res.status}`, res.status, null);
        const reader = res.body?.getReader();
        if (!reader) throw new Error('no stream body');

        const decoder = new TextDecoder();
        let buf = '';

        const pump = (): Promise<void> =>
          reader.read().then(({ done, value }) => {
            if (done) return resolve();
            buf += decoder.decode(value, { stream: true });
            const blocks = buf.split('\n\n');
            buf = blocks.pop() ?? '';
            for (const block of blocks) {
              for (const line of block.split('\n')) {
                if (!line.startsWith('data:')) continue;
                const raw = line.slice(5).trim();
                if (!raw) continue;
                try {
                  const ev = JSON.parse(raw) as SseEvent & { type: string };
                  if (ev.type === 'error') {
                    onEvent(ev as SseEvent);
                  } else {
                    onEvent(ev as SseEvent);
                  }
                  if (ev.type === 'done') {
                    controller.abort();
                    return resolve();
                  }
                } catch {
                  /* skip malformed frame */
                }
              }
            }
            return pump();
          });
        return pump();
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        reject(err);
      })
      .finally(() => opts?.signal?.removeEventListener('abort', onAbort));
  });
}