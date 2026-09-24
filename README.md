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

Wallet for the demo reporting page: `ZQqgH8VYSs5HYWCvL25cGpafy3aSnUeWPmSr2nyEeF`.

## On-chain gate (Solana devnet program)

The skill credential is minted at a **wallet + skill PDA** by the Anchor program
`programs/proofmesh-gate` (`anchor-lang 0.30.1`). Deployment requires funding only the
**issuer keypair** below; the program's own keypair is created implicitly by
`solana program deploy` (a 0-SOL empty keypair is fine — its rent is paid by the issuer).

| Role | Keypair | Address |
| --- | --- | --- |
| Issuer / authority (fund with SOL) | `.secrets/proofmesh-devnet.json` | `6TGUP796erCCpxhosXToA4YNv4dxwz1yc7rmTvZEYagZ` |
| Program ID (deploys against this keypair) | `.secrets/proofmesh-gate-keypair.json` | `8p8PNd75RdygjcmnvQMGW3U8Fr9AwgR21fSGSL7VBvAj` |

### Getting devnet SOL (one-time)

The issuer must hold ~1 SOL to rent + deploy the program and pay mint fees:

1. Open https://faucet.solana.com, sign in with GitHub (any account).
2. Wallet address: paste `6TGUP796erCCpxhosXToA4YNv4dxwz1yc7rmTvZEYagZ`.
3. Amount: **2 SOL** (faucet only supports 2; more than enough for rent + deploy + ~100 mints).
4. Solve the CAPTCHA and submit. Confirmation renders an on-chain link in ~30 s.
5. Verify:

   ```bash
   export PATH="/tmp/solana-install/solana-release/bin:$PATH"
   solana balance 6TGUP796erCCpxhosXToA4YNv4dxwz1yc7rmTvZEYagZ --url devnet
   # expect: 2 SOL
   ```

   (Works with any installed solana CLI; `--url devnet` is the only requirement.)

### Building the program (SBF target)

The `proofmesh-gate` crate is pinned to crates that the **legacy SBF toolchain**
(platform-tools v1.41 → rustc 1.75) can build. `cargo +solana` requires the rustup proxy to
precede platform-tools' own `cargo` on `PATH`:

```bash
# one-time toolchain (if not already present)
#   solana 1.18.20 release  → /tmp/solana-install/solana-release (cargo-build-sbf 1.18.20)
#   platform-tools v1.41    → ~/.cache/solana/v1.41/platform-tools
#   rustup toolchain solana → ~/.rustup/toolchains/solana  (cargo 1.75.0)

cd programs/proofmesh-gate
export PATH="/tmp/solana-install/solana-release/bin:$HOME/.cargo/bin:$PATH"   # rustup proxy BEFORE platform-tools
rm -f Cargo.lock
cargo +solana generate-lockfile      # native v3 lock, all crates edition-2021 / MSRV ≤ 1.75

cargo-build-sbf --manifest-path Cargo.toml \
  --sbf-sdk /tmp/solana-install/solana-release/bin/sdk/sbf
# → target/deploy/proofmesh_gate.so (eBPF ELF, 64-bit LSB shared object)

file target/deploy/proofmesh_gate.so   # ELF 64-bit LSB shared object, eBPF
```

**Why the pins?** `Cargo.toml` forces a coherent pre-edition-2024 dependency set, because the
SBF-incompatible crates would otherwise resolve to builds that rustc 1.75 cannot compile:

- `borsh =1.2.1` — avoids `proc-macro-crate 3` → `toml_edit 0.25` (edition 2024)
- `blake3 =1.7.0` — stays on `digest 0.10`; newer blake3 balloons to `digest 0.11` (edition 2024)
- `zeroize =1.3.0` / `zeroize_derive =1.4.2` — `curve25519-dalek 3.2.1` only allows `zeroize <1.4`
- `jobserver =0.1.32` / `getrandom =0.2.17` — 0.1.33+/0.4.x need newer rustc/std
- `indexmap =2.11.4` — 2.13+ raised MSRV past 1.75; 2.14 is edition 2024
- `unicode-segmentation =1.12.0` — `heck 0.3.3` leaves it unconstrained; 1.13 needs rustc 1.85

If `cargo +solana generate-lockfile` picks a crate whose manifest fails to parse under rustc 1.75,
pin its newest safe version the same way and regenerate.

### Deploying

```bash
cd programs/proofmesh-gate
export PATH="/tmp/solana-install/solana-release/bin:$PATH"

solana program deploy \
  --program-id ../../.secrets/proofmesh-gate-keypair.json \
  --keypair ../../.secrets/proofmesh-devnet.json \
  --url devnet \
  target/deploy/proofmesh_gate.so
```

On success you'll see `Program Id: 8p8PNd75RdygjcmnvQMGW3U8Fr9AwgR21fSGSL7VBvAj`.

If deploy fails with `Attempt to debit an account but found no record of a prior credit`, the
issuer is unfunded — repeat the faucet step above.

### After deploy

1. Restart the API so minting uses the now-funded issuer:
   `lsof -ti :4000 | xargs kill -9 ; pnpm dev --filter @proofmesh/api`
2. Run a verify flow (see `pnpm dev`) and the `done` SSE event should report
   `mintConfirmed: true` with a real `attestationAddress` (the wallet+skill PDA).
3. Gate check: `packages/verifier-sdk` `verify()` against real devnet RPC returns `valid: true`.
