import './env.js';
import Fastify from 'fastify';
import cors, { type OriginFunction } from '@fastify/cors';
import cookie from '@fastify/cookie';
import { Store } from './store.js';
import { initDb, loadSnapshot, startPersistenceLoop } from './persistence.js';
import { startAnalysisQueue, stopAnalysisQueue, queueMode } from './queue.js';
import { sessionStoreFromEnv } from './session-store.js';
import { registerRoutes } from './routes.js';
import { hydrateSeededRuns } from './hydrate.js';
import { adminWalletsFromEnv, CSRF_HEADER } from './auth.js';
import { RateLimiter, rateLimitsFromEnv } from './rate-limit.js';
import { allowedOrigins, originAllowed } from './cors.js';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main(): Promise<void> {
  const store = new Store({ sessionStore: sessionStoreFromEnv(), seed: false });
  await initDb();
  await loadSnapshot(store);
  startPersistenceLoop(store);
  const app = Fastify({ logger: true });
  const rules = rateLimitsFromEnv();
  const limiter = new RateLimiter(rules);

  // CORS is allowlisted (never `origin: true`), so the session cookie is only
  // ever readable by this API, its declared web origins, and magic-signed
  // requests carrying the double-submit CSRF header.
  const originPolicy: OriginFunction = (origin, cb) => cb(null, originAllowed(origin));
  await app.register(cors, {
    origin: originPolicy,
    credentials: true,
    allowedHeaders: ['content-type', 'authorization', CSRF_HEADER, 'x-pm-action-nonce', 'x-pm-action-signature'],
    exposedHeaders: ['set-cookie']
  });
  // Cookie parsing/serialisation for the httpOnly session cookie.
  await app.register(cookie);

  // Baseline security headers (@fastify/helmet is not worth the dependency).
  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Permitted-Cross-Domain-Policies', 'none');
    return payload;
  });

  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    try {
      (req as unknown as { rawBody?: string }).rawBody = String(body ?? '');
      done(null, body && String(body).length > 0 ? JSON.parse(String(body)) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  await registerRoutes(app, {
    store,
    rateLimits: rules,
    limiter,
    adminWallets: adminWalletsFromEnv(),
    githubOAuth: (process.env.GITHUB_APP_CLIENT_ID && process.env.GITHUB_APP_CLIENT_SECRET)
      ? {
          clientId: process.env.GITHUB_APP_CLIENT_ID,
          clientSecret: process.env.GITHUB_APP_CLIENT_SECRET,
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

  // Started AFTER listen(): Redis problems must degrade the queue, never
  // prevent the API from serving.
  void startAnalysisQueue(store)
    .then(() => {
      const q = queueMode();
      app.log.info(`analysis queue: ${q.mode}${q.reason ? ` (${q.reason})` : ''}`);
    })
    .catch((err: unknown) => {
      app.log.error(`analysis queue failed to start: ${err instanceof Error ? err.message : String(err)}`);
    });

  // Drop expired rate-limit buckets so a long-lived process does not leak memory.
  const sweepTimer = setInterval(() => limiter.sweep(), 60_000);
  sweepTimer.unref();

  // Graceful shutdown: close the queue so in-flight jobs are not abandoned,
  // and flush the final Postgres snapshot.
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} received — shutting down`);
    clearInterval(sweepTimer);
    try {
      await stopAnalysisQueue();
      await app.close();
    } catch (err) {
      app.log.error(`shutdown error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      process.exit(0);
    }
  };
  for (const sig of ['SIGTERM', 'SIGINT'] as const) {
    process.on(sig, () => void shutdown(sig));
  }

  // A rejected promise with no handler kills the process by default. Log it and
  // keep serving: one bad request must not take the whole API down.
  process.on('unhandledRejection', (reason) => {
    app.log.error(`unhandled rejection: ${reason instanceof Error ? reason.stack ?? reason.message : String(reason)}`);
  });
  process.on('uncaughtException', (err) => {
    app.log.error(`uncaught exception: ${err.stack ?? err.message}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});