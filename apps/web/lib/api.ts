import type {
  AnalyzeRequest,
  AnalysisJob,
  CandidateDeveloper,
  Credential,
  Developer,
  EvidenceItem,
  EvidenceReport,
  Listing,
  RepoSnapshot,
  ScoreSnapshot,
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

async function get<T>(path: string): Promise<T> {
  return json<T>(await fetch(`${API_BASE}${path}`));
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return json<T>(
    await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
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
  analyze: (body: AnalyzeRequest) => post<{ job: AnalysisJob }>('/api/analyze', body),
  bind: (body: { githubUsername: string; wallet: string }) =>
    post<{ developer: Developer; binding: { wallet: string; domain: string } }>('/api/bind', body),
  job: (id: string) => get<{ job: AnalysisJob; score: ScoreSnapshot | null }>(`/api/analyze/${id}`),
  post: <T>(path: string, body: unknown = {}) => post<T>(path, body),
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