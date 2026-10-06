/**
 * CORS origin allowlist. Never `true`/`*` with credentials: the session cookie
 * must only be readable by the API's own web origins and declared mirrors.
 */
export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const fromEnv = (env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const apiUrl = env.PUBLIC_API_URL;
  const set = new Set<string>(fromEnv);
  if (apiUrl) {
    try {
      set.add(new URL(apiUrl).origin);
    } catch {
      /* ignore invalid PUBLIC_API_URL for CORS */
    }
  }
  return [...set];
}

export function originAllowed(origin: string | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (!origin) return true;
  return allowedOrigins(env).includes(origin);
}