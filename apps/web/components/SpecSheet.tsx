import Link from 'next/link';
import { DataCard } from './DataCard';

function SectionHeader({ n, title, right }: { n: string; title: string; right: string }) {
  return (
    <div className="flex items-baseline justify-between border-b border-paper-border/60 pb-2">
      <div className="flex items-center gap-2">
        <span className="font-mono text-xs font-semibold text-accent px-1.5 py-0.5 rounded bg-accent-subtle">{n}</span>
        <h2 className="text-sm font-semibold tracking-wide uppercase text-ink-muted font-mono">{title}</h2>
      </div>
      <span className="text-xs text-ink-muted font-mono">{right}</span>
    </div>
  );
}

export function SpecSheet() {
  return (
    <main className="relative z-10 max-w-6xl mx-auto px-6 py-12 space-y-16">
      <header className="border-b border-paper-border pb-8">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded bg-paper-card border border-paper-border mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
              <span className="font-mono text-xs uppercase tracking-wider font-semibold text-ink-muted">Design System v1.0 • Component Spec</span>
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-ink-primary">ProofMesh UI Foundation</h1>
            <p className="text-ink-secondary mt-1.5 text-base max-w-2xl">
              Scientific, reproducible verification primitives for GitHub cryptographic indexing and Solana-anchored credentials.
              Off-white warm paper, deep forest green keying, and high-legibility telemetry.
            </p>
          </div>
          <div className="flex items-center gap-2 p-2 bg-paper-surface border border-paper-border rounded-xl shadow-soft-card">
            <div className="flex items-center gap-1.5 pr-3 border-r border-paper-border">
              <div className="w-5 h-5 rounded bg-[#FAF9F6] border border-paper-border" title="Paper Background (#FAF9F6)"></div>
              <div className="w-5 h-5 rounded bg-[#F5F4F0] border border-paper-border" title="Card Surface (#F5F4F0)"></div>
              <div className="w-5 h-5 rounded bg-[#111413]" title="Ink Primary (#111413)"></div>
              <div className="w-5 h-5 rounded bg-[#1D5D3A]" title="Deep Green Accent (#1D5D3A)"></div>
            </div>
            <span className="font-mono text-[11px] text-ink-muted px-1.5">TOKENS LOCKED</span>
          </div>
        </div>
      </header>

      <section className="space-y-4">
        <SectionHeader n="01" title="Global Navigation Bar" right="Full-width desktop header pattern" />
        <div className="p-6 bg-paper-surface/60 border border-paper-border rounded-2xl">
          <header className="w-full bg-paper-surface/90 backdrop-blur-md border border-paper-border rounded-xl px-5 py-3.5 shadow-nav flex items-center justify-between">
            <div className="flex items-center gap-8">
              <Link href="/" className="flex items-center gap-2.5 group">
                <div className="w-8 h-8 rounded-lg bg-accent text-white flex items-center justify-center font-mono font-bold text-sm tracking-tighter shadow-sm group-hover:bg-accent-hover transition-colors">
                  <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                </div>
                <span className="font-bold text-lg tracking-tight text-ink-primary">
                  ProofMesh
                  <span className="text-accent font-mono font-normal text-xs ml-1.5 px-1.5 py-0.5 bg-accent-subtle rounded border border-accent-border">SOLANA</span>
                </span>
              </Link>
              <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-ink-secondary">
                <Link href="/verify" className="hover:text-ink-primary transition-colors flex items-center gap-1">Verification Protocol</Link>
                <Link href="/sponsors" className="hover:text-ink-primary transition-colors flex items-center gap-1">GitHub Index</Link>
                <Link href="/sponsors" className="hover:text-ink-primary transition-colors">Registry</Link>
                <Link href="/dev/components" className="hover:text-ink-primary transition-colors">Documentation</Link>
              </nav>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-md bg-paper-card border border-paper-border text-xs font-mono text-ink-muted">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span>DEVNET v2.4</span>
              </div>
              <Link
                href="/verify"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-xs font-semibold font-mono tracking-tight transition-all duration-150 shadow-button active:scale-[0.98]"
              >
                <span>CONNECT WALLET</span>
                <svg className="w-3.5 h-3.5 text-white/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </Link>
            </div>
          </header>
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader n="02" title="Primary Action Buttons" right="Deep green (#1D5D3A) • Precision interactive states" />
        <div className="p-8 bg-paper-surface/60 border border-paper-border rounded-2xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 items-center">
            <div className="space-y-2">
              <span className="font-mono text-[11px] text-ink-muted uppercase">Default State</span>
              <button className="w-full inline-flex items-center justify-center gap-2.5 px-5 py-2.5 rounded-lg bg-accent text-white text-sm font-medium tracking-tight shadow-button hover:bg-accent-hover transition-all">
                <span>Verify GitHub History</span>
                <svg className="w-4 h-4 text-white/90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </button>
            </div>
            <div className="space-y-2">
              <span className="font-mono text-[11px] text-ink-muted uppercase">Hover / Active</span>
              <button className="w-full inline-flex items-center justify-center gap-2.5 px-5 py-2.5 rounded-lg bg-accent-hover text-white text-sm font-medium tracking-tight shadow-md ring-2 ring-accent/20">
                <span>Verify GitHub History</span>
                <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </button>
            </div>
            <div className="space-y-2">
              <span className="font-mono text-[11px] text-ink-muted uppercase">Secondary / Ghost Option</span>
              <button className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-paper-surface border border-paper-border text-ink-primary hover:bg-paper-card text-sm font-medium tracking-tight transition-colors shadow-soft-card">
                <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
                <span>View On Solana</span>
              </button>
            </div>
            <div className="space-y-2">
              <span className="font-mono text-[11px] text-ink-muted uppercase">Scientific Compact</span>
              <button className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-accent-subtle border border-accent-border text-accent hover:bg-accent hover:text-white transition-all text-xs font-mono font-semibold">
                <span>RE-INDEX PROOF</span>
                <span className="text-xs">↗</span>
              </button>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader n="03" title="Data Card • Score & Verified Checkmark" right="Light gray card • Soft shadow • Scientific fidelity" />
        <div className="p-8 bg-paper-surface/60 border border-paper-border rounded-2xl flex justify-center">
          <DataCard
            title="Solana / Anchor SDK"
            repo="github.com/alexander-vance"
            score={94.1}
            confidence={99.1}
            metricA={{ label: 'Code Integrity (4,218 commits)', pct: 98 }}
            metricB={{ label: 'Peer Review Dispersion', pct: 92 }}
            walletTag="solana:7xGq...DwzF3"
            href="/verify/7xGqYtRZLJ4XZiQn69NCHsWkY1mTVMLqmLX4m3md8DwzF3/solana-anchor"
          />
        </div>
      </section>

      <section className="space-y-4">
        <SectionHeader n="04" title="Scientific Text Block" right="Typographic hierarchy inspired by Alethia" />
        <div className="p-8 sm:p-10 bg-paper-surface/60 border border-paper-border rounded-2xl">
          <div className="max-w-2xl space-y-4">
            <div className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-accent font-semibold">
              <span>[ PROTOCOL VERIFICATION CRITERIA ]</span>
            </div>
            <h3 className="text-2xl sm:text-3xl font-bold tracking-tight text-ink-primary leading-snug">
              Deterministic developer reputation, anchored directly into consensus.
            </h3>
            <p className="text-ink-secondary text-base leading-relaxed">
              ProofMesh continuously crawls commit histories, peer-reviewed pull requests, and repository entropy to formulate
              an unforgeable index of authentic developer contributions. Every metric is computed off-chain with deterministic
              Zero-Knowledge circuits and permanently validated as an SPL state attestation on the Solana ledger.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-paper-card border border-paper-border">
                <span className="font-mono text-xs font-bold text-accent mt-0.5">01.</span>
                <div className="text-xs">
                  <span className="font-semibold text-ink-primary block">Zero Historical Tampering</span>
                  <span className="text-ink-muted">Cryptographic signature check against GPG author keys.</span>
                </div>
              </div>
              <div className="flex items-start gap-2.5 p-3 rounded-lg bg-paper-card border border-paper-border">
                <span className="font-mono text-xs font-bold text-accent mt-0.5">02.</span>
                <div className="text-xs">
                  <span className="font-semibold text-ink-primary block">Instant Sub-second Verification</span>
                  <span className="text-ink-muted">Sub-cent micro-transactions anchored directly on Solana.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="pt-6 border-t border-paper-border flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-mono text-ink-muted">
        <div>
          <span>PROOFMESH SPEC • WARM PAPER (#FAF9F6) • DEEP FOREST (#1D5D3A) • INK (#111413)</span>
        </div>
        <div>
          <span>READY FOR FULL SCREEN ASSEMBLY</span>
        </div>
      </footer>
    </main>
  );
}