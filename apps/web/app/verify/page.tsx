import { GlobalHeader } from '../../components/GlobalHeader';
import { GlobalFooter } from '../../components/GlobalFooter';
import { VerifyFlow } from '../../components/VerifyFlow';

export default function VerifyPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <GlobalHeader />
      <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-14">
        <div className="flex flex-col gap-3 mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-container-low border border-border-subtle shadow-sm self-start">
            <span className="w-2 h-2 rounded-full bg-verified-dot animate-pulse"></span>
            <span className="font-label-mono-tag text-text-secondary uppercase tracking-wider text-xs">
              [ GET VERIFIED — DETERMINISTIC PROOF PIPELINE ]
            </span>
          </div>
          <h1 className="font-headline-lg text-3xl sm:text-4xl text-text-primary tracking-tight font-medium max-w-2xl leading-tight">
            Run the proof pipeline against a GitHub identity.
          </h1>
          <p className="font-body-lg text-body-lg text-text-secondary max-w-2xl leading-relaxed">
            Pick a developer and skill. ProofMesh snapshots read-only evidence, scores it against the reference corpus,
            and streams every stage — reviewer pass, skeptic pass, and on-chain credential check — live over SSE.
          </p>
        </div>

        <VerifyFlow />

        <div className="w-full max-w-6xl mx-auto mt-14 p-6 rounded-xl border border-border-subtle bg-surface-card shadow-soft-card">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="font-label-caps text-[10px] text-text-muted uppercase tracking-wider mb-1">EMBEDDABLE BADGE</div>
              <p className="font-label-code text-xs text-text-secondary max-w-lg">
                Any issued credential exposes a tamper-resistant SVG badge at{' '}
                <span className="text-text-primary select-all">/api/badge/:wallet/:skill.svg</span> — drop it in a README, site, or sponsorship listing.
              </p>
            </div>
            <img
              alt="ProofMesh credential badge"
              width={320}
              height={96}
              src={`${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/api/badge/ZQqgH8VYSs5HYWCvL25cGpafy3aSnUeWPmSrY2nyEeF/solana-anchor.svg`}
              className="rounded-lg border border-border-subtle bg-surface-card"
            />
          </div>
        </div>
      </main>
      <GlobalFooter />
    </div>
  );
}