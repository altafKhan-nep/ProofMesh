# ProofMesh — Full Build Brief for opencode (Frontend + Backend)

One thing first: I don't actually have your Google Stitch design export in this conversation — only the original strategy memo was uploaded here. This file is written so it works the moment you drop that export into the repo at the path referenced below; it doesn't need me to have seen it.

---

## 0. How to use this with opencode

1. Put these files in your repo root before starting a session:
   - `BUILD_PROMPT.md` (this file)
   - `ARCHITECTURE.md`
   - `Proof_of_Work_Hackathon_Strategy_Memo.md` (optional — copy/tone reference)
   - Your Stitch export, in `/design/stitch-export/` (whatever Stitch gave you — HTML, React, or Figma-exported code)
2. Start opencode in the repo, and use **§10 below as your literal first message**.
3. Work **phase by phase** (§5) — even with a strong model, ask it to complete and show you one phase before moving to the next. Full-context-dump-then-build-everything produces the same kind of drift you saw with Stitch, just at a bigger scale.
4. Re-paste the relevant phase section from §5 at the start of each new phase so it stays anchored to the spec instead of drifting from its own earlier assumptions.

---

## 1. What you're building

ProofMesh: a product that runs a developer's GitHub history through a deterministic evidence pipeline and issues a skill credential on Solana carrying a score and a confidence number. Full product/technical spec: `ARCHITECTURE.md`. Full frontend visual spec: your Stitch export in `/design/stitch-export/`.

## 2. Source-of-truth hierarchy (tell the agent this explicitly — it prevents the most common drift)

| For... | Source of truth | Rule |
|---|---|---|
| Colors, type, spacing, component look | `/design/stitch-export/` | Implement pixel-faithful. Don't redesign, "improve," or restyle anything from the export. |
| Data model, APIs, scoring formulas, pipeline stages | `ARCHITECTURE.md` | Follow exactly — these are calibrated decisions, not suggestions. |
| Copy, tone, product framing | The strategy memo + Stitch export copy | Reuse what's already written rather than inventing new marketing copy. |
| Anything the Stitch export doesn't cover (loading states, error states, empty states) | Extrapolate using the same design tokens from the export | Never invent a new visual style for a gap — match what's already there. |

## 3. Tech stack (do not substitute — pulled directly from `ARCHITECTURE.md`)

- Frontend: Next.js (App Router) + TypeScript, `@solana/wallet-adapter`, Sign-In With Solana
- API: Node.js + Fastify (REST + SSE)
- Queue: Redis + BullMQ
- DB: PostgreSQL via Prisma or Drizzle
- GitHub: GitHub App (read-only) + Octokit
- Static analysis: sandboxed, network-disabled Docker containers
- Scoring engine: pure TypeScript, deterministic, no LLM in the scoring path
- LLM passes (reviewer + skeptic): Anthropic API, structured JSON output
- Credential issuance: Solana Attestation Service (SAS), isolated signer process
- On-chain gate program: Anchor (Rust)
- Verifier SDK: TypeScript, RPC-only
- MCP server: read-only tools per `ARCHITECTURE.md` §10.3

## 4. Repo structure to scaffold

```
proofmesh/
├── apps/
│   ├── web/                # Next.js frontend — built from /design/stitch-export/
│   └── api/                 # Fastify API server
├── workers/
│   ├── ingestion/
│   ├── static-analysis/
│   ├── outcome-analysis/
│   └── credential-service/
├── packages/
│   ├── scoring-engine/
│   ├── verifier-sdk/
│   └── shared-types/
├── programs/
│   └── proofmesh-gate/       # Anchor program
├── mcp-server/
├── design/
│   └── stitch-export/         # your Stitch output goes here, source of truth for UI
├── scripts/
└── ARCHITECTURE.md
```

## 5. Build phases

Work through these in order. Each phase has a goal, scope, and a definition of done — don't start the next phase until the current one's DoD is met.

### Phase 0 — Scaffold
**Goal:** working monorepo skeleton, nothing functional yet.
- Set up the repo structure in §4 (use a tool of your choice — Turborepo, pnpm workspaces, or plain npm workspaces).
- Next.js app boots with a placeholder page. Fastify API boots and responds on `/health`.
- CI: GitHub Actions running lint + typecheck on push.
**DoD:** `npm run dev` (or equivalent) starts both frontend and API locally with no errors.

### Phase 1 — Design system integration
**Goal:** the Stitch export becomes a real, reusable component library inside `apps/web`.
- Read everything in `/design/stitch-export/`. Extract the design tokens (colors, spacing, type scale, radii) into a single source (Tailwind config, or a `tokens.ts` file — match whatever the export's format suggests).
- Convert each distinct screen/section from the export into a real Next.js component under `apps/web/components/`, preserving exact visual output — same colors, same spacing, same type.
- Build a small internal style-guide page (`/dev/components`) that renders every converted component in isolation, so drift is easy to catch visually as you go.
**DoD:** every screen in the Stitch export has a matching real Next.js component that looks identical to the export, and the style-guide page renders all of them.

### Phase 2 — Backend foundation
**Goal:** the API and DB exist and are wired together, no business logic yet.
- Set up Postgres schema per `ARCHITECTURE.md` §7.1 (developers, wallet_bindings, repos_snapshot, evidence_items, scores, credentials, sponsors/listings/invites).
- Set up Redis + BullMQ with an empty test job to confirm the queue works end to end.
- Set up the GitHub App (read-only) and confirm an install + webhook round-trip.
- Set up SIWS wallet connect on the frontend, wired to a real session on the API.
**DoD:** a developer can install the GitHub App and connect a wallet, and both are recorded as a linked `wallet_bindings` row in Postgres.

### Phase 3 — Evidence pipeline (the deterministic core)
**Goal:** the actual analysis pipeline from `ARCHITECTURE.md` §5, end to end, without the LLM passes yet.
- Ingestion worker: pulls repo/commit/PR/review/Checks data, snapshots it, hashes it into `evidence_root`.
- Static analysis worker: sandboxed linters/scanners, no network access.
- Outcome analysis worker: external-merge detection, review/code survival, reverts.
- Scoring engine (`packages/scoring-engine`): pure functions implementing the formula in `ARCHITECTURE.md` §6 exactly — evidence units → confidence → shrunk score. Unit-test this package directly; it's the one piece that must be reproducible and auditable.
**DoD:** running the pipeline against a real public repo produces a `scores` row with a raw score, a confidence number, and a full `evidence_items` trail — reproducibly, on a second run against the same commit SHA.

### Phase 4 — Get Verified flow (frontend wired to backend)
**Goal:** the full onboarding flow from the Stitch export, live.
- Wire the GitHub connect + wallet connect screens (Phase 1 components) to the Phase 2 auth flow.
- Wire the "checking your work" progress screen to real job status via the SSE endpoint (`/analyze/:id/stream`), driven by the Phase 3 pipeline's actual stages — not a fake timer.
- Wire the result screen to real score/confidence output, including the honest "not enough evidence" state when the eligibility check in `ARCHITECTURE.md` §6 fails.
**DoD:** a real GitHub account can go through the full flow and see its real score and confidence, matching the Stitch design pixel-for-pixel.

### Phase 5 — LLM passes
**Goal:** reviewer + skeptic passes from `ARCHITECTURE.md` §5, steps 5–6.
- Reviewer pass: structured JSON output citing specific evidence IDs.
- Skeptic pass: can only lower confidence or block issuance, never raise the score — enforce this in code, not just in the prompt.
- Feature-flag an LLM-off mode that falls back to deterministic-only scoring, for demo safety.
**DoD:** the evidence report page shows the reviewer's explanation, and toggling the LLM-off flag still produces a valid (if less-explained) result.

### Phase 6 — Credential issuance (Solana)
**Goal:** real SAS credentials on devnet.
- Isolated credential-service process, separate from the analysis workers, holding the signer key.
- Eligibility check (§6) gates issuance.
- SAS schema per `ARCHITECTURE.md` §7.2.
**DoD:** a qualifying developer gets a real devnet SAS attestation, and the evidence report page shows a working "view on-chain" link.

### Phase 7 — Public verify page + badge
**Goal:** the shareable, no-login verify experience.
- Public `/verify/:wallet/:skill` route reading directly from the credential + evidence data.
- Embeddable SVG badge endpoint.
**DoD:** the verify page and badge match the Stitch export, and both work for a URL with no prior session/cookies.

### Phase 8 — Verifier SDK
**Goal:** the open, backend-independent TypeScript package from `ARCHITECTURE.md` §9.
- `verify(wallet, skill, {minScore, minConfidence, issuerAllowlist})`, RPC-only, no call to your API.
**DoD:** the SDK correctly returns valid/invalid against a real devnet attestation, callable from a fresh script with only an RPC URL and no other config.

### Phase 9 — Sponsor console
**Goal:** the search/filter/invite flow from the Stitch export, live.
- Search + filter API (`/search`), wired to real credential data.
- Invite flow (`/invite`), verified-applicant link generation.
**DoD:** a sponsor can search, filter, and generate a verified-applicant link, matching the Stitch design.

### Phase 10 — MCP server
**Goal:** the 5 read-only tools from `ARCHITECTURE.md` §10.3.
**DoD:** each tool callable from an MCP client and returning correct data against the real DB.

### Phase 11 — On-chain gate program (stretch, if time allows)
**Goal:** the Anchor program from `ARCHITECTURE.md` §9 — `claim_verified(bounty)`.
**DoD:** the instruction succeeds for a verified wallet and fails for an unverified one, on devnet, demoable live.

### Phase 12 — Polish + validation
- Accessibility pass (contrast, tap targets, keyboard nav) against whichever Stitch version you built from (simple/v2 tokens for the app screens).
- Run the validation back-test from `ARCHITECTURE.md` §13 (n ≥ 30 real repos) and sanity-check the scoring constants against it.
- Confirm the deterministic-only fallback mode actually works live, as your demo safety net.

## 6. Non-negotiables

Regardless of how much of §5 you get through before the deadline, never cut: the confidence number and the honest abstention state, the public verify page, the verifier SDK, and running the pipeline against real repos (not fixture data) at least once end to end.

## 7. Environment / secrets

```
GITHUB_APP_ID=
GITHUB_APP_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=
DATABASE_URL=
REDIS_URL=
SOLANA_RPC_URL=
SAS_CREDENTIAL_AUTHORITY_KEYPAIR=
ANTHROPIC_API_KEY=
OBJECT_STORAGE_BUCKET=
OBJECT_STORAGE_ACCESS_KEY=
ISSUER_ALLOWLIST=
```

## 8. When the Stitch export and this spec disagree

- Visual disagreement (a color, a spacing value, a component shape) → the Stitch export wins, always.
- Functional disagreement (what a button does, what data a screen needs) → `ARCHITECTURE.md` wins, always.
- If the export is missing a screen or state entirely → build it using the export's existing tokens, and flag it back to me/the user rather than guessing at new branding.

---

## 10. Paste this as your first message to opencode

```
Read BUILD_PROMPT.md, ARCHITECTURE.md, and every file in /design/stitch-export/
in this repo before writing any code. BUILD_PROMPT.md's §2 source-of-truth
hierarchy governs any conflict between the design export and the architecture
doc. We're going to work through BUILD_PROMPT.md §5 one phase at a time,
starting with Phase 0. For each phase: implement it, tell me what you built
and where, and stop for my review before moving to the next phase. Don't
skip ahead, and don't restyle or "improve" anything in the Stitch export —
implement it pixel-faithful. Start with Phase 0 now.
```
