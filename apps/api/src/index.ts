import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { Store } from './store.js';
import { sessionStoreFromEnv } from './session-store.js';
import { registerRoutes } from './routes.js';
import { hydrateSeededRuns } from './hydrate.js';
import { adminWalletsFromEnv, CSRF_HEADER } from './auth.js';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main(): Promise<void> {
  const store = new Store({ sessionStore: sessionStoreFromEnv() });
  const app = Fastify({ logger: true });

  // Cookies carry the session (httpOnly). `origin: true` reflects the caller's
  // origin rather than '*', which is required for credentialed CORS; combined
  // with SameSite=Lax + the double-submit CSRF header, cross-site abuse is out.
  await app.register(cors, {
    origin: true,
    credentials: true,
    allowedHeaders: ['content-type', 'authorization', CSRF_HEADER, 'x-pm-action-nonce', 'x-pm-action-signature'],
    exposedHeaders: ['set-cookie']
  });
  // Cookie parsing/serialisation for the httpOnly session cookie.
  await app.register(cookie);

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => {
    try {
      done(null, body && String(body).length > 0 ? JSON.parse(String(body)) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  await registerRoutes(app, {
    store,
    adminWallets: adminWalletsFromEnv(),
    githubOAuth: process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET
      ? {
          clientId: process.env.GITHUB_CLIENT_ID,
          clientSecret: process.env.GITHUB_CLIENT_SECRET,
          redirectUri:
            process.env.GITHUB_OAUTH_REDIRECT ??
            `${process.env.PUBLIC_API_URL ?? 'http://localhost:4000'}/api/auth/github/callback`,
          // Endpoint overrides support GitHub Enterprise (and local test doubles).
          ...(process.env.GITHUB_OAUTH_AUTHORIZE_URL ||
          process.env.GITHUB_OAUTH_TOKEN_URL ||
          process.env.GITHUB_API_USER_URL
            ? {
                endpoints: {
                  ...(process.env.GITHUB_OAUTH_AUTHORIZE_URL
                    ? { authorize: process.env.GITHUB_OAUTH_AUTHORIZE_URL }
                    : {}),
                  ...(process.env.GITHUB_OAUTH_TOKEN_URL
                    ? { token: process.env.GITHUB_OAUTH_TOKEN_URL }
                    : {}),
                  ...(process.env.GITHUB_API_USER_URL ? { user: process.env.GITHUB_API_USER_URL } : {})
                }
              }
            : {})
        }
      : undefined
  });

  // Hydrate seeded developers with real (deterministic) score + credential
  // records so the public verify page, badges and sponsor console are live
  // on first boot — same code path a fresh analysis takes, zero delays.
  await hydrateSeededRuns(store);

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`ProofMesh API listening on http://${HOST}:${PORT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});