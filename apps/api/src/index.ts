import Fastify from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import { Store } from './store.js';
import { registerRoutes } from './routes.js';
import { hydrateSeededRuns } from './hydrate.js';
import { adminWalletsFromEnv, CSRF_HEADER } from './auth.js';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';

async function main(): Promise<void> {
  const store = new Store();
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

  await registerRoutes(app, { store, adminWallets: adminWalletsFromEnv() });

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