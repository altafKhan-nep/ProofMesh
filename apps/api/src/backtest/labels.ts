/**
 * Validation back-test ground truth (ARCHITECTURE.md §13 / BUILD_PROMPT §12).
 *
 * N = 62 real GitHub accounts: 25 established open-source maintainers (the
 * candidate pool ProofMesh is built for) plus 37 accounts that MUST abstain.
 *
 * The negative class is deliberately stratified and weighted toward HARD
 * negatives — framework/vendor orgs with green CI, release cadence and star
 * volume (exactly the signals the engine rewards), automation accounts, and
 * course/template publishers. Rationale: with only 3 confidence-eligible
 * negatives, measured precision was not statistically stable; precision is only
 * meaningful against adversaries that look like strong candidates.
 *
 * `confidence` marks how sure the label is:
 *   - high       → a maintainer-reviewer would almost certainly issue here
 *   - provisional→ the direction is strong but the profile mix could argue either way
 *
 * Skill choice follows the account's dominant language so coverage is fair.
 * SkillId is limited to the three shipped analyzers (typescript / java /
 * solana-anchor where `rust` is the coverage target).
 */
export interface BacktestLabel {
  handle: string;
  skill: 'typescript' | 'java' | 'solana-anchor';
  /** true  → this developer *should* receive a credential for the skill. */
  positive: boolean;
  confidence: 'high' | 'provisional';
  rationale: string;
}

export const LABELS: BacktestLabel[] = [
  // ---- TypeScript / JavaScript maintainers (positive) ---------------------
  { handle: 'sindresorhus', skill: 'typescript', positive: true, confidence: 'high', rationale: 'Most prolific TS OSS author in the ecosystem (hundreds of maintained packages).' },
  { handle: 'kentcdodds', skill: 'typescript', positive: true, confidence: 'high', rationale: 'React/testing-library author, sustained multi-year TS output.' },
  { handle: 'developit', skill: 'typescript', positive: true, confidence: 'high', rationale: 'Preact creator; deep, star-heavy TS/JS library history.' },
  { handle: 'paulirish', skill: 'typescript', positive: true, confidence: 'high', rationale: 'Chrome DevTools / Lighthouse; sustained web-platform engineering.' },
  { handle: 'gaearon', skill: 'typescript', positive: true, confidence: 'high', rationale: 'React core; sustained multi-year JS/TS contribution volume.' },
  { handle: 'sebmarkbage', skill: 'typescript', positive: true, confidence: 'high', rationale: 'React core (reconciler); long, high-impact JS/TS history.' },
  { handle: 'rich-harris', skill: 'typescript', positive: true, confidence: 'high', rationale: 'Svelte and Rollup creator; TS-native projects.' },
  { handle: 'addyosmani', skill: 'typescript', positive: true, confidence: 'high', rationale: 'Chrome / web tooling; high and durable OSS output.' },
  { handle: 'voxpelli', skill: 'typescript', positive: true, confidence: 'high', rationale: 'Node/TS ecosystem maintainer, consistent release history.' },
  { handle: 'feross', skill: 'typescript', positive: true, confidence: 'high', rationale: 'standardjs, webtorrent; JS ecosystem core.' },
  { handle: 'wesbos', skill: 'typescript', positive: true, confidence: 'provisional', rationale: 'High-profile JS/TS educator; mainline output is course/learning repos.' },
  { handle: 'ironaddicteddog', skill: 'typescript', positive: true, confidence: 'provisional', rationale: 'Anchor/Solana learn-by-doing repos; mostly TS, tutorial-leaning.' },

  // ---- Rust maintainers (solana-anchor coverage = rust) -------------------
  { handle: 'BurntSushi', skill: 'solana-anchor', positive: true, confidence: 'high', rationale: 'ripgrep / regex / csv; canonical Rust library work.' },
  { handle: 'dtolnay', skill: 'solana-anchor', positive: true, confidence: 'high', rationale: 'serde, syn, proc-macro ecosystem; elite Rust output.' },
  { handle: 'seanmonstar', skill: 'solana-anchor', positive: true, confidence: 'high', rationale: 'hyper / reqwest; core Rust web libraries.' },
  { handle: 'pcwalton', skill: 'solana-anchor', positive: true, confidence: 'high', rationale: 'Servo / rustc / SpiderMonkey background; deep Rust history.' },
  { handle: 'aturon', skill: 'solana-anchor', positive: true, confidence: 'high', rationale: 'Rust core team, rayon etc; sustained Rust work.' },
  { handle: 'nikomatsakis', skill: 'solana-anchor', positive: true, confidence: 'provisional', rationale: 'rustc core; the rust-lang contribution happens in the org (not this account).' },

  // ---- Solana core engineers (rust → solana-anchor) -----------------------
  { handle: 'aeyakovenko', skill: 'solana-anchor', positive: true, confidence: 'high', rationale: 'Solana co-founder; deep Rust validator work.' },
  { handle: 'mvines', skill: 'solana-anchor', positive: true, confidence: 'high', rationale: 'Solana Labs; sustained Rust protocol work.' },
  { handle: 'trentsol', skill: 'solana-anchor', positive: true, confidence: 'high', rationale: 'Solana ecosystem; long Rust history.' },
  { handle: 'danenbm', skill: 'solana-anchor', positive: true, confidence: 'provisional', rationale: 'Solana Labs; real Rust work but moderate public volume.' },

  // ---- Java maintainers (positive) ----------------------------------------
  { handle: 'cowtowncoder', skill: 'java', positive: true, confidence: 'high', rationale: 'Jackson core maintainer; decades of sustained Java OSS.' },
  { handle: 'joshlong', skill: 'java', positive: true, confidence: 'high', rationale: 'Spring team; high sustained Java output.' },
  { handle: 'akarnokd', skill: 'java', positive: true, confidence: 'high', rationale: 'RxJava / reactive-streams internals; deep Java OSS.' },

  // ---- Must abstain (negative) --------------------------------------------
  { handle: 'octocat', skill: 'solana-anchor', positive: false, confidence: 'high', rationale: "GitHub's placeholder account; no sustained expert evidence." },
  { handle: 'githubteacher', skill: 'typescript', positive: false, confidence: 'high', rationale: 'GitHub training automation account, not an individual developer.' },
  { handle: 'actions', skill: 'typescript', positive: false, confidence: 'high', rationale: 'GitHub Actions org — org account, no personal developer credential.' },
  { handle: 'dependabot', skill: 'typescript', positive: false, confidence: 'high', rationale: 'Automation/bot account producing machine activity, no personal credential.' },
  { handle: 'microsoft', skill: 'typescript', positive: false, confidence: 'provisional', rationale: 'Org account — activity is corporate, not a personal developer credential.' },

  // ---- Negative class, round-3 widening -----------------------------------
  // The first five negatives left precision resting on 3 confidence-eligible
  // samples, which is not measurable. These are deliberately HARD negatives:
  // framework/vendor orgs whose public output (green CI, release cadence, star
  // volume, test suites) satisfies exactly the signals the engine rewards, plus
  // automation accounts and course/template publishers. None of them is an
  // individual developer credential, so none should ever be issued.

  // Hard negatives — TypeScript framework/vendor orgs
  { handle: 'vercel', skill: 'typescript', positive: false, confidence: 'high', rationale: 'Framework vendor org (Next.js); corporate output, not a personal credential.' },
  { handle: 'withastro', skill: 'typescript', positive: false, confidence: 'high', rationale: 'Framework vendor org; strong CI/releases but no individual owner.' },
  { handle: 'sveltejs', skill: 'typescript', positive: false, confidence: 'high', rationale: 'Framework vendor org; corporate maintenance account.' },
  { handle: 'vuejs', skill: 'typescript', positive: false, confidence: 'high', rationale: 'Framework vendor org; corporate maintenance account.' },
  { handle: 'angular', skill: 'typescript', positive: false, confidence: 'high', rationale: 'Framework vendor org; corporate maintenance account.' },
  { handle: 'nestjs', skill: 'typescript', positive: false, confidence: 'high', rationale: 'Framework vendor org; corporate maintenance account.' },
  { handle: 'axios', skill: 'typescript', positive: false, confidence: 'high', rationale: 'Library vendor org; single-maintainer-shaped output owned by a company.' },
  { handle: 'jestjs', skill: 'typescript', positive: false, confidence: 'high', rationale: 'Test-framework org; corporate maintenance account.' },
  { handle: 'electron', skill: 'typescript', positive: false, confidence: 'high', rationale: 'Desktop platform org; corporate maintenance account.' },
  { handle: 'vitejs', skill: 'typescript', positive: false, confidence: 'high', rationale: 'Build-tool org; corporate maintenance account.' },
  { handle: 'rollup', skill: 'typescript', positive: false, confidence: 'high', rationale: 'Build-tool org; corporate maintenance account.' },
  { handle: 'webpack', skill: 'typescript', positive: false, confidence: 'high', rationale: 'Build-tool org; corporate maintenance account.' },
  { handle: 'nodejs', skill: 'typescript', positive: false, confidence: 'high', rationale: 'Runtime foundation org; corporate/governance-owned.' },
  { handle: 'netlify', skill: 'typescript', positive: false, confidence: 'high', rationale: 'Platform vendor org; corporate output.' },
  { handle: 'cloudflare', skill: 'typescript', positive: false, confidence: 'high', rationale: 'Infrastructure vendor org; corporate output.' },
  { handle: 'facebook', skill: 'typescript', positive: false, confidence: 'provisional', rationale: 'Corporate monorepo org; enormous volume but no individual credential.' },

  // Hard negatives — Java orgs
  { handle: 'spring-projects', skill: 'java', positive: false, confidence: 'high', rationale: 'Framework foundation org; corporate/governance-owned Java output.' },
  { handle: 'openjdk', skill: 'java', positive: false, confidence: 'high', rationale: 'JDK project org; corporate/governance-owned.' },
  { handle: 'elastic', skill: 'java', positive: false, confidence: 'provisional', rationale: 'Vendor org with large Java surface; corporate output.' },

  // Hard negatives — Rust / Solana orgs (directly on the solana-anchor coverage target)
  { handle: 'rust-lang', skill: 'solana-anchor', positive: false, confidence: 'high', rationale: 'Language foundation org; canonical Rust but not a personal credential.' },
  { handle: 'solana-labs', skill: 'solana-anchor', positive: false, confidence: 'high', rationale: 'Protocol vendor org — the org that sponsors Solana work, not an individual engineer.' },
  { handle: 'denoland', skill: 'solana-anchor', positive: false, confidence: 'high', rationale: 'Language/runtime org; corporate/governance-owned Rust.' },
  { handle: 'hashicorp', skill: 'solana-anchor', positive: false, confidence: 'provisional', rationale: 'Infrastructure vendor org; corporate Rust output.' },
  { handle: 'kubernetes', skill: 'solana-anchor', positive: false, confidence: 'provisional', rationale: 'Foundation org; corporate/governance-owned.' },

  // Automation / bot accounts
  { handle: 'renovatebot', skill: 'typescript', positive: false, confidence: 'high', rationale: 'Dependency-update bot; machine-authored commits only.' },
  { handle: 'codecov', skill: 'typescript', positive: false, confidence: 'high', rationale: 'Coverage bot account; automated PRs and comments.' },
  { handle: 'coveralls', skill: 'typescript', positive: false, confidence: 'high', rationale: 'CI/coverage bot account; automated activity.' },
  { handle: 'imgbot', skill: 'typescript', positive: false, confidence: 'high', rationale: 'Image-optimization bot; automated commits.' },

  // Course / template publishers (individual accounts, but not engineering credentials)
  { handle: 'freeCodeCamp', skill: 'typescript', positive: false, confidence: 'high', rationale: 'Course publisher org; tutorial curriculum, not personal OSS maintenance.' },
  { handle: 'exercism', skill: 'typescript', positive: false, confidence: 'high', rationale: 'Exercise-platform org; curriculum repos, not personal engineering.' },
  { handle: 'jwasham', skill: 'typescript', positive: false, confidence: 'provisional', rationale: 'Course/bootcamp publisher; interview-prep tutorials rather than production OSS.' },
];