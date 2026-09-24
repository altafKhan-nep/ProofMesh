/**
 * Session storage.
 *
 * Two deliberate properties:
 *
 * 1. **Hashed index.** Sessions are indexed by `sha256(token)`; the raw token is
 *    never stored. A leaked store (backup, log, file) therefore contains no
 *    usable credential — presenting a cookie still requires the real token,
 *    which only exists in the browser's httpOnly jar. sha256 of a 256-bit random
 *    token is not invertible, and the hash itself cannot be replayed because look
 *    ups hash the *presented* token. This is defence in depth behind the cookie,
 *    not a replacement for it.
 *
 * 2. **Pluggable backend.** `InMemorySessionStore` is the default (tests, dev,
 *    ephemeral deploys). `FileSessionStore` persists across restarts for local
 *    work. Postgres/Redis drops in behind the same interface.
 *
 * Expiry (absolute + sliding idle) is enforced on read and by an explicit sweep,
 * so an expired session is never handed out.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { AuthSession } from '@proofmesh/shared-types';
import { SESSION_IDLE_TTL_MS } from './auth.js';

export const sessionKey = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export interface SessionStore {
  create(session: AuthSession): Promise<void>;
  /** Returns the session only if present and unexpired; refreshes the idle window. */
  get(token: string): Promise<AuthSession | undefined>;
  /** Revoke by the token the client presented. */
  revoke(token: string): Promise<boolean>;
  revokeAllForWallet(wallet: string): Promise<number>;
  sweep(): Promise<number>;
  size(): Promise<number>;
  clear(): Promise<void>;
}

function isLive(session: AuthSession, now: number): boolean {
  if (new Date(session.expiresAt).getTime() < now) return false;
  const last = new Date(session.lastSeenAt ?? session.issuedAt).getTime();
  return now - last <= SESSION_IDLE_TTL_MS;
}

/** What we persist: the hashed index plus non-secret session fields. No token. */
interface PersistedSession {
  key: string;
  wallet: string;
  role: AuthSession['role'];
  issuedAt: string;
  expiresAt: string;
  lastSeenAt: string;
  csrfToken?: string;
  tokenHint?: string;
  /** GitHub identity proven via OAuth on this session, if any. */
  githubLogin?: string;
}

export class InMemorySessionStore implements SessionStore {
  protected sessions = new Map<string, AuthSession>();

  async create(session: AuthSession): Promise<void> {
    this.sessions.set(sessionKey(session.token), { ...session });
  }

  async get(token: string): Promise<AuthSession | undefined> {
    const key = sessionKey(token);
    const session = this.sessions.get(key);
    if (!session) return undefined;
    const now = Date.now();
    if (!isLive(session, now)) {
      this.sessions.delete(key);
      return undefined;
    }
    session.lastSeenAt = new Date(now).toISOString();
    return session;
  }

  async revoke(token: string): Promise<boolean> {
    return this.sessions.delete(sessionKey(token));
  }

  async revokeAllForWallet(wallet: string): Promise<number> {
    let n = 0;
    for (const [key, session] of this.sessions) {
      if (session.wallet === wallet) {
        this.sessions.delete(key);
        n += 1;
      }
    }
    return n;
  }

  async sweep(): Promise<number> {
    const now = Date.now();
    let removed = 0;
    for (const [key, session] of this.sessions) {
      if (!isLive(session, now)) {
        this.sessions.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  async size(): Promise<number> {
    return this.sessions.size;
  }

  async clear(): Promise<void> {
    this.sessions.clear();
  }

  /** Serializable projection — hashed index, never the token. */
  protected snapshot(): PersistedSession[] {
    return [...this.sessions.entries()].map(([key, s]) => ({
      key,
      wallet: s.wallet,
      role: s.role,
      issuedAt: s.issuedAt,
      expiresAt: s.expiresAt,
      lastSeenAt: s.lastSeenAt ?? s.issuedAt,
      ...(s.csrfToken ? { csrfToken: s.csrfToken } : {}),
      ...(s.tokenHint ? { tokenHint: s.tokenHint } : {}),
      ...(s.githubLogin ? { githubLogin: s.githubLogin } : {})
    }));
  }
}

/**
 * File-backed store so a local restart does not sign everyone out. Atomic writes
 * (tmp + rename), serialised to avoid concurrent corruption, best-effort: if the
 * file is unwritable the in-memory state stays authoritative.
 *
 * The file holds hashed indices and session metadata, not credentials. It is
 * still sensitive — keep it out of version control (default under .secrets/,
 * which is git-ignored).
 */
export class FileSessionStore extends InMemorySessionStore {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    super();
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as PersistedSession[];
      const now = Date.now();
      for (const record of parsed) {
        // Restored sessions have no token: they are addressable only by the
        // client that still holds the matching cookie.
        const session: AuthSession = {
          token: '',
          wallet: record.wallet,
          role: record.role,
          issuedAt: record.issuedAt,
          expiresAt: record.expiresAt,
          lastSeenAt: record.lastSeenAt,
          ...(record.csrfToken ? { csrfToken: record.csrfToken } : {}),
          ...(record.tokenHint ? { tokenHint: record.tokenHint } : {}),
          ...(record.githubLogin ? { githubLogin: record.githubLogin } : {})
        };
        if (isLive(session, now)) this.sessions.set(record.key, session);
      }
    } catch {
      /* corrupt or unreadable store: start empty rather than crash */
    }
  }

  private persist(): void {
    this.writeChain = this.writeChain.then(() => {
      try {
        fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
        const tmp = `${this.filePath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(this.snapshot(), null, 2));
        fs.renameSync(tmp, this.filePath);
      } catch {
        /* best-effort */
      }
    });
  }

  override async create(session: AuthSession): Promise<void> {
    await super.create(session);
    this.persist();
  }

  override async revoke(token: string): Promise<boolean> {
    const removed = await super.revoke(token);
    if (removed) this.persist();
    return removed;
  }

  override async revokeAllForWallet(wallet: string): Promise<number> {
    const n = await super.revokeAllForWallet(wallet);
    if (n > 0) this.persist();
    return n;
  }

  override async clear(): Promise<void> {
    await super.clear();
    this.persist();
  }
}

/** Build the store from env: SESSION_STORE=memory|file, SESSION_FILE=<path>. */
export function sessionStoreFromEnv(env: NodeJS.ProcessEnv = process.env): SessionStore {
  if ((env.SESSION_STORE ?? 'memory').toLowerCase() === 'file') {
    return new FileSessionStore(env.SESSION_FILE ?? '.secrets/sessions.json');
  }
  return new InMemorySessionStore();
}
