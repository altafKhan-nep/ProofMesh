# ProofMesh (Proof of Work) — Product Architecture & Technical Stack

**Event:** Colosseum Crypto World's Fair · Solana track · deadline Oct 12, 2026
**Purpose of this doc:** a build-ready architecture spec — what to build, in what order, with what tech — derived from the strategy memo. Drop this into the repo as `ARCHITECTURE.md`; it's also the backbone of the submission README.

---

## 1. Product in one paragraph

AI/deterministic agents analyze a developer's GitHub history — code quality, security, architecture, testing, consistency — and issue **skill badges as Solana credentials** (via the Solana Attestation Service). Every credential carries a **score and a confidence number**, and issuance is refused when evidence is thin. Bounty sponsors, grant committees, and hackathon organizers use a **sponsor console** to invite developers by proven skill instead of résumé; an **open verifier SDK** and a small **on-chain gate program** let any wallet, program, or app check a credential without trusting a backend.

## 2. Core loop

```
Developer connects GitHub (read-only App) + Solana wallet (Sign-In With Solana)
        │
        ▼
Deterministic evidence pipeline → outcome signals + static signals   (LLM never sets the score)
        │
        ▼
Score + Confidence per skill pack   (abstain — no credential — if evidence is thin)
        │
        ▼
Solana Attestation Service (SAS) credential — wallet-bound, expiring, revocable
   + public evidence page + embeddable SVG badge + open verifier SDK
        │
        ▼
Consumers: Sponsor console (invite by proof) · MCP server (agents triage applicants)
           · On-chain gate program (claim only if verified) · Any app via SDK
        │
        ▼
Real work (bounty paid to the same wallet) → new evidence → stronger credential
```

## 3. System architecture

```
                    ┌────────────────────────────────────────────────┐
                    │  Next.js frontend (wallet adapter + SIWS)       │
                    │  - Landing / "get verified in 5 min"            │
                    │  - Evidence report + score/confidence UI        │
                    │  - Sponsor console (search, filter, invite)     │
                    │  - Public verify page + badge embed             │
                    └───────────────────────┬──────────────────────────┘
                                             │ REST + SSE
                    ┌────────────────────────▼──────────────────────────┐
                    │  API layer — Node.js / Fastify                    │
                    │  - Auth (GitHub App install, SIWS session)        │
                    │  - Job enqueue, evidence/report read endpoints    │
                    │  - Verify endpoint, badge SVG endpoint            │
                    └──────┬──────────────────────────────┬─────────────┘
                            │                              │
          GitHub App webhooks / GraphQL API      Redis + BullMQ job queue
                            │                              │
                            └──────────────┬───────────────┘
                                            ▼
     ┌───────────────┬───────────────┬─────┴────────┬───────────────┬────────────────────┐
     │  Ingestion     │  Static        │  Outcome      │  LLM passes    │  Credential service │
     │  worker        │  analysis      │  analysis     │  (A: reviewer, │  (isolated signer,  │
     │  (fetch, hash, │  (sandboxed,   │  (merges,     │   B: skeptic — │   threshold check,  │
     │   snapshot)    │   no network)  │   survival,   │   can only     │   SAS issuance)      │
     │                │                │   reverts)    │   lower conf.) │                      │
     └───────────────┴───────────────┴───────────────┴───────────────┴──────────┬──────────┘
                                            ▼                                     │
                          Postgres (evidence, scores, credentials)                │
                          + object storage for evidence/report JSON              │
                                            │                                     │
                                            ▼                                     ▼
                          Solana Attestation Service (SAS) ◄──────────────────────┘
                                            │
                  
              ▼                             ▼                             ▼
     Verifier SDK (TS, RPC-only)   MCP server (read-only tools)   On-chain gate program (Anchor)
```

## 4. Technology stack

| Layer | Technology | Why this choice |
|---|---|---|
| **Frontend** | Next.js (App Router) + TypeScript | SSR for the public verify pages/badges (must load fast and unauthenticated), React ecosystem, wallet-adapter support |
| **Wallet auth** | `@solana/wallet-adapter`, Sign-In With Solana (SIWS) | Standard Solana wallet connect + message-signing flow for identity binding |
| **API server** | Node.js + Fastify (REST + Server-Sent Events) | Lightweight, fast, SSE gives the "analysis in progress" live UI without WebSocket complexity |
| **GitHub integration** | GitHub App (read-only, installed per developer) + GraphQL/REST via Octokit | Read-only scoped access; webhooks for push/PR events; reuse CI results via the Checks API instead of re-running builds |
| **Job queue** | Redis + BullMQ | Long-running analysis jobs run off the request path; retries, concurrency limits, backoff |
| **Database** | PostgreSQL (Prisma or Drizzle ORM) | Stores evidence metadata, scores, credential records, sponsor/console data — never raw repo contents |
| **Object storage** | S3-compatible bucket (e.g., Cloudflare R2 / AWS S3) | Full evidence/report JSON and public evidence pages (only hashes + pointers go on-chain) |
| **Static analysis (sandboxed)** | Language-specific linters run in ephemeral, network-disabled containers (Docker) | rustfmt, clippy-style checks for Anchor/Rust; ESLint/Checkstyle/PMD for light packs; no arbitrary code execution on API hosts |
| **Security scanning** | `cargo audit`, `gitleaks`, `osv-scanner` (as applicable) | Dependency-vulnerability and secret-leak detection feeding the "Security" dimension |
| **Scoring engine** | Deterministic Node/TypeScript module (pure functions) | Evidence → percentile scores → weighted sum → confidence. No LLM in the scoring path — reproducible and auditable |
| **LLM passes** | Anthropic API (Claude), structured JSON output, two passes: **reviewer** (explains, cites evidence IDs) and **skeptic** (can only lower confidence / block issuance) | LLM never sets the score; system still works with LLM turned off (deterministic-only fallback mode for demo safety) |
| **Credential issuance** | Solana Attestation Service (SAS) client, isolated signer service, keys in KMS/isolated process | Separate the analysis pipeline from the signing key; a compromised worker can't mint bogus credentials |
| **On-chain program** | Anchor (Rust) — one instruction `claim_verified(bounty)` | Reads the SAS attestation PDA, checks issuer/score/confidence/expiry — the strongest "why blockchain" proof |
| **Verifier SDK** | TypeScript package, RPC-only (`@solana/web3.js`, `solana-attestation-service-client`) | `verify(wallet, skill, {minScore, minConfidence, issuerAllowlist})` runs with **no call to your backend** |
| **MCP server** | Thin read-only MCP server exposing 5 tools (see §10.3) | Lets Claude/Cursor sessions triage applicants directly; delivery mechanism, not the core pitch |
| **Badge/share assets** | Dynamic SVG endpoint (`/badge/<wallet>/<skill>.svg`) + OG image generation | Embeddable in GitHub READMEs/profiles; every badge links back to the verify page (distribution loop) |
| **Hosting (suggested)** | Frontend: Vercel · API + workers: Railway or Fly.io · Postgres: Neon or Supabase · Redis: Upstash · Solana RPC: Helius or QuickNode (devnet + mainnet) | Fast to stand up solo/duo in week 1; all have generous free/hackathon tiers |
| **CI/CD** | GitHub Actions | Lint, typecheck, test the scoring engine and SDK on every push — also doubles as "dogfood" evidence when you run the tool on your own repo |

## 5. Analysis pipeline (execution order)

1. **Ingest** — GitHub GraphQL/REST: repos, commits, PRs, reviews, releases, Checks/Actions results, signature status. Snapshot at commit SHAs; hash the full evidence set into `evidence_root`.
2. **Static analysis** — deterministic tools, sandboxed, **no network access**: parsing, lint/format conformance, dependency and secret scans.
3. **Outcome analysis** — external merges (by maintainers who don't own the account), review survival, code survival (`git blame` at 90 days), reverts/fix-up commits.
4. **Scoring engine** — pure function: evidence → per-dimension percentile scores → weighted raw score → confidence-shrunk `shown_score` (formula in §6).
5. **LLM pass A (reviewer)** — reads *selected* evidence, writes a human-readable explanation citing evidence IDs.
6. **LLM pass B (skeptic)** — tries to falsify the evidence (fork inflation, trivial diffs, generated files, tutorial clones, doc-only changes); can only **lower confidence or block issuance**, never raise the score.
7. **Credential service** — separate process; checks eligibility threshold; if it passes, requests SAS issuance from the isolated signer.

> Two deterministic LLM passes in a plain orchestrator beat a multi-agent framework for a 23-day build — and the whole pipeline still runs in **deterministic-only mode** if the LLM is down (this is also your live-demo fallback).

## 6. Scoring model

```
For each dimension d:  s_d ∈ [0,100] = percentile of the developer's signal vs. a reference corpus
raw = Σ w_d · s_d                     (weights: Quality 20, Security 25, Architecture 15, Testing 25, Consistency 15 — hypothesis, calibrate)

Evidence units E = Σ of:
   external merged PR ................ 3 each (capped by distinct repos)
   own-repo PR with independent review  2 each
   repo with tests + green CI ......... 2 each (capped per repo)
   months of activity ................. 0.5 each (max 12)
   signed-commit ratio ≥ 0.5 .......... +2
   independent maintainer attestation . +5
   × analyzer coverage multiplier (share of code actually parsed), range 0.3–1.0

confidence c = 1 − exp(−E / E0)        (E0 ≈ 30, calibrate against back-test)
shown_score  = prior + c · (raw − prior)   (prior = corpus median — shrinks thin evidence toward "average")

Credential eligibility:  c ≥ 0.60  AND  language coverage ≥ 50%  AND  (≥ 2 distinct repos OR ≥ 1 external merged PR)
```

**Levels:** Verified (score ≥ 60, conf ≥ 0.60) · Strong (≥ 75, ≥ 0.75) · Expert (≥ 88, ≥ 0.85 + ≥1 Tier-2 attestation).

## 7. Data model

### 7.1 Postgres (off-chain — evidence, scores, app state)
Core tables: `developers` (github id, linked wallets), `wallet_bindings` (signed-message proof, gist url), `repos_snapshot` (repo, commit SHA, hashed evidence set), `evidence_items` (typed, source-linked facts: merged PR, review, test result, etc.), `scores` (per-dimension + raw + shown_score + confidence, snapshot timestamp), `credentials` (SAS attestation address, schema, issuer tier, expiry, status), `sponsors` / `listings` / `invites` (console state). Store **derived metrics and hashes only** — never raw repo contents.

### 7.2 On-chain — SAS schema (one schema per skill pack, nonce = subject wallet)
```
Credential: "Proof of Work Issuer"          // authority key ≠ signer key
Schema:     pow.solana-anchor.v1            // e.g. also pow.java.v1, pow.typescript.v1
Fields:
  schema_version   : u8
  skill_score      : u8            // 0–100, already shrunk by confidence
  confidence       : u8            // 0–100
  level            : u8            // 1=Verified 2=Strong 3=Expert
  issuer_tier      : u8            // 1=automated 2=maintainer/sponsor 3=multi-party
  evidence_root    : [u8;32]       // hash of the snapshot evidence set
  analyzer_version : string        // e.g. "anchor-pack-0.3.1"
  report_uri       : string        // public evidence page
Expiry: now + 180 days
```
Keep off-chain: the full evidence report. Keep on-chain: score, confidence, level, `evidence_root`, analyzer version, expiry, report URI only.

## 8. Identity binding (GitHub ↔ Wallet)

1. Developer installs the **read-only GitHub App** (selected repos).
2. Developer connects a Solana wallet via **SIWS** and signs a message containing: GitHub user id + a server nonce + the app domain.
3. Server verifies both sessions and stores the binding.
4. **Independent verifiability:** the developer can publish the signed message as a public gist, so *anyone* can verify the GitHub↔wallet link without trusting the backend.
5. Policy: one GitHub ↔ many wallets allowed (re-attest to a new wallet); one wallet ↔ one GitHub per skill schema.

## 9. Solana design

**Why Solana, in four sentences:**
1. SAS is a public-good credential primitive with existing issuers, verifiers, and wallet-display integrations.
2. Bounty payouts (e.g., Superteam Earn) already land in a Solana wallet — the **payout wallet is the identity anchor** between reputation and payment.
3. Programs and wallets can **read the credential directly on-chain** — reputation becomes a permissionless input, not an API call to you.
4. Credentials are natively **expiring and revocable** under a credential authority, matching how skills actually decay.

**Credential setup:** one SAS credential authority (`Proof of Work Issuer`); authority key kept separate from the signer key; signer key held in a KMS or isolated signer service (devnet keys are fine for the hackathon — show the design either way).

**On-chain gate program (Anchor, Rust)** — one instruction, `claim_verified(bounty)`:
1. Derives the expected attestation PDA for the signer.
2. Checks the account is owned by the SAS program.
3. Parses it with the `solana-attestation-service-client` crate.
4. Requires `issuer ∈ allowlist`, `score ≥ min`, `confidence ≥ min`, `now < expiry`.

Demo it live: the **same instruction succeeds** for a verified wallet and **fails** for an unverified one.

**Open verifier SDK (TypeScript, must-have, your open-source/Public Good asset):**
```
verify(wallet, skill, { minScore, minConfidence, issuerAllowlist })
  → checks attestation PDA derivation, program ownership, issuer allowlist, expiry, thresholds
  → reads directly from an RPC endpoint — no call to your backend
```

## 10. Interfaces / APIs

### 10.1 REST + SSE (frontend ↔ API)
- `POST /analyze` — enqueue an analysis job for a connected developer
- `GET /analyze/:id/stream` — SSE progress
- `GET /evidence/:developer` — evidence report JSON
- `GET /verify/:wallet/:skill` — public verify page data
- `GET /badge/:wallet/:skill.svg` — embeddable badge
- Sponsor console: `POST /search`, `POST /invite`, `POST /listings/:id/verified-link`

### 10.2 On-chain
- `claim_verified(bounty)` instruction on the gate program (Anchor)
- Direct SAS attestation reads via RPC (no backend dependency)

### 10.3 MCP server (read-only tools)
```
get_verified_skills(wallet | github_handle) -> [{skill, level, score, confidence, expires_at, attestation}]
search_developers({skills[], min_score, min_confidence, min_tier, active_within_days, limit}) -> [candidate]
explain_evidence(credential_id) -> {dimensions[], top_evidence_items[], caveats[]}
verify_credential(attestation_address, {issuer_allowlist[]}) -> {valid, reason, checked_at}
triage_applicants(applicants[], requirement) -> [{applicant, fit, confidence, evidence_ids[], gaps[]}]
```
No signing tools are exposed; all results are treated as data by callers (Claude/Cursor sessions triage applicants and explain rankings with evidence IDs).

## 11. Anti-gaming design

| Threat | Mitigation |
|---|---|
| Fork inflation | Detect upstream lineage; count only unique-author changes |
| Commit spam | Commit count ≈ 0 weight; weight merged external PRs + survival instead |
| Tutorial/template clones | Similarity check vs. known templates; skeptic LLM pass; low survival score |
| Test padding | Negative-test ratio; flag tests that assert nothing |
| AI-generated bulk PRs | **Not claimed to be detected** — score depends on independent-maintainer acceptance, survival, reverts |
| Collusion rings (mutual approvals) | Weight reviewers by independence/account age; discount reciprocal reviews |
| Account renting / ghostwriting | Not solvable in MVP — roadmap: timed live challenge, Tier-2 attestations |
| Prompt injection via repo files | Repo text treated strictly as data; strict JSON schemas; LLM has no side-effect tools |

Pitch line: *"The score is gameable. The evidence is inspectable. We show both."*

## 12. Security & privacy defaults

- GitHub App permissions: **read-only** only.
- Repo code is **never executed** on API hosts; any build/compile step runs in an ephemeral, network-disabled, resource-capped container, and only for repos the developer explicitly submitted.
- Analysis workers never hold signing keys or master DB credentials — the credential service is a separate, isolated process.
- Store derived metrics and hashes, not repo contents.
- Consent-based, positive-only public data: no public negative scores; no scoring of non-opted-in developers; delete-on-request for off-chain data (immutable on-chain data is kept minimal for exactly this reason).

## 13. Build scope by team size

| Feature | Solo | Duo | Trio |
|---|---|---|---|
| GitHub App + ingestion + evidence JSON | Must | Must | Must |
| Static signals (Anchor pack) + score + confidence + abstention | Must | Must | Must |
| Wallet↔GitHub binding + SAS issuance + verify page | Must | Must | Must |
| Verifier SDK (TS) | Must | Must | Must |
| Sponsor console (filter, cards, invite, verified-applicant link) | Must | Must | Must |
| Validation back-test (n ≥ 30) | Must (small) | Must | Must |
| Reviewer + skeptic LLM passes | Should | Must | Must |
| MCP server (thin) | Should | Must | Must |
| Badge embed + share card | Should | Should | Must |
| On-chain gate program | Could | Should | Must |
| Java light pack | Won't | Could | Should |
| Payout-receipt evidence | Won't | Could | Should |
| TypeScript pack, Earn overlay | Won't | Won't | Could |
| Private repos, matching model, tokens, marketplace | **Won't (roadmap)** | **Won't** | **Won't** |

**Never cut, regardless of time pressure:** abstention, confidence, verify page, verifier SDK, real volunteer analyses, the back-test.

## 14. Suggested repo layout

```
proofmesh/
├── apps/
│   ├── web/                # Next.js frontend (developer + sponsor UI, verify pages, badges)
│   └── api/                 # Fastify API server (REST + SSE)
├── workers/
│   ├── ingestion/            # GitHub ingest + snapshotting
│   ├── static-analysis/       # sandboxed linters/scanners
│   ├── outcome-analysis/      # merges, survival, reverts
│   └── credential-service/    # isolated signer, SAS issuance
├── packages/
│   ├── scoring-engine/         # deterministic scoring + confidence (pure TS)
│   ├── verifier-sdk/            # published npm package
│   └── shared-types/            # evidence/schema types shared across apps
├── programs/
│   └── proofmesh-gate/           # Anchor program: claim_verified(bounty)
├── mcp-server/                    # read-only MCP tool server
├── scripts/                        # devnet setup, back-test runner, seed data
└── ARCHITECTURE.md                 # this file
```

## 15. Environment / secrets checklist

- `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`
- `DATABASE_URL` (Postgres), `REDIS_URL`
- `SOLANA_RPC_URL` (devnet + mainnet), `SAS_CREDENTIAL_AUTHORITY_KEYPAIR` (KMS-managed, never in plain env in production)
- `ANTHROPIC_API_KEY` (LLM reviewer/skeptic passes)
- `OBJECT_STORAGE_*` (bucket, access keys) for evidence/report JSON
- `ISSUER_ALLOWLIST` (public config consumed by the verifier SDK/gate program)

---

*Derived from the hackathon strategy memo (Sep 19, 2026). Calibration constants (weights, E0, thresholds) are hypotheses — recalibrate against the validation back-test before finalizing the demo numbers.*
