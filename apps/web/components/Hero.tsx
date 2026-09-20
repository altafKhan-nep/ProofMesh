import Link from 'next/link';
import { EvidenceGraph } from './EvidenceGraph';

const MICRO_STATS = [
  { label: 'Attested Devs', value: '18,429' },
  { label: 'Entropy Check', value: '99.8%' },
  { label: 'Avg Execution', value: '3.2 min', accent: true }
];

export function Hero() {
  return (
    <section className="relative w-full overflow-hidden bg-surface py-16 lg:py-20">
      <div className="absolute inset-0 pointer-events-none opacity-[0.035] [background-image:linear-gradient(to_right,#111413_1px,transparent_1px),linear-gradient(to_bottom,#111413_1px,transparent_1px)] [background-size:28px_28px]"></div>
      <div className="absolute -top-32 right-1/4 w-96 h-96 bg-primary-fixed/25 rounded-full blur-3xl pointer-events-none -z-10"></div>

      <div className="max-w-7xl mx-auto px-6 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-12 items-center">
          <div className="lg:col-span-6 flex flex-col justify-center">
            <div className="inline-flex items-center gap-2 self-start bg-badge-green-bg px-2 py-1 rounded-full mb-6 shadow-sm">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-verified-dot opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-verified-dot"></span>
              </span>
              <span className="font-label-mono-tag text-[11px] text-badge-green-text uppercase tracking-wider">
                [ CONTINUOUS DEVELOPER VERIFICATION ]
              </span>
            </div>

            <h1 className="font-display text-4xl lg:text-[56px] leading-[1.08] tracking-tight text-text-primary font-medium mb-4">
              Prove what you&apos;ve built.
              <br />
              <span className="text-primary-container">Get verified</span> in 5 minutes.
            </h1>

            <p className="font-body-lg text-body-lg text-text-secondary max-w-xl mb-8 leading-relaxed">
              ProofMesh deterministically evaluates your GitHub commit history, peer reviews, and code integrity
              to issue an unforgeable skill credential anchored on Solana.
            </p>

            <div className="flex flex-col gap-4 mb-4">
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/verify"
                  className="inline-flex items-center justify-center gap-2 bg-primary-container hover:bg-tertiary text-on-primary font-headline-sm text-md px-5 py-2.5 rounded-lg transition-all shadow-[0_1px_2px_rgba(0,0,0,0.08),0_4px_16px_-2px_rgba(29,93,58,0.25)] active:scale-[0.99] group"
                >
                  <svg aria-hidden="true" className="w-4 h-4 fill-current transition-transform group-hover:scale-105" viewBox="0 0 24 24">
                    <path clipRule="evenodd" fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"></path>
                  </svg>
                  <span>Get Started with GitHub</span>
                  <span className="font-label-code text-[12px] transition-transform group-hover:translate-x-1">→</span>
                </Link>
                <Link
                  href="/dev/components"
                  className="inline-flex items-center justify-center gap-2 bg-surface-card hover:bg-surface-subtle text-text-primary font-body-md text-md px-4 py-2.5 rounded-lg transition-colors shadow-sm"
                >
                  <span>View Sol Spec</span>
                </Link>
              </div>

              <div className="flex items-center gap-2 font-label-mono-tag text-[11px] text-text-muted mt-1 flex-wrap">
                <span>Zero-knowledge verification</span>
                <span className="text-text-muted/60">•</span>
                <span>No write permissions required</span>
                <span className="text-text-muted/60">•</span>
                <span className="text-badge-green-text font-medium">100% on-chain proof</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-8 max-w-lg mt-1">
              {MICRO_STATS.map((s) => (
                <div key={s.label} className="bg-surface-card rounded-lg p-2 shadow-sm">
                  <div className="font-label-caps text-[10px] text-text-muted uppercase">{s.label}</div>
                  <div className={`font-headline-sm text-[18px] text-text-primary font-medium mt-0.5 ${s.accent ? 'text-primary-container' : ''}`}>
                    {s.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-6 flex flex-col items-center justify-center w-full">
            <div className="w-full max-w-xl bg-surface-card rounded-xl p-2 sm:p-3 shadow-[0_2px_12px_rgba(17,20,19,0.04),0_12px_36px_-6px_rgba(17,20,19,0.06)] relative group">
              <div className="w-full flex items-center justify-between px-2 py-1 bg-surface-subtle rounded-lg mb-1">
                <div className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-verified-dot animate-pulse"></span>
                  <span className="font-label-mono-tag text-[11px] text-badge-green-text tracking-wider uppercase">SYNAPSE-GRAPH-RESOLVER</span>
                </div>
                <span className="font-label-code text-[12px] text-text-muted">SOLANA-EPOCH-692</span>
              </div>
              <div className="relative w-full overflow-hidden rounded-lg bg-surface">
                <EvidenceGraph score={94.1} confidence={99.1} walletTag="solana:8xPt...3k9L" />
              </div>
              <div className="w-full flex items-center justify-between pt-2 px-1">
                <span className="font-label-mono-tag text-[11px] text-text-muted tracking-widest uppercase">
                  FIGURE 01: GRAPH RESOLUTION TO ON-CHAIN CREDENTIAL SHAPE
                </span>
                <div className="flex items-center gap-1 bg-badge-green-bg px-1 py-0.5 rounded">
                  <span className="w-1.5 h-1.5 rounded-full bg-verified-dot"></span>
                  <span className="font-label-caps text-[10px] text-badge-green-text uppercase font-semibold">STATE: VERIFIED</span>
                </div>
              </div>
            </div>
            <div className="w-full max-w-xl flex items-center justify-between mt-2 px-1 font-label-mono-tag text-[11px] text-text-muted">
              <span>INPUT: GIT_TREE_HASH(SHA-256)</span>
              <span>PROOF-CIRCUIT: GROTH16_SOL</span>
              <span>STATUS: FINALIZED</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}