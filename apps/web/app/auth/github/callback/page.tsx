'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { GlobalHeader } from '../../../../components/GlobalHeader';
import { GlobalFooter } from '../../../../components/GlobalFooter';
import { api } from '../../../../lib/api';

type State = { kind: 'working' } | { kind: 'ok'; login: string } | { kind: 'error'; message: string };

/**
 * OAuth landing page. GitHub redirects the browser here with ?code&state; the
 * server consumes the state and attaches the proven GitHub identity to the
 * session cookie. The credential itself never touches this page.
 */
export default function GithubCallbackPage() {
  const [state, setState] = useState<State>({ kind: 'working' });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const oauthState = params.get('state');
    if (!code || !oauthState) {
      setState({ kind: 'error', message: 'Missing code or state in the callback URL.' });
      return;
    }
    fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/auth/github/callback?code=${encodeURIComponent(
        code
      )}&state=${encodeURIComponent(oauthState)}`,
      { credentials: 'include' }
    )
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) setState({ kind: 'error', message: body.message ?? body.error ?? 'Authorization failed.' });
        else setState({ kind: 'ok', login: body.login });
      })
      .catch((err) => setState({ kind: 'error', message: err instanceof Error ? err.message : String(err) }));
  }, []);

  return (
    <div className="flex flex-col min-h-screen">
      <GlobalHeader />
      <main className="flex-1 w-full max-w-2xl mx-auto px-6 py-20">
        <div className="p-8 bg-surface-card border border-border-subtle rounded-xl shadow-soft-card text-center">
          {state.kind === 'working' && (
            <>
              <div className="w-6 h-6 rounded-full border-2 border-border-strong border-t-primary-container animate-spin mx-auto" />
              <h1 className="font-headline-lg text-xl text-text-primary mt-4">Verifying GitHub authorization…</h1>
              <p className="font-body-md text-text-secondary mt-2">Exchanging the code and attaching the identity to your session.</p>
            </>
          )}
          {state.kind === 'ok' && (
            <>
              <h1 className="font-headline-lg text-xl text-text-primary mt-2">GitHub connected</h1>
              <p className="font-body-md text-text-secondary mt-2">
                Authorized as <span className="text-badge-green-text font-mono">@{state.login}</span>. You can now bind
                this account to your wallet and receive credentials.
              </p>
              <Link
                href="/verify"
                className="inline-flex items-center mt-5 px-4 py-2 rounded-lg bg-primary-container hover:bg-tertiary text-white text-xs font-semibold font-mono transition-colors"
              >
                BACK TO VERIFICATION →
              </Link>
            </>
          )}
          {state.kind === 'error' && (
            <>
              <h1 className="font-headline-lg text-xl text-text-primary mt-2">Authorization failed</h1>
              <p className="font-body-md text-error mt-2 font-mono text-xs">{state.message}</p>
              <p className="font-body-md text-text-muted mt-3 text-xs">
                States are single-use and expire in 10 minutes — start the connection again from the verify page.
              </p>
              <Link
                href="/verify"
                className="inline-flex items-center mt-5 px-4 py-2 rounded-lg bg-surface-container border border-border-subtle text-text-primary text-xs font-semibold font-mono transition-colors"
              >
                RETRY
              </Link>
            </>
          )}
        </div>
      </main>
      <GlobalFooter />
    </div>
  );
}
