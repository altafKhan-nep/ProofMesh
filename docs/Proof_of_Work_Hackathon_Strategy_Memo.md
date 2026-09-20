# Proof of Work — Hackathon Strategy Memo

**Working title:** Proof of Work *(candidate product name: **ProofMesh** — see §1.4)*
**Event:** Colosseum Crypto World's Fair · Sep 14 – Oct 12, 2026 · deadline **11:59 PM PT, Oct 12**
**Memo date:** Sep 19, 2026 · **23 days remaining**
**Prepared for:** Rocky
**Format:** Senior research memo — evidence-tagged, decision-oriented, written to be argued with.

> **Evidence tags used throughout**
> `[V]` verified from a primary source during this research pass ·
> `[R]` reported by secondary sources (likely true; re-check before putting it in your pitch) ·
> `[I]` my inference or judgment ·
> `[A]` assumption that needs your confirmation ·
> `[?]` unverified — check before relying on it.

---

## 0. Read this first (the 3-minute version)

### 0.1 Verdict

Your product — AI/MCP agents analyze a developer's GitHub work, issue scored skill badges as Solana credentials, and let bounty makers (Superteam Earn first) invite developers by proven skill instead of résumé — is **directionally right and better-timed than either earlier document recognised.**

**Why now (the insight your earlier docs missed):** open contribution programs are losing their natural filter, which was effort. In January 2026 curl ended its six-year bug bounty after AI-generated reports overwhelmed triage `[R]`; Ghostty restricted AI-generated contributions and tldraw began auto-closing external pull requests `[R]`. Superteam Earn itself now exposes an agent API where AI agents can register, find agent-eligible listings, and submit work `[V/R]`. When producing a plausible submission is nearly free, **reputation becomes the replacement filter.** That is a sharper pitch than "verified résumé," and it is what Colosseum's "Insight" criterion is asking for.

**The honest problems:**

1. **Concept is crowded.** Talent Protocol's Builder Score already turns GitHub + onchain activity into an onchain score (on Base) and is surfaced by Base and Etherscan `[V]`. An ETHGlobal Lisbon 2026 project already shipped a trust-by-recomputation version of it `[V]`. Neither earlier document mentions either.
2. **Market size problem.** Solana had roughly 3,200 monthly active developers in early 2025 and ~7,600 new developers in 2024 `[R]`; all of crypto had ~23.6k monthly active developers in Nov 2024 `[R]`. A Solana-only bounty-sponsor business is small. The TAM story must expand (§3.2, §9.1).
3. **Proof problem.** No traction, no validation that the score means anything. Colosseum's FAQ says entries are judged as startup pitches and the form asks for demand validation `[V]`.
4. **Capacity problem.** The ProofMesh doc's plan is a multi-person, 6-week build. You have 23 days and (I assume) a very small team `[A]`.

### 0.2 The six decisions this memo makes

| # | Decision | Why | Reverse it if… |
|---|---|---|---|
| D1 | **Lead with "trust gate for open contribution programs"** (bounties, grants, hackathons). Talent discovery is the second use case. | Sharper pain, timely, demo-able, buyers with budgets | Sponsor interviews show they don't feel the slop pain |
| D2 | **Score outcomes, not authorship.** Never claim to detect AI-written code. | AI detection is unreliable; "anti-slop, not anti-AI" is the defensible stance | — |
| D3 | **Two-number credentials with abstention** (score + confidence; *no credential on thin evidence*). | Honest, differentiating, protects you when a judge tries their own repo | — |
| D4 | **Prove it twice by Oct 2:** (a) a validation back-test, (b) real users and sponsor conversations. | Closes the "does the score mean anything?" and "traction" gaps | Back-test fails → pivot to "Evidence Report," drop numeric badge (§7.3) |
| D5 | **Prove Solana:** open verifier SDK + on-chain gate program + payout-wallet identity join. | Answers "why blockchain?" in one screen | SAS limitations block it → SDK-only |
| D6 | **Scope by team size** (§7.1). Depth on Solana/Anchor first; Java/TS as lighter packs only if capacity allows. | You keep your Java badge vision without sinking the demo | — |

### 0.3 Realistic prize expectations

| Prize | Amount | Fit | Note |
|---|---|---|---|
| **Solana track** | 10 × $10,000 | **Primary target** | "Best products that integrate with Solana" `[V rules]` |
| Top-20 general | $15,000 each | Medium | Cross-ecosystem; needs strong story + traction |
| Public Good | $5,000 | Medium | Open-source verifier + schema is the angle |
| University | $5,000 | **Eligibility not defined in the rules** `[V]` | Email hackathon@colosseum.com before counting on it |
| Grand Prize | $30,000 | Low | Do not plan around it |
| **Accelerator** | $250,000 pre-seed | **The real prize** | Winners are interviewed (15-min Zoom) `[V]` |

**Base rate:** ~23 general slots + 10 Solana slots against a field of likely 2,500–4,000 submissions `[I]` (4,629 builders registered as of Sep 19 `[V]`; prior editions drew 1,576 and 2,858 projects `[V]`). A generic good entry starts near 1%. The goal of this memo is to move you into the shortlist band, not to promise a win. Prizes are paid in CASH stablecoin and winners must pass due diligence `[V rules]`; winners are announced by Dec 5 `[V rules]`.

### 0.4 What changed versus your two earlier documents

| Topic | Doc 1 (short) | Doc 2 (ProofMesh) | This memo |
|---|---|---|---|
| Positioning | "GitHub is the résumé, Solana is the notary" | Evidence-graph reputation layer | **Trust gate for open contribution programs** + talent discovery |
| Novelty claim | Nobody built it | Basic idea is crowded (correct) | Novelty = outcome evidence + abstention + on-chain gating + published validation |
| Competitors | CareerTWiN, SOLID, Dework | + SkillPassport, GitPOAP, VeriHire, PoWR | **+ Talent Protocol, Open Builder Score, Earn agent API** |
| Scope | Modest | Very large (7 agents, 3 languages, 12 must-haves) | **Tiered by team size** |
| Traction | Seed 10–20 profiles | "Design partners" | **Quantified targets, interview scripts, kill criteria** |
| Why Solana | SAS + cheap fees | SAS portability | **SAS + payout-wallet identity + on-chain gate program + open SDK** |
| Validation | None | None | **Back-test vs. baselines, expert panel** |
| Criteria | 7 (team added) | 6 official | 6 official **+ FAQ's 7 startup factors incl. traction** |

---

## 1. The product (your definition, kept intact)

### 1.1 Your original loop

1. AI/MCP agents analyze developers' GitHub code and contributions.
2. They evaluate **code quality, security, architecture, testing, and consistency**.
3. Developers earn **verified skill badges** (e.g., *High-Quality Java Developer*, *Solana Developer*) with **scores per skill**.
4. Teams — **Superteam Earn, Fiverr, Solana jobs, Superteam Talent** — discover developers by **proven coding ability, not just résumés**.
5. On **Superteam Earn, bounty makers invite developers by reputation/skills**; the reputation lives on Solana as an **on-chain credential**.

### 1.2 The loop after this memo

```
Developer connects GitHub + Solana wallet (identity bound & provable)
        │
        ▼
Deterministic evidence pipeline  →  outcome signals + static signals   (LLM never emits the score)
        │
        ▼
Score + Confidence per skill pack  (abstain if evidence is thin)
        │
        ▼
Solana Attestation Service credential (wallet-bound, expiring, revocable)
   + public evidence page + embeddable badge + open verifier SDK
        │
        ▼
Consumers:  Sponsor console (invite by proof)  ·  MCP server (agents triage applicants)
            ·  On-chain gate program (claim only if verified)  ·  Any app via SDK
        │
        ▼
Real work (bounty paid to the same wallet)  →  new evidence  →  stronger credential
```

### 1.3 Kept / sharpened / added

- **Kept:** every element of your five points, including Java as a badge family and Fiverr/Solana Jobs/Superteam Talent as target consumers.
- **Sharpened:** "code quality" is measured mostly by *outcomes* (merged by independent maintainers, survived review, survived in the codebase), not by an LLM's taste.
- **Added:** abstention, confidence, back-test, embeddable badge, on-chain gate, payout-receipt evidence, traction plan.

> **Integration reality check `[?]`:** Earn is open source (AGPL-3.0) with a public agent API `[V/R]`. I found **no evidence** that Fiverr, Solana Jobs, or Superteam Talent expose reputation-import APIs. Do not claim integrations. The portable route is an **embeddable verified badge + verify URL** that a developer can paste into *any* profile (Fiverr, Upwork, LinkedIn, GitHub README), plus a sponsor-side "verified-applicant link" (§6.9).

### 1.4 Naming

"Proof of Work" collides with Bitcoin's consensus term, with **Ore** (a proof-of-work currency on Solana that won Colosseum's Renaissance Grand Champion `[R]`), and with the PoWR Devpost project `[R]`. Judges will pattern-match. **Recommendation:** ship under a distinct name (ProofMesh from Doc 2 is fine) and keep "proof of work, verified" as the tagline. Decide by **Sep 21**; check domain, X handle, npm scope, GitHub org, and a quick trademark search `[?]`.

---

## 2. The problem and why now

### 2.1 Three failures

1. **Signal collapse.** AI output "looks polished, compiles, and passes lint," so cheap surface signals no longer discriminate `[R]`.
2. **Review-cost asymmetry.** A plausible submission costs the submitter almost nothing; it costs the reviewer the same 20–40 minutes as ever `[R]`.
3. **Siloed reputation.** Work history sits inside platforms, is non-portable, and is not machine-queryable.

### 2.2 Evidence

| Evidence | Tag | Use in pitch? |
|---|---|---|
| curl ended its 6-year bug bounty in Jan 2026 after AI-generated reports flooded triage (program had paid ~$86k for 78 vulnerabilities) | `[R]` multiple sources | Yes — cite one primary post (Stenberg's blog) after re-checking |
| Commentary summarising what curl said a replacement would need: account-age requirements, rate limits, labels for AI submissions | `[R]` single source | Only after checking primary |
| Ghostty zero-tolerance policy; tldraw auto-closing external PRs; Gentoo/NetBSD/QEMU AI-contribution restrictions | `[R]` | Yes, as a pattern |
| Maintainers describe a distinction: "anti-slop, not anti-AI" | `[R]` | Yes — it is your design principle |
| "AI PRs have ~1.7× more defects" | `[R]` single blog | **No** — too weak |
| Earn agent API: agents register, list agent-eligible bounties, submit; humans claim payout to a Solana wallet | `[V/R]` Earn's own agents page + third-party guide | Yes — verify live before the video |
| Earn scale: 190k+ talent / 2,520+ sponsors (third-party listing) vs. 210k+ / 2,700+ (Doc 1) | `[R]` conflicting | Quote the **live** number from superteam.fun |

### 2.3 What the evidence does *not* show

- It does not show that **Solana bounty sponsors** feel slop pain today. curl is web2 open source. **Measure this** in five sponsor conversations before Oct 2 (§8.2). If they don't, your buyer is grants/hiring, not bounties.
- It does not show sponsors will **pay**.
- It does not show your score is **valid** (§8.1).

### 2.4 The reframing

> Open contribution programs used to rely on effort as a filter. Effort is now free. **Track record is the next filter** — and track record is exactly what GitHub history, merged-PR outcomes, and paid-work receipts encode. Proof of Work turns that track record into a portable, verifiable credential.

---

## 3. Customers and market size

### 3.1 Buyer map

| Buyer | Pain | Budget | Sales cycle | Demo-able in 3 weeks? | Priority |
|---|---|---|---|---|---|
| **Bounty sponsors** (Earn-style) | Too many look-alike submissions | Small, per-listing | Fast | Yes | **Wedge** |
| **Grant committees / ecosystem programs** | Allocating capital to builders; sybil/farming | Larger | Medium | Yes (same console) | **High — test in interviews** |
| **Hackathon organizers / judges** | Reviewing thousands of repos; "did they do the work?" | Real | Medium | Yes (evidence report per repo) | High — sensitive, see below |
| Protocol / DAO hiring | Résumé inflation | Larger | Slow | Partially | Medium |
| Talent platforms (Earn, Talent, Solana Jobs, Fiverr) | Quality signal for their users | Varies | Slow | Only via badge/SDK | Roadmap |
| AI-agent marketplaces | Who is behind the agent? | Unknown | Unknown | No | Later |

> **Sensitivity:** Colosseum itself reviews repos for authorship and in-window work `[V FAQ]`. A "hackathon review tool" is a legitimate product line, but do **not** pitch it to judges as a favor to yourself, and do **not** analyze other participants' repos without consent. Show it as a market, not a request.

### 3.2 TAM reality (be the researcher who says this before the judge does)

- Solana ≈ **3,200 monthly active developers** (early 2025), **7,600+ new developers in 2024** `[R]`. Crypto-wide ≈ **23.6k** monthly active developers (Nov 2024) `[R]`. These count open-source contributors only and are dated; use the latest Electric Capital figure in your final deck `[?]`.
- **Illustrative Earn-only ceiling** `[A]`: 2,520 sponsors × 5–10% running developer listings monthly × $100–$200/month ≈ **$150k–$600k ARR**. That is a decent lifestyle business and **not** venture scale. Show this arithmetic openly, then show the expansion ladder.
- **Expansion path that raises TAM credibly:**
  1. Solana → **any crypto** (add Solidity/Foundry, Move packs; the Fair itself is multi-chain and the top-20 pool is ecosystem-agnostic).
  2. Bounties → **grants, hackathons, DAO contributor programs**.
  3. Crypto → **any open contribution or hiring program facing AI-slop** (web2 OSS bounties, freelance marketplaces).
  4. Human developers → **developer-plus-agent reputation**.

### 3.3 Beachhead

Solana developers who already have a wallet, a GitHub, and a reason to be trusted *this month*: **hackathon builders and bounty hunters.** You can reach them today through Colosseum's Discord, Superteam chapter channels, and Telegram groups `[A]`.

---

## 4. Competitive landscape (updated)

| Player | What it does | Overlap | Your gap |
|---|---|---|---|
| **Talent Protocol — Builder Score** | Aggregates GitHub, onchain activity and credentials into a score on Base; API; adopted by Base, Etherscan, Basenames; token rewards tied to score `[V]` | **High** | Activity aggregation, EVM-centric; you evaluate **code outcomes and provenance**, Solana-native, with confidence/abstention |
| **Open Builder Score** (ETHGlobal Lisbon 2026) | Client-side recomputation of Builder Score, attested on Base via EAS `[V]` | High on "verifiable by recompute" | Not code-evidence-based; not Solana |
| **SkillPassport** | GitHub-derived skill scores, recruiter search `[R]` | High on concept | No Solana credential, no gate, no validation published `[I]` |
| **GitPOAP** | POAPs for contributions `[R]` | Medium | Recognition, not skill quality |
| **VeriHire** | Assessment + blockchain certificate `[R]` | Medium | Test-based, not real-work-based |
| **PoWR** | GitHub-history hash anchored onchain `[R]` | Medium | Hash, not evaluation |
| **Solana Matcher** | AI talent matching (past Colosseum project) `[R]` | Medium | Matching, not evidence |
| **Solana ID** (career attestations) | Employment attestations via SAS `[R]`; hub reportedly winding down `[?]` | Low | Employment ≠ code competence |
| **Superteam Earn / Talent** | Distribution, profiles, agent API `[V/R]` | **Your channel** | No independent verification layer `[I]` |
| **Security tooling** (Trail of Bits Solana patterns/lints, others) | Detects Solana vulnerability patterns `[V]` | **Complement** | You compose them into evidence |
| Audit-contest leaderboards (Code4rena, Sherlock, Cantina) | Skill signal via contest results `[I — general knowledge; verify]` | Adjacent | Narrow (auditing), not general dev work |

### 4.1 Differentiation axes (put this in the deck as a 2×2 or matrix)

| | Evaluates code/outcomes | Confidence + abstention | Solana-native credential | Consumed on-chain | Open verifier |
|---|---|---|---|---|---|
| Talent Protocol | Partial (activity) | No | No | No | API |
| Open Builder Score | No | No | No | No | Yes (recompute) |
| SkillPassport | Yes (LLM-heavy) `[I]` | No `[I]` | No | No | No |
| **Proof of Work** | **Yes (outcomes first)** | **Yes** | **Yes (SAS)** | **Yes (gate program)** | **Yes (SDK)** |

### 4.2 Scripted answers for the hardest competitive questions

- **"Isn't this Talent Protocol?"** — "Talent aggregates activity across sources into one score. We inspect the *work*: whether independent maintainers accepted it, whether tests fail on bad input, whether code survived. And every credential carries confidence and can abstain. It's also Solana-native and consumable on-chain."
- **"What if Superteam builds this?"** — "Then we've succeeded at distribution. Our verifier is open source, so Earn can consume our credentials or run its own issuer under the same schema. Our moat is evidence quality, issuer trust, and the corpus — not exclusivity on the UI."

---

## 5. The core insight and design principles

**Insight:** *Track record survives AI; style does not.* You cannot reliably tell who typed the code, but you can measure whether independent maintainers merged it, whether it broke, whether tests reject bad input, whether it survived for months, and whether someone paid for it.

| # | Principle | Consequence |
|---|---|---|
| P1 | **Outcomes over style.** Weight external merges, review survival, code survival, CI, paid bounties above LLM aesthetics. | Harder to game; AI-assisted work that is accepted still counts |
| P2 | **Two numbers, always.** Score and confidence; low evidence → no credential. | Honest; protects demo |
| P3 | **Anti-slop, not anti-AI.** Never claim AI detection. | Avoids a claim you can't defend |
| P4 | **Deterministic first, LLM second.** The LLM explains and critiques; it **never** emits the final score. | Reproducible, auditable, cheap |
| P5 | **Scoped, expiring claims.** "Anchor testing discipline 0.81 (conf 0.90) as of snapshot X," valid 180 days. | Prevents "89 forever" |
| P6 | **Verifiable by anyone.** SAS + open SDK + issuer allowlist. | Composability and Public Good angle |
| P7 | **Consent, opt-in, positive-only.** No public negative scores; no scoring people who haven't opted in. | Privacy, ethics, legal safety |

---

## 6. Product specification (hackathon MVP)

### 6.1 Personas and journeys

**Developer (supply).** Land → "Get verified in 5 minutes" → GitHub App install (read-only, select repos) + wallet sign-in → live progress → **evidence report first, score second** → if evidence is sufficient, mint credential → get verify URL, embeddable badge, and share card.
*If evidence is thin:* "Not enough evidence for a credential yet. Here's what we found and what would raise confidence." (This state must exist — judges will test it.)

**Bounty maker / program manager (demand).** Define requirement (skills, min score, min confidence, recency, tier) → see evidence cards → **invite**. Or paste applicant handles/wallets from a listing → get an evidence-ranked shortlist, with a one-click "ask unverified applicants to verify" link.

**Third-party app or agent (composability).** Call the SDK, REST, or MCP server; or read the attestation directly on-chain.

**"Try it in 60 seconds" for judges:** any visitor can log in with their **own** GitHub and get an evidence preview without a wallet. Wallet is only needed to mint. Public sample dossiers show only **consenting** volunteers and your own repo.

### 6.2 Skill packs and badges

| Pack | Depth at hackathon | Badge examples |
|---|---|---|
| **Solana / Anchor (Rust)** | **Deep** — all signals in §6.3 | Verified / Strong / Expert **Solana Developer** |
| **TypeScript** | Light (stretch) | Verified TypeScript Developer |
| **Java** | Light (stretch, your original vision) | **High-Quality Java Developer** (Verified / Strong) |

Light packs use language-agnostic and GitHub-native signals only, and their confidence is **capped at 0.75** until deeper analyzers exist. Say this openly in the pitch; it turns a scope limit into a design principle.

**Levels** (starting values `[A]`, to be calibrated in §8.1):

| Level | Shown score | Confidence | Extra |
|---|---|---|---|
| Verified | ≥ 60 | ≥ 0.60 | — |
| Strong | ≥ 75 | ≥ 0.75 | — |
| Expert | ≥ 88 | ≥ 0.85 | ≥ 1 Tier-2 attestation |

**Issuer tiers:** Tier 1 automated analysis · Tier 2 verified maintainer or sponsor attestation · Tier 3 independent multi-party verification. Only Tier 1 ships in the MVP; the schema reserves the field.

### 6.3 Your five dimensions → concrete signals

Weights are a **hypothesis** `[A]`: Quality 20 · Security 25 · Architecture 15 · Testing 25 · Consistency 15.

| Dimension | Solana/Anchor pack (deep) | Java / TS light pack |
|---|---|---|
| **Code quality** | rustfmt conformance (runs without a full build); function size/complexity via syntax parsing; error-handling patterns (custom errors, `require!`); doc coverage; CI lint status via Checks API | Complexity (e.g., lizard), duplication (e.g., jscpd), Checkstyle/PMD/ESLint if present in CI |
| **Security** | Heuristics for Trail of Bits' Solana patterns: missing signer/owner checks, improper PDA validation, arbitrary CPI, sysvar/introspection issues `[V]`; `Signer`/`has_one`/`seeds+bump` usage; raw vs checked arithmetic in handlers; `init_if_needed`, `UncheckedAccount` without `/// CHECK:`; `cargo audit` on `Cargo.lock`; secret scanning (e.g., gitleaks) | Lockfile vulnerability scan (e.g., osv-scanner); secret scanning |
| **Architecture** | Instruction/state separation; account-struct design and `InitSpace`; PDA seed consistency; workspace layout; IDL present; small **low-weight** LLM rubric review | Package/layering structure, cyclic dependencies |
| **Testing** | Test/code ratio; CI runs tests; **negative-test ratio** (tests asserting rejection: wrong signer, wrong owner, overflow) — the most Solana-specific signal; LiteSVM/Bankrun/`anchor test` usage; coverage from CI artifacts if available | JUnit/Jest counts, CI status, coverage artifacts if present |
| **Consistency** | Regular activity over ≥ 6–12 months (regularity, **not** volume; do not punish gaps); PR size discipline; release tags; maintenance (issues closed, dependency bumps); fmt/lint enforced in CI | Same |

**Cross-cutting outcome signals (highest weight inside each dimension):**
- Merged PRs into repos the developer does **not** own, reviewed by others.
- Review comments received and resolved; ratio of reverts or fix-up commits shortly after merge.
- **Code survival:** share of authored lines still present after 90 days (from `git blame`; compute only for a few repos).
- Signed-commit ratio (GitHub verification status).
- **Paid-work receipts (Solana-native, `[I]` hypothesis):** on-chain transfers to the developer's wallet from bounty/grant payers. If Earn payouts are traceable on-chain to a listing, they are verifiable delivery evidence with **no sponsor cooperation**. **Test with one real payout before building `[?]`.**

> **Build note:** For the live path, prefer **GitHub-native evidence and static parsing** over compiling arbitrary repos. Anchor/Solana toolchains are heavy, version-fragile, and a code-execution risk. Reuse existing CI results (Checks API) instead of re-running builds. Compile only seeded repos in an isolated sandbox, if at all.

### 6.4 Scoring and confidence (starting model — calibrate, don't worship)

```
For each dimension d:   s_d ∈ [0,100]  = percentile of the developer's signal vs. a reference corpus of comparable repos
raw       = Σ w_d · s_d                         (Σ w_d = 1)

Evidence units E = Σ of:
   external merged PR ............ 3 each (cap by distinct repos)
   own-repo PR with independent review ... 2 each
   repo with tests + green CI ..... 2 each (cap per repo)
   months of activity ............. 0.5 each (max 12)
   signed-commit ratio ≥ 0.5 ...... +2
   independent maintainer attestation +5
   × analyzer coverage multiplier (share of code parsed), range 0.3–1.0

confidence c = 1 − exp(−E / E0)                 (E0 ≈ 30, to calibrate)
shown_score  = prior + c · (raw − prior)         (prior = corpus median; shrinks thin evidence toward "average")

Credential eligibility:  c ≥ 0.60  AND  language coverage ≥ 50%  AND  ≥ 2 distinct repos or ≥ 1 external merged PR
```

Reference-corpus percentiles are more defensible than hand-picked thresholds, and the same back-test set (§8.1) builds it.

### 6.5 Analysis pipeline (what runs, in order)

1. **Ingest** via GitHub GraphQL/REST: repos, commits, PRs, reviews, releases, Checks/Actions results, signature status. Snapshot at commit SHAs; hash the evidence set → `evidence_root`.
2. **Static analysis** (deterministic tools, sandboxed, no network): parsing, lints, dependency and secret scans.
3. **Outcome analysis:** external merges, survival, reverts, releases.
4. **Scoring engine** (pure function of evidence → dimension scores → score + confidence).
5. **LLM pass A — reviewer:** reads *selected* evidence and writes the explanation with evidence IDs.
6. **LLM pass B — skeptic:** tries to falsify (fork inflation, trivial diffs, generated files, tutorial clones, doc-only changes) and can only **lower confidence or block issuance**, never raise the score.
7. **Credential service** (separate process, threshold check) → SAS issuance.

Two LLM passes in a plain deterministic orchestrator beat a seven-agent framework for a 23-day build, and the system still works with the LLM turned off (deterministic-only mode — your demo fallback).

### 6.6 Anti-gaming

| Threat | Mitigation | Residual risk |
|---|---|---|
| Fork inflation | Detect upstream; count only unique-author changes | Low |
| Commit spam | Commit count ≈ 0 weight; weight merged external PRs and survival | Low |
| Tutorial/template clones | Similarity to known templates; skeptic pass; low survival | Medium |
| Test padding | Negative-test ratio; tests that assert nothing flagged | Medium |
| AI-generated bulk PRs | **Not detected.** Score depends on acceptance by independent maintainers, survival and reverts | Medium — say so openly |
| Collusion rings (mutual approvals) | Weight reviewers by independence and account age; discount reciprocal reviews | **Medium-high** — cannot fully solve |
| Account renting / ghostwriting | Not detectable in MVP; roadmap: timed live challenge, Tier-2 attestations | High |
| Prompt injection via repo files | Repo text is data; strict JSON schemas; LLM has no side-effect tools | Low |
| Goodhart's law (money attached to scores) | Open the schema and verifier; keep some detectors private; expiry and re-analysis | Ongoing — Talent Protocol's token rewards show the pressure is real `[V]` |

> **Pitch line:** "The score is gameable. The evidence is inspectable. We show both."

### 6.7 Identity binding (missing from both earlier docs)

- GitHub App install (read-only) for repository access; Sign-In With Solana for the wallet.
- **Binding proof:** wallet signs a message containing the GitHub user id, a server nonce, and the app domain. The server verifies both sessions.
- **Independent verifiability:** the developer may publish the signed message in a public gist so *anyone* can verify the link without trusting your server.
- Policy: one GitHub ↔ many wallets allowed (re-attest to new wallet); one wallet ↔ one GitHub per skill schema `[A]`.

### 6.8 Solana design

**Why Solana (say it in four sentences):**
1. SAS is a public-good credential primitive with existing issuers/verifiers and wallet-display integrations `[V]`.
2. **Earn payouts already land in a Solana wallet** `[V/R]`, so the *payout wallet is the identity anchor* between reputation and payment.
3. Programs and wallets can **read** the credential directly — reputation becomes a permissionless on-chain input, not an API call to us.
4. Credentials are expiring and revocable under a credential authority with authorized signers `[V]`, matching how skills decay.

**Credential setup:** one SAS credential authority (`Proof of Work Issuer`), authority key separate from the signing key, signer key held in a KMS or isolated signer service (devnet keys are fine for the hackathon, but show the design). Decide **mainnet vs devnet** for the final demo after measuring fees `[?]`.

**Schema strategy:** one schema **per skill pack** (`pow.solana-anchor.v1`, `pow.java.v1`, `pow.typescript.v1`), attestation **nonce = subject wallet**. The SAS docs' own example derives the attestation address from credential + schema + nonce with the user's address as nonce `[V]`, so this is the simplest way to give one wallet several skill attestations without hashing tricks. Draft fields in Appendix A.

**Freshness:** default expiry 180 days. Re-analysis issues a new attestation; confirm whether SAS supports in-place update or requires close-and-recreate `[?]`.

**Keep off-chain:** the full report and evidence; put only score, confidence, level, `evidence_root`, analyzer version, expiry, and report URI on-chain.

**Open verifier SDK (Must-have, this is your open-source and Public Good asset):**
`verify(wallet, skill, {minScore, minConfidence, issuerAllowlist})` → checks attestation PDA derivation, program ownership, issuer in allowlist, expiry, and thresholds — **from an RPC endpoint alone, with no call to your backend.** Demo it in a terminal.

**On-chain gate program (Should-have, the strongest "Solana proof"):** a small Anchor program with one instruction, `claim_verified(bounty)`, that:
1. derives the expected attestation PDA for the signer,
2. checks the account is owned by the SAS program,
3. parses it with the SAS client crate (`solana-attestation-service-client`) `[V]`,
4. requires issuer ∈ allowlist, `score ≥ min`, `confidence ≥ min`, and `now < expiry`.

Demo: the same instruction **succeeds** for a verified wallet and **fails** for an unverified one. It shows Solana is necessary, not decorative. A Realms-style contributor-gating plugin is a natural extension; a Realms representative was listed among track judges `[V]`, so it's a relevant hook `[I]`.

### 6.9 Sponsor console and the "invite" flow (Earn-style)

**What you can build without Earn's permission:**
- **Mode A — Standalone console:** search/filter, evidence cards, "why matched," **Invite** (generates a tracked link plus message for Telegram/X/email/Earn DM copy). Optionally paste applicant handles from a listing to rank them.
- **Mode B — Verified-applicant link:** the sponsor adds "Get verified in 5 minutes: <link>" to the listing description. Applicants come to you; **sponsors become your acquisition channel.** Best growth loop in the plan.
- **Mode C — Overlay/extension on Earn pages** showing badges for applicants `[?]` (check Earn's terms; stretch goal for a 3-person team).
- **Mode D — Official integration/PR** to open-source Earn: post-hackathon, only after a conversation.

Never claim an official integration unless Superteam agrees in writing.

### 6.10 MCP server (thin, useful, honest)

Read-only tools (Appendix B): `get_verified_skills`, `search_developers`, `explain_evidence`, `verify_credential`, `triage_applicants`. Demo: a Claude or Cursor session triages 20 applicants for a bounty and explains each rank with evidence IDs. **MCP is a delivery mechanism, not the pitch.** No signing tools are exposed; results are treated as data by callers.

### 6.11 Architecture and stack

```
Next.js (wallet adapter, SIWS)  ──►  API (Node/Fastify, REST + SSE)
                                          │
        GitHub App webhooks/GraphQL ──────┤
                                          ▼
                              Redis/BullMQ job queue
                                          │
     ┌──────────────┬──────────────┬──────┴───────┬──────────────┐
  Ingestion     Static analysis   Outcome       LLM passes     Credential service
  worker        (sandboxed)       analysis      (A + B)        (isolated signer)
     └──────────────┴──────────────┴──────┬───────┴──────────────┘
                                          ▼
                       Postgres (evidence, scores, credentials)  +  S3-style reports
                                          │
                     SAS on Solana  ◄─────┴─────►  Verifier SDK · MCP server · Gate program
```

**Security defaults:** read-only GitHub App permissions; never execute repo code on API hosts; ephemeral containers with no network, CPU/memory/time limits for any build; analysis workers never hold signing keys or master DB credentials; store derived metrics and hashes, not repo contents; delete-on-request.

### 6.12 Growth artifacts

Embeddable SVG badge (`/badge/<wallet>/<skill>.svg`) for GitHub READMEs and profiles, plus an OG share card. Every badge links to the verify page — the credential is your distribution.

---

## 7. Feasibility and the 23-day plan

### 7.1 Scope by team size `[A — tell me yours]`

| Feature | Solo | Duo | Trio |
|---|---|---|---|
| GitHub App + ingestion + evidence JSON | Must | Must | Must |
| Anchor static signals + score + confidence + abstention | Must | Must | Must |
| Wallet↔GitHub binding + SAS issuance + verify page | Must | Must | Must |
| Verifier SDK (TS) | Must | Must | Must |
| Sponsor console (filter, cards, invite, verified-applicant link) | Must | Must | Must |
| 10–15 volunteer developers + 5 sponsor conversations | Must | Must | Must |
| Validation back-test (n ≥ 30) | Must (small) | Must | Must |
| Reviewer + skeptic LLM passes | Should | Must | Must |
| MCP server (thin) | Should | Must | Must |
| Badge embed + share card | Should | Should | Must |
| On-chain gate program | Could | Should | Must |
| Java light pack | Won't | Could | Should |
| Payout-receipt evidence | Won't | Could | Should |
| TypeScript pack, Earn overlay | Won't | Won't | Could |
| Private repos, matching model, tokens, marketplace, delivery attestations at scale | **Won't (roadmap)** | **Won't** | **Won't** |

### 7.2 Calendar and gates

| Dates | Focus | Gate (must be true to proceed) |
|---|---|---|
| **Sat Sep 19 – Sun Sep 20** | Copilot check, email Colosseum (University Prize), pick name, repo + README, GitHub App, DB, SAS credential + schema on devnet ("hello attestation"), volunteer list of 25 names | **G0:** devnet attestation minted from a script |
| **Mon Sep 21 – Sun Sep 27** | Ingestion → evidence JSON; wallet binding; Anchor static signals v0; assemble back-test set; onboard first 5 volunteers; **first 60-sec update video** | **G1 (Sep 22):** real repo → evidence JSON · **G2 (Sep 27):** real analysis → real devnet attestation |
| **Mon Sep 28 – Sun Oct 4** | Score + confidence + abstention; skeptic pass; verify page; verifier SDK; sponsor console; run volunteers; back-test results; 5 sponsor calls | **G3 (Oct 2):** ≥ 15 real analyses, back-test result known, ≥ 3 sponsor conversations |
| **Mon Oct 5 – Wed Oct 7** | MCP server; gate program (if capacity); badge embed; dogfood on your own repo; hardening | **G4 (Oct 7): FEATURE FREEZE** |
| **Thu Oct 8 – Fri Oct 9** | Record both videos from real sessions; finalize README/build log; form answers | Videos done |
| **Sat Oct 10 – Sun Oct 11** | Buffer, dry-run interview, **submit by Oct 11** | Submitted |
| Mon Oct 12 | Emergency only (deadline is 11:59 PM PT — convert to your local time and stay a day ahead) | — |

Post a 60-second progress video each Sunday (Sep 20, 27, Oct 4, 11). Updates aren't strictly required but are strongly recommended `[V]`.

### 7.3 Kill and pivot criteria

| Trigger | Action |
|---|---|
| No devnet attestation from real analysis by Sep 27 | Cut LLM passes and MCP; ship deterministic-only |
| Back-test shows the score doesn't beat naive baselines (commit count, stars) by Oct 2 | **Pivot:** drop the numeric badge; ship "Evidence Report + verified facts" (external merges, tests, CI, survival) and lean on abstention and provenance |
| < 10 volunteers by Oct 2 | Change outreach: post "free Anchor repo review" in builder channels, DM individually, ask sponsors to add the verified-applicant link |
| Sponsors don't feel slop pain | Re-aim the console at grant committees and hiring; reframe pitch deck on programs allocating capital |
| SAS blocks a needed feature | Fall back to SDK-only verification; document the limitation |

### 7.4 Cut order (when time runs out, cut in this order)

Java light pack → payout-receipt evidence → Earn overlay → MCP server → gate program → badge embed → skeptic pass. **Never cut:** abstention, confidence, verify page, verifier SDK, volunteer analyses, back-test.

### 7.5 Demo strategy

- **Live:** the judge's-own-GitHub preview (target < 90 seconds using the static path).
- **Cached:** heavy analyses pre-computed and replayed with real timestamps.
- **Never fake:** numbers, integrations, or users. Label simulated flows as simulated.
- **Fallbacks:** deterministic-only mode if the LLM fails; local validator if devnet is down; recorded run as last resort.

---

## 8. Validation and traction (the part that separates finalists from the field)

### 8.1 Validation back-test: "does the score mean anything?"

**Hypothesis H1:** the score separates developers that independent experts judge strong from those they judge weak, and it beats naive baselines.

**Method**
1. Build a labeled set of **40–60** Solana/Anchor developers or repos, public data only.
   - *Likely-strong:* maintainers or long-running contributors to well-known Solana programs; developers with merged external contributions to reputable repos; prior Colosseum winners' public repos (acknowledge the confound: winners win for many reasons).
   - *Controls:* minimal hackathon repos, fork-only accounts, tutorial clones.
2. **Expert panel:** recruit 3 experienced Solana developers to blind-rate ~20 samples on a 1–5 scale.
3. **Metrics:** Spearman ρ between score and expert median (**target ≥ 0.5**); AUC for strong vs. control (**target ≥ 0.75**).
4. **Baselines you must beat:** commit count and GitHub stars. If you don't beat them, your model adds nothing.
5. **Report honestly:** small n, confidence intervals, failure cases, and where the model is weak.

**Ethics:** public repos only; publish aggregates, not named scores; individual results only with consent.

**Outcomes:** pass → put the chart in the deck; partial → tune weights once, re-test; fail by Oct 2 → pivot per §7.3. Either way, "we tested it and here's what we found" is a strong founder-quality signal.

### 8.2 Demand validation

**Interview targets:** 8 bounty sponsors, 3 grant/program managers, 2 hackathon organizers or track judges (**don't lobby Colosseum judges**), 15 developers.

**Script (sponsors, 20 minutes)**
1. Walk me through your last developer bounty: applicants, time to pick, quality of winner?
2. How much of that time was filtering look-alike or low-effort submissions?
3. Have you seen AI-generated or agent submissions? What did you do?
4. If you could see verified evidence for each applicant, what would you need to trust it?
5. Would you add a "get verified" link to your next listing? Would you pay for a verified shortlist — what price feels obvious?
6. Who else has this problem? Can you introduce me?

**Commitment ladder (ask every time):** intro → add link to a listing → run a pilot on one listing → written quote → LOI. Record with consent; extract quotes.

**Targets** `[A]`

| Metric | Minimum | Good | Great |
|---|---|---|---|
| Real analyses run | 25 | 60 | 150 |
| Credentials minted | 8 | 20 | 50 |
| Sponsor/program interviews | 5 | 10 | 15 |
| Listings carrying a verify link | 1 | 3 | 6 |
| Sponsor pilots | 1 | 2 | 4 |
| Written quotes | 3 | 6 | 10 |
| Repeat users (analysis re-run) | 3 | 10 | 25 |

### 8.3 Single-player value: "Free Anchor Evidence Report"

Before the network exists, the tool must be useful alone. Offer hackathon builders a free evidence report on their **own** Anchor repo (test gaps, missing-signer patterns, negative-test ratio) plus a credential if evidence suffices. It is real value, it puts you in front of the exact beachhead, and every shared badge advertises you. Post in builder channels with explicit consent language.

### 8.4 Artifacts for the submission form

Usage screenshot, back-test chart, sponsor quotes, a live listing carrying a verify link, weekly update videos, and the README "Hackathon build log."

---

## 9. Business and startup story

### 9.1 Expansion ladder

| Stage | Customer | Product | Trigger to advance |
|---|---|---|---|
| **1 Wedge** | Earn-style bounty sponsors + Solana builders | Console, badge, SDK, verified-applicant link | 3+ sponsors using it repeatedly |
| **2** | Grant committees, hackathons, DAO contributor programs | Program dashboards, bulk evidence reports | Paid pilot |
| **3** | Any chain (Solidity/Foundry, Move) | New skill packs, multi-chain credentials | Demand from stage 2 buyers |
| **4** | Any program facing AI-slop (web2 OSS, freelance marketplaces) | Trust API | Marketplace partnership |
| **5** | Agent economy | Developer-plus-agent reputation | Market maturity |

### 9.2 Revenue model (hypotheses to test, not facts)

| Segment | Model | Test |
|---|---|---|
| Developers | Free | — |
| Sponsors | Per-listing or monthly subscription | Ask price-anchor question in interviews |
| Programs / talent platforms | Usage-based API per verification | Pilot pricing |
| Later | Issuer subscriptions; re-verification | Enterprise conversations |

**Unit economics:** measure real cost per analysis (LLM tokens + compute) during volunteer runs `[A: target well under $0.50]` and put the **measured** number in the deck. Judges reward real unit economics.

### 9.3 Moat (honest version)

You cannot defend the dashboard, prompts, or GitHub OAuth. You *can* accumulate: a **reference corpus and calibration**, the **issuer trust** (credibility of your credential authority), **integrations/consumers**, **maintainer/sponsor attestations**, and **outcome history**. Ship the engine fast, accumulate trust slowly. Open-source the schema, SDK, verifier, and evidence spec; keep advanced detectors, calibration data, matching, and hosted workflows proprietary.

### 9.4 Distribution

Verified-applicant links inside sponsor listings; embeddable badges; Superteam chapter channels; Colosseum Discord; X share cards; hackathon cohort programs `[A]`.

### 9.5 Platform, legal, and privacy risks

- **Platform dependence:** GitHub API terms and rate limits; Earn dependence (mitigated by standalone mode and open verifier) `[?]`.
- **Privacy/reputation harm:** opt-in, positive-only, expiring; store minimal on-chain data; delete-on-request off-chain. Immutable chains and deletion rights conflict — hence only compact claims on-chain.
- **Defamation risk:** never publish negative or comparative claims about named people.
- **Model risk:** support multiple LLM providers; deterministic mode keeps the product alive without any model.

### 9.6 First 90 days after the hackathon

Days 1–30: 3 paying pilots + Earn conversation. Days 31–60: Solidity/Foundry pack, program dashboard. Days 61–90: Tier-2 attestations (maintainer/sponsor), public calibration report. If accepted to the accelerator, use it to fund the corpus and Tier-2 network; if not, Colosseum's ongoing **Eternal** competition is a fallback `[V — check availability]`.

---

## 10. Colosseum submission playbook

### 10.1 Judging map

| Criterion (official) | What judges want | Your proof | Asset |
|---|---|---|---|
| Functionality | Does it work? | Live judge-login preview; real attestations | Live demo, tests |
| Potential impact | TAM and ecosystem impact | Expansion ladder; honest Earn arithmetic; ecosystem primitive | Market slide |
| Novelty | Unique concept | Outcome-first evidence, abstention, on-chain gate, published validation | Comparison matrix (§4.1) |
| UX | Blockchain creating good downstream UX | Evidence-first UI, 60-second onboarding, badge | Demo |
| Open source | Open + composable | SDK, schema, verifier, gate program under a permissive license `[A]` | Repo |
| Business plan | Viable business + team can execute | Ladder, pricing tests, measured costs, team story | Deck |

**Startup factors from the FAQ** `[V]` and how you answer them: *founder–market fit* (your story), *insight* (§2.4/§5), *product + execution* (weekly updates, commit history), *market size* (§3.2 honestly), *communication* (videos), *viability* (§9), *traction* (§8).

### 10.2 Repo hygiene

- Commits show real work inside Sep 14–Oct 12; disclose **any** pre-existing code in the form `[V]`.
- README: problem, insight, why Solana, demo, architecture, evidence model, scoring model, anti-gaming, security, setup, testing, roadmap, license, **hackathon build log**.
- **Dogfood:** run Proof of Work on its own repo and show the evidence page. Colosseum checks that *you* did the work `[V]`; make your commit history easy to read.

### 10.3 Presentation video (2–3 min) — storyboard

| Time | Beat |
|---|---|
| 0:00–0:20 | Problem: curl closes its bounty; Earn now takes agent submissions; effort no longer filters |
| 0:20–0:45 | Solution in one sentence + product visual |
| 0:45–1:15 | Insight: outcomes over authorship; score + confidence; abstention |
| 1:15–1:40 | Solana: credential, on-chain verify, payout-wallet join, open SDK |
| 1:40–2:10 | Proof: usage numbers, back-test result, sponsor quotes |
| 2:10–2:35 | Business: wedge → ladder; who pays |
| 2:35–2:50 | Team, ask, close |

### 10.4 Demo video (≤ 3 min) — storyboard

1. (0:00) A listing with 60 look-alike applicants — the pain.
2. (0:15) Developer connects GitHub + wallet (real).
3. (0:30) Analysis progress → **evidence first**, then score + confidence; click "Why?"
4. (0:55) Thin-evidence case: **no credential issued**, with guidance.
5. (1:10) Mint SAS credential; open verify page; run SDK verify from a terminal with only RPC.
6. (1:35) Sponsor console: filter "Anchor ≥ 75, confidence ≥ 80" → invite; verified-applicant link.
7. (2:00) Claude/Cursor triages applicants through MCP with evidence-based explanations.
8. (2:20) Gate program: claim succeeds for verified wallet, fails for unverified.
9. (2:45) Numbers + next step.

### 10.5 Submission-form drafts (fill the brackets with real data)

- **One-liner:** "Proof of Work gives bounty sponsors, grant committees and hackathon judges a verifiable record of what a developer has actually shipped — evidence-checked, confidence-scored, and issued as a Solana credential any app can verify on-chain."
- **Insight:** "AI made plausible submissions free, so open programs are losing their effort filter (curl closed its bounty; Earn now accepts agent submissions). Track record is the replacement filter — and we measure it from outcomes, not authorship."
- **Why Solana:** SAS credentials, payout wallet as identity anchor, on-chain gate, open SDK.
- **Traction:** [N analyses, N credentials, N sponsor interviews, N listings with verify link, quotes].
- **Validation:** [ρ, AUC vs. baselines, n, limitations].
- **GTM:** verified-applicant links in sponsor listings → developers verify → sponsors query → repeat.

### 10.6 Interview prep — 12 hard questions

1. **Isn't this Talent Protocol?** See §4.2.
2. **Why do we need a blockchain?** Payout wallet is the identity anchor; programs and wallets read the credential directly; issuer allowlist makes trust explicit; expiry/revocation are native. Show the gate program.
3. **Your issuer is you — isn't that centralized?** Yes for v1. The verifier takes an issuer allowlist; schema is open; Tier-2/3 attestations and third-party issuers are the roadmap. Trust is explicit, not hidden.
4. **How do you know the score is valid?** Back-test vs. expert panel and baselines; here is what we found and where it fails.
5. **Can you detect AI-written code?** No, and we don't claim to. We measure acceptance, survival, and tests that reject bad input.
6. **How do you stop gaming?** We don't fully; outcome-based evidence, confidence, expiry, and skeptic checks raise the cost. Collusion and account renting are open problems, and here's the roadmap.
7. **Who pays, how much?** [Interview evidence]. Hypotheses: per-listing/monthly for sponsors; per-verification API for programs.
8. **Is Solana big enough?** Wedge only; here is the ladder to multi-chain and non-crypto programs.
9. **What if Earn builds this?** Then distribution succeeded; our verifier is open and our moat is evidence quality and issuer trust.
10. **Privacy?** Opt-in, positive-only, minimal on-chain data, delete-on-request off-chain.
11. **Why you?** [Founder story]. If solo: name your plan to add GTM/business support (Cofounder Matching exists `[V]`).
12. **What happens in 6 months?** Paid pilots, Solidity pack, Tier-2 attestations, calibration report.

### 10.7 Failure-mode checklist (test 48 hours before submission)

GitHub rate limit hit · devnet down · LLM provider outage · wallet adapter failure on judge's browser · empty-evidence account · non-Rust repo · very large repo · judge logs in with private-only repos. Each must show a **graceful state**, not an error.

---

## 11. Limitations register (and how each is overcome)

| # | Limitation | Impact | Mitigation | When |
|---|---|---|---|---|
| L1 | Crowded concept (Talent Protocol etc.) | Novelty score | Outcome-first + abstention + on-chain gate + published validation | Ongoing |
| L2 | Small Solana developer pool | Impact/TAM score | Expansion ladder; honest arithmetic; multi-chain roadmap | Deck by Oct 7 |
| L3 | Score validity unproven | Core credibility | Back-test vs. experts and baselines; pivot rule | Oct 2 |
| L4 | AI-written code can't be detected | Trust | Don't claim it; score outcomes | Design |
| L5 | Cold start (two-sided) | Traction | Single-player report; verified-applicant links; sponsor-driven pull | Week 1–2 |
| L6 | Small team, short window | Functionality | Tiered scope; cut order; gates | Now |
| L7 | Building Anchor repos is slow/risky | Live-demo failure | GitHub-native + static path; sandbox only for seeded repos | Week 1 |
| L8 | Earn integration uncertain | Demo credibility | Standalone console + verified-applicant link; never claim integration | Week 2 |
| L9 | Fiverr/Solana Jobs/Talent have no known import APIs `[?]` | Reach | Embeddable badge + verify URL works anywhere | Week 2 |
| L10 | Wallet↔GitHub binding weakness | Fraud | Signed message + public gist proof | Week 1 |
| L11 | Single issuer | "Why blockchain?" | Issuer allowlist; open schema; tiers | Week 2 |
| L12 | Collusion and account renting | Score integrity | Reviewer independence weighting; Tier-2 attestations; timed challenges later | Roadmap |
| L13 | Privacy and reputation harm | Ethics/legal | Opt-in, positive-only, expiry, minimal chain data | Design |
| L14 | Private repos not supported | Coverage | Read-only App on selected private repos, scores-only output (stretch) | Roadmap |
| L15 | LLM variance and cost | Reproducibility | LLM never scores; structured outputs; deterministic mode; measure cost | Week 2 |
| L16 | GitHub API limits/terms `[?]` | Availability | Caching, GitHub App rate limits, ToS review | Week 1 |
| L17 | SAS specifics unverified (types, fees, update/close) `[?]` | Design risk | Devnet spike on Day 1–2 | Sep 20 |
| L18 | Hackathon-window rule | Disqualification | Disclose pre-existing code; visible build log | Ongoing |
| L19 | Java/TS depth limited | Vision vs. scope | Light packs with capped confidence; say so | Stretch |
| L20 | Judges test with unsuitable repos | Demo failure | Abstention + graceful states | Oct 7 |

---

## 12. Open questions for you

Answer any of these in any order; I've listed the default I'll assume if you don't.

### P0 — changes the whole plan

1. **Team:** Are you solo, or do you have teammates? How many hours per week can each of you commit until Oct 11? *(Default: solo, ~20–25 hrs/week.)*
2. **Existing work:** Is there any code, prototype, or data you built **before Sep 14**? *(Must be disclosed; default: none.)*
3. **Access:** Do you personally know any Superteam members, Earn sponsors, or grant program managers who would take a 20-minute call this week? *(Default: no; cold outreach.)*
4. **Skills:** What are your strongest skills — Rust/Anchor, Java, TypeScript/Next.js, or design/business? *(Default: strongest in Java and web; Anchor-learning.)*

### P1 — shapes scope and pitch

5. **University Prize:** Which university, and are you enrolled now? *(Rules don't define eligibility; I'll email Colosseum wording with you.)*
6. **Product name:** Keep "Proof of Work," or use ProofMesh or another? *(Default: ProofMesh + tagline.)*
7. **Java:** Is the Java badge essential for your pitch, or is Solana/Anchor-first acceptable? *(Default: Anchor-first, Java light pack only if capacity allows.)*
8. **Chain for demo:** Are you comfortable minting on **mainnet** for the final demo if fees are small? *(Default: devnet, mainnet only if measured cost is trivial.)*
9. **Prize logistics:** Can you receive a stablecoin prize and pass due diligence/background checks? *(Rules state due diligence applies.)*
10. **Comfort on camera:** Will you appear on the presentation video? *(Default: yes; founder-market fit matters.)*

### P2 — polish

11. **License** for open-source parts (MIT/Apache-2.0)? *(Default: Apache-2.0.)*
12. **LLM budget** per month for analysis? *(Default: small; deterministic-first.)*
13. **Your own repos** to dogfood and to seed the back-test? *(Default: use whatever public repos you have.)*
14. **First 10 developers:** who could you invite personally this week? *(Default: friends and classmates with public repos.)*
15. **Long-term intent:** Do you want to run this as a company after the hackathon (accelerator path), or is this mainly a portfolio project? *(Default: company; it changes how we frame traction and team gaps.)*

---

## 13. Appendices

### Appendix A — Draft SAS schema (verify types and limits against the SAS docs first `[?]`)

```
Credential: "Proof of Work Issuer"          // authority key ≠ signer key
Schema:     pow.solana-anchor.v1            // one per skill pack; nonce = subject wallet
Fields:
  schema_version   : u8
  skill_score      : u8            // 0–100, shrunk by confidence
  confidence       : u8            // 0–100
  level            : u8            // 1=Verified 2=Strong 3=Expert
  issuer_tier      : u8            // 1=automated 2=maintainer/sponsor 3=multi-party
  evidence_root    : [u8;32]       // hash of snapshot evidence set
  analyzer_version : string        // e.g. "anchor-pack-0.3.1"
  report_uri       : string        // public evidence page
Expiry: now + 180 days
```

### Appendix B — MCP tool signatures (read-only)

```
get_verified_skills(wallet | github_handle) -> [{skill, level, score, confidence, expires_at, attestation}]
search_developers({skills[], min_score, min_confidence, min_tier, active_within_days, limit}) -> [candidate]
explain_evidence(credential_id) -> {dimensions[], top_evidence_items[], caveats[]}
verify_credential(attestation_address, {issuer_allowlist[]}) -> {valid, reason, checked_at}
triage_applicants(applicants[], requirement) -> [{applicant, fit, confidence, evidence_ids[], gaps[]}]
```

### Appendix C — 60-second weekly update template

"This week I shipped [X], learned [Y], and hit [Z]. Numbers: [analyses / credentials / interviews]. Next week: [top 2 priorities]. Blocker: [one]."

### Appendix D — Things I could not verify (do these first)

1. SAS field types, fees/rent, update vs. close-and-recreate, wallet display integrations.
2. Whether Earn payouts are traceable on-chain to a listing.
3. Earn's terms for overlays or scraping of applicant data.
4. Any integration surface for Fiverr, Solana Jobs, or Superteam Talent.
5. University Prize eligibility definition.
6. Latest Solana developer count (Electric Capital 2025/2026 data).
7. Solana ID wind-down and Solana Explorer MCP claims from your earlier docs.
8. Trademark/domain availability for the final name.
9. GitHub API terms for derived-score publication; LLM provider terms for code analysis.
10. Whether Sec3/other security tools' licenses allow use in your pipeline.

---

## 14. Sources and verification status

**Primary / official (fetched this session `[V]`)**
- Colosseum Crypto World's Fair page: https://colosseum.com/worldsfair (prizes, tracks, sponsors, judges)
- Official rules PDF: https://colosseum.com/legal/Crypto%20World's%20Fair%20Hackathon%20Rules.pdf (criteria, prizes, timing, eligibility)
- Colosseum hackathon FAQ: https://colosseum.com/hackathon (startup factors, submission requirements, Copilot, Eternal, cofounder matching, past editions)
- Solana Attestations docs: https://solana.com/docs/tools/attestations and https://attest.solana.com/
- Talent Protocol: https://talentprotocol.com
- Open Builder Score (ETHGlobal Lisbon 2026): https://ethglobal.com/showcase/builder-reputation-o6w8i
- Superteam Earn agents page: https://superteam.fun/earn/agents/ · repo: https://github.com/SuperteamDAO/earn

**Secondary `[R]` (re-check before quoting)**
- Earn agent API guide: https://gigs.sh/p/superteam-earn · Earn stats listing: https://madeonsol.com/tools/superteam-earn
- Trail of Bits Solana vulnerability patterns: https://trailofbits.com/skills/solana-vulnerability-scanner/
- AI-slop and curl bounty coverage: https://infoq.com/news/2026/02/ai-floods-close-projects · https://tianpan.co/blog/2026-07-02-your-agents-are-cheap-maintainer-attention-isnt · https://www.seuros.com/blog/opensourceshit-part-1-the-math-broke/ (find Stenberg's primary post before citing)
- Developer counts: Colosseum Codex (Electric Capital 2024 summary) https://blog.colosseum.com/electric-capital-developer-report-anza-research-2025-solana-events/ · Blockworks https://blockworks.com/news/electric-capital-report-solana-developers

**From your earlier documents (not independently verified `[?]`)**
SkillPassport, GitPOAP, VeriHire, PoWR, Solana Matcher, BountyGraph, CareerTWiN, Solana ID wind-down, Solana Explorer MCP launch.

*End of memo. If any assumption tagged `[A]` is wrong, tell me and I'll rework the affected sections.*
