/**
 * Env bootstrap — load a gitignored local `.env` (secrets such as
 * GITHUB_TOKEN) so they survive restarts without being committed. Values
 * already present in the environment always win (loadEnvFile never overrides).
 *
 * Must be imported BEFORE any module that reads env at import time (e.g.
 * github.ts builds its auth headers from process.env.GITHUB_TOKEN on load).
 */
try {
  process.loadEnvFile();
} catch {
  // no .env present — secrets must be supplied externally.
}