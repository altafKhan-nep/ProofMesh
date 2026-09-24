/**
 * GitHub OAuth — the GitHub-side proof of a binding.
 *
 * Minimal privilege by design: reading *public* repository data needs **no
 * scopes**, so we request none. The flow is the standard authorization-code
 * dance, and `state` is the CSRF defence:
 *
 *   1. `start()` mints a single-use, short-TTL state bound to the session's
 *      wallet and returns the authorize URL.
 *   2. GitHub redirects back with `code` + `state`.
 *   3. `callback()` consumes the state (single use), exchanges the code for a
 *      token server-side, calls `/user`, and returns the verified login.
 *
 * A captured `code` is useless without the matching `state`, and a replayed
 * `state` is rejected because it is consumed. Endpoints are injectable so the
 * whole flow is testable without contacting github.com.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthSession } from '@proofmesh/shared-types';

export const OAUTH_STATE_TTL_MS = 10 * 60_000;

export interface OAuthEndpoints {
  authorize: string;
  token: string;
  user: string;
}

export const DEFAULT_OAUTH_ENDPOINTS: OAuthEndpoints = {
  authorize: 'https://github.com/login/oauth/authorize',
  token: 'https://github.com/login/oauth/access_token',
  user: 'https://api.github.com/user'
};

export interface PendingOAuth {
  state: string;
  wallet: string;
  /** Hash of the state, so the raw value is not at rest. */
  stateHash: string;
  createdAt: string;
  expiresAt: string;
  /** Where to send the browser back to after the callback. */
  returnTo: string | null;
}

export const stateHash = (state: string): string => createHash('sha256').update(state).digest('hex');

export function newPendingOAuth(wallet: string, returnTo: string | null): PendingOAuth {
  const state = randomBytes(32).toString('base64url');
  const createdAt = new Date();
  return {
    state,
    wallet,
    stateHash: stateHash(state),
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + OAUTH_STATE_TTL_MS).toISOString(),
    returnTo
  };
}

export function isPendingLive(pending: PendingOAuth, now = Date.now()): boolean {
  return new Date(pending.expiresAt).getTime() >= now;
}

/** Constant-time state comparison. */
export function stateMatches(pending: PendingOAuth, presented: string): boolean {
  const a = Buffer.from(pending.stateHash, 'hex');
  const b = Buffer.from(stateHash(presented), 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  endpoints?: Partial<OAuthEndpoints>;
  /** Injected for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export function oauthConfigured(config: Pick<OAuthConfig, 'clientId' | 'clientSecret'>): boolean {
  return Boolean(config.clientId && config.clientSecret);
}

/** Build the authorize URL. No `scope` parameter: public data needs no scopes. */
export function authorizeUrl(config: OAuthConfig, pending: PendingOAuth, redirectUri: string): string {
  const endpoints = { ...DEFAULT_OAUTH_ENDPOINTS, ...config.endpoints };
  const url = new URL(endpoints.authorize);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', pending.state);
  url.searchParams.set('allow_signup', 'false');
  return url.toString();
}

export interface OAuthResult {
  login: string;
  id: number;
  avatarUrl: string | null;
}

/** Exchange the code and read the authenticated identity. */
export async function exchangeCode(
  config: OAuthConfig,
  code: string,
  redirectUri: string
): Promise<OAuthResult> {
  const endpoints = { ...DEFAULT_OAUTH_ENDPOINTS, ...config.endpoints };
  const doFetch = config.fetchImpl ?? fetch;

  const tokenRes = await doFetch(endpoints.token, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: redirectUri
    })
  });
  if (!tokenRes.ok) throw new Error(`oauth_token_exchange_failed_${tokenRes.status}`);
  const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokenJson.access_token) {
    throw new Error(`oauth_no_access_token${tokenJson.error ? `_${tokenJson.error}` : ''}`);
  }

  const userRes = await doFetch(endpoints.user, {
    headers: {
      authorization: `Bearer ${tokenJson.access_token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'proofmesh'
    }
  });
  if (!userRes.ok) throw new Error(`oauth_user_fetch_failed_${userRes.status}`);
  const user = (await userRes.json()) as { login?: string; id?: number; avatar_url?: string | null };
  if (!user.login || typeof user.id !== 'number') throw new Error('oauth_user_incomplete');
  return { login: user.login, id: user.id, avatarUrl: user.avatar_url ?? null };
}

/** Public projection of a session's proven GitHub identity. */
export function githubProofOf(session: AuthSession): { login: string } | null {
  return session.githubLogin ? { login: session.githubLogin } : null;
}
