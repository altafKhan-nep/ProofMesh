# ProofMesh

Deterministic developer verification engine issued as Solana credentials.

ProofMesh empirically evaluates GitHub evidence  signed commits, merged PRs, peer review, repository entropy,
test survival, and negative-test discipline ; to issue an **unforgeable skill credential anchored on Solana**.
Everything is deterministic and reproducible: the same snapshot always produces the same score, confidence, and level,
with **honest abstention** when the skeptic pass cannot falsify enough risk away. LLM passes are optional and can only
lower confidence or block a credential ; never raise it.

## Source of truth

| Concern | Canonical source |
| --- | --- |
| UI look, colors, type, components | `docs/stitch_proofmesh_design_system_components/` (Stitch export, read-only) |
| Product & technical behavior | `docs/ARCHITECTURE.md` |
| Product tone & positioning | `docs/Proof_of_Work_Hackathon_Strategy_Memo.md` |

## Stack

- **Web** — `apps/web` (Next.js 15 App Router, Tailwind v4, client `/verify/[wallet]/[skill]` report + SSE verify flow)
- **API** — `apps/api` (Fastify, in-memory store + seed data, REST + SSE pipeline stream, SVG badge endpoints)
- **Scoring engine** — `packages/scoring-engine` (calibrated E/confidence model, percentile dims, eligibility, levels)
- **Verifier SDK** — `packages/verifier-sdk` (off-chain attestation validation mirroring the on-chain SAS records)
- **Shared types** — `packages/shared-types` (evidence, scores, credentials, jobs, SKILLS, CALIBRATION)

## Quickstart

```bash
pnpm install
pnpm dev              # web on :3000 + api on :4000 (parallel)
```

- Landing / spec: http://localhost:3000
- Verify flow (SSE pipeline): http://localhost:3000/verify
- Public report: `http://localhost:3000/verify/<wallet>/<skill>`
- Style guide: http://localhost:3000/dev/components
- Sponsor console: http://localhost:3000/sponsors
- API: http://localhost:4000/health

```bash
pnpm test             # 24 unit tests (scoring-engine + verifier-sdk)
pnpm typecheck        # strict TS across all packages
pnpm seed             # re-seed the API store
```

## API surface

`GET /health` · `GET /api/developers[/:handle]` · `GET/POST/DELETE /api/listings` · `POST /api/analyze` ·
`GET /api/analyze/:id` · `GET /api/analyze/:id/stream` (SSE) · `GET /api/evidence/:handle` ·
`GET /api/verify/:wallet/:skill` · `GET /api/badge/:wallet/:skill.svg` · `POST /api/search` · `POST /api/invite` ·
`POST /api/listings/:id/verified-link` · `POST /api/reset`

## Live GitHub ingestion (real-world data)

`POST /api/analyze` accepts any public GitHub username, not just seeded developers. If the handle isn't in the store it
is synced over the public GitHub REST API (`apps/api/src/github.ts`) — profile, owned repos, commit/release counts, and
the public event feed — and the evidence is synthesized **only from signals the public API can actually attest**
(activity months, real merged PRs, releases). Anything unverifiable (tests, CI forensics, signed-commit ratios) stays
absent rather than being invented; the skeptic pass still applies.

A synced user has no bound Solana wallet, so even a qualifying score does **not** mint a credential — the pipeline
honestly abstains with *"Evidence qualifies, but no Solana wallet is bound."* This enforces the wallet-binding step
that on-chain attestations require.

Unauthenticated GitHub is rate-limited (60 req/hr, one sync ≈ 15 calls, cached in `store.metadata`). Set
`GITHUB_TOKEN` (any fine-grained PAT with public read) in the environment when pulling many users:
`GITHUB_TOKEN=… pnpm dev --filter @proofmesh/api`.

## Pipeline (7 deterministic stages)

`INGESTION → STATIC_ANALYSIS → OUTCOME_ANALYSIS → SCORING → REVIEWER_PASS → SKEPTIC_PASS → CREDENTIAL_CHECK`
Skeptic pass and reviewer pass emit their own evidence-linked reasoning; a credential is minted only when the skeptic
does not block, eligibility passes, and final confidence ≥ 0.6.

## Seeded developers (devnet, deterministic)

| Handle | Skill | Shown | Confidence | Level |
| --- | --- | --- | --- | --- |
| `alexander-vance` | solana-anchor | 94.11 | 0.9912 | 3 · Expert |
| `devraj-patel` | solana-anchor | 79.67 | 0.7913 | 2 · Strong |
| `maria-chen` | typescript | — | abstain | no credential |

Wallet for the demo reporting page: `7xGqYtRZLJ4XZiQn69NCHsWkY1mTVMLqmLX4m3md8DwzF3`.# ProofMesh
