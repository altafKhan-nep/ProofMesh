import type { EvidenceItem } from '@proofmesh/shared-types';

/**
 * LLM reviewer + skeptic passes.
 *
 * CONTRACT (ARCHITECTURE.md §5, steps 5–6): these passes may only *lower*
 * confidence or *block* issuance. They can never raise a score. The pipeline
 * enforces that structurally — this module only proposes.
 *
 * The provider is Google Gemini. `LLM_PROVIDER` and `LLM_API_KEY` are read
 * lazily so tests and the deterministic-only demo mode work without any key.
 */

const PROVIDER = (process.env.LLM_PROVIDER ?? 'gemini').toLowerCase();
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 8_000);

/** True when a key for the configured provider is present. */
export function llmConfigured(): boolean {
  return Boolean(process.env.LLM_API_KEY ?? process.env.GEMINI_API_KEY);
}

/** Provider key, resolved at call time (not module load) so .env ordering is safe. */
function apiKey(): string | undefined {
  return process.env.LLM_API_KEY ?? process.env.GEMINI_API_KEY;
}

export interface LlmResult {
  text: string;
  /** True when the caller fell back to the deterministic implementation. */
  fellBack: boolean;
}

/**
 * Single completion call. Returns `fellBack: true` on any failure — a missing
 * key, a 429, a timeout, a non-JSON reply. Callers must treat that as
 * "deterministic mode", never as a silent partial result.
 */
export async function llmComplete(prompt: string): Promise<LlmResult> {
  const key = apiKey();
  if (!key) return { text: '', fellBack: true };

  if (PROVIDER !== 'gemini') {
    // Only Gemini is wired. Be explicit rather than pretending.
    return { text: '', fellBack: true };
  }

  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      // Key in a header, not the query string: query strings are logged by
      // proxies and appear in access logs.
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: 'application/json' }
      })
    });
    if (!res.ok) return { text: '', fellBack: true };
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return text ? { text, fellBack: false } : { text: '', fellBack: true };
  } catch {
    return { text: '', fellBack: true };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract the outermost JSON object from a model reply.
 *
 * The previous implementation ran `text.replace(/```json|```/g, '')`, which
 * strips every fence occurrence *anywhere* — including inside string values —
 * and then threw away the reply entirely on any parse error. Extracting the
 * outermost `{…}` tolerates the usual prose wrapper without corrupting values.
 */
export function extractJson(text: string): unknown | null {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Reviewer pass: one-paragraph explanation citing real evidence. */
export async function reviewWithLlm(
  evidence: EvidenceItem[],
  score: { shownScore: number; confidence: number; rawScore: number }
): Promise<{ excerpt: string } | undefined> {
  const top = evidence
    .filter((e) => e.positive)
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 5)
    .map((e) => `- ${e.type}: ${e.description}`);
  const prompt = [
    'You are a reviewer for a deterministic developer-credential engine.',
    `The engine produced shown score ${score.shownScore.toFixed(1)} and confidence ${(score.confidence * 100).toFixed(1)}%.`,
    'Explain in 1-2 sentences WHY, citing at most 3 evidence types below.',
    'Never invent evidence, never claim a human wrote the text, never suggest a higher score.',
    '',
    'Evidence:',
    ...top,
    '',
    'Return JSON: {"excerpt": "..."}'
  ].join('\n');

  const { text, fellBack } = await llmComplete(prompt);
  if (fellBack) return undefined;
  const parsed = extractJson(text) as { excerpt?: unknown } | null;
  if (!parsed || typeof parsed.excerpt !== 'string' || !parsed.excerpt.trim()) return undefined;
  return { excerpt: parsed.excerpt.trim() };
}

export interface SkepticAssessment {
  notes: string[];
  reduction: number;
  blocks: boolean;
}

/**
 * Skeptic pass: falsification only.
 *
 * The previous version used `Boolean(parsed.blocks)`, and `Boolean("false")`
 * is `true` — so the extremely common model output `{"blocks":"false"}` hard
 * blocked issuance of a fully qualifying credential, with no log and no audit
 * trail. Accept only real booleans (and the explicit strings).
 */
export async function skepticWithLlm(
  repos: { isFork: boolean; primaryLanguage: string | null }[],
  evidence: EvidenceItem[]
): Promise<SkepticAssessment | undefined> {
  const repoSummary = repos.map((r) => `${r.primaryLanguage ?? 'unknown'}${r.isFork ? ' (fork)' : ''}`).join(', ');
  const evidenceTypes = [...new Set(evidence.map((e) => e.type))].join(', ');
  const prompt = [
    'You are a SKEPTIC reviewing a developer credential.',
    'Flag only concrete, evidence-based concerns. You may NOT raise any score.',
    'Return JSON: {"notes": ["..."], "reduction": 0.0, "blocks": false}',
    '  reduction: number 0..0.25 (how much to subtract from confidence)',
    '  blocks: boolean (true ONLY for an outright disqualifying concern)',
    '',
    `Repos: ${repoSummary}`,
    `Evidence types: ${evidenceTypes}`
  ].join('\n');

  const { text, fellBack } = await llmComplete(prompt);
  if (fellBack) return undefined;
  const parsed = extractJson(text) as { notes?: unknown; reduction?: unknown; blocks?: unknown } | null;
  if (!parsed) return undefined;

  const notes = Array.isArray(parsed.notes)
    ? parsed.notes.filter((n): n is string => typeof n === 'string').slice(0, 8)
    : [];

  const rawReduction = typeof parsed.reduction === 'number' ? parsed.reduction : Number.NaN;
  // NaN must not survive: `Math.max(0, NaN)` is NaN, `NaN > 0` is false, and the
  // skeptic's stated purpose was then silently skipped.
  const reduction = Number.isFinite(rawReduction)
    ? Math.min(0.25, Math.max(0, rawReduction))
    : 0;

  const blocks = parsed.blocks === true || parsed.blocks === 'true';

  return { notes, reduction, blocks };
}