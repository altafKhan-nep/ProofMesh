import { Keypair } from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';

/** Sign an exact message with a test keypair (base64, as the API expects). */
export function sign(kp: Keypair, message: string): string {
  return Buffer.from(ed25519.sign(new TextEncoder().encode(message), kp.secretKey.slice(0, 32))).toString(
    'base64'
  );
}

/**
 * Perform a privileged (admin) action the way a real wallet client must: fetch a
 * single-use action challenge bound to method+path+body, sign it, then send the
 * proof headers. `fetchImpl` lets a test pass signed admin actions as the
 * `run(t)` callback of a role matrix.
 */
export async function signedAdminFetch(
  baseUrl: string,
  token: string,
  kp: Keypair,
  method: 'POST' | 'DELETE',
  path: string,
  body: unknown = {},
  init: { headers?: Record<string, string> } = {}
): Promise<Response> {
  const authHeaders = { authorization: `Bearer ${token}`, ...(init.headers ?? {}) };
  const challenge = await (
    await fetch(`${baseUrl}/api/auth/action-challenge`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders },
      body: JSON.stringify({ method, path, action: body })
    })
  ).json();
  const signature = sign(kp, challenge.message);
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      ...authHeaders,
      'x-pm-action-nonce': challenge.nonce,
      'x-pm-action-signature': signature
    },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {})
  });
}
