import Link from 'next/link';

const PROGRAM_ID = 'ProofMeshIssuer111111111111111111111111111';

function short(id: string, head = 6, tail = 4): string {
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}

/** Contextual protocol summary card — mirror of the Stitch "Deterministic proof" card. */
export function ProtocolCard() {
  return (
    <section className="w-full py-12 lg:py-16 bg-surface-base">
      <main className="flex-1 max-w-7xl mx-auto w-full px-6 flex flex-col justify-center">
        <div className="relative overflow-hidden rounded-lg border border-border-subtle bg-surface-card p-8 sm:p-12">
          <div className="absolute -right-16 -top-16 w-80 h-80 bg-badge-green-bg/50 rounded-full blur-3xl pointer-events-none"></div>
          <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
            <span className="font-label-caps text-xs tracking-widest text-primary-container bg-badge-green-bg border border-badge-green-border px-2.5 py-1 rounded">
              DECENTRALIZED WORK ATTESTATION NODE // SOL-09
            </span>
            <span className="font-label-code text-xs text-text-muted">BLOCK: #298,401,982 · EPOCH 624</span>
          </div>
          <h1 className="font-headline-lg text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight text-text-primary max-w-3xl mb-4">
            Deterministic proof of engineering contribution.
          </h1>
          <p className="font-body-lg text-text-secondary max-w-2xl text-base sm:text-lg mb-8">
            ProofMesh anchors git commit integrity, PR consensus hashes, and deterministic peer-review proofs directly
            onto the Solana state engine. Zero-knowledge verifiable credential output for autonomous engineering capital.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 border-t border-border-subtle font-label-code text-xs text-text-secondary">
            <div>
              <span className="text-text-muted block mb-1 uppercase tracking-wider font-label-caps text-[10px]">PROGRAM ID</span>
              <span className="font-mono text-text-primary select-all">{short(PROGRAM_ID)}</span>
            </div>
            <div>
              <span className="text-text-muted block mb-1 uppercase tracking-wider font-label-caps text-[10px]">TOTAL COMMIT PROOFS</span>
              <span className="font-mono text-text-primary">18,429,910 SHA-256</span>
            </div>
            <div>
              <span className="text-text-muted block mb-1 uppercase tracking-wider font-label-caps text-[10px]">SETTLEMENT FINALITY</span>
              <span className="font-mono text-badge-green-text flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-verified-dot"></span> 412ms deterministic
              </span>
            </div>
          </div>

          <div className="mt-8">
            <Link
              href="/verify"
              className="inline-flex items-center justify-center gap-2 bg-primary-container hover:bg-tertiary text-on-primary text-sm font-medium px-5 py-2.5 rounded-lg transition-all shadow-[0_1px_2px_rgba(0,0,0,0.08),0_4px_16px_-2px_rgba(29,93,58,0.25)] active:scale-[0.99]"
            >
              <span>Run your proof run</span>
              <span>→</span>
            </Link>
          </div>
        </div>
      </main>
    </section>
  );
}