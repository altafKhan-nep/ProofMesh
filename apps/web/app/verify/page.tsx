import { PROGRAM_ID } from '@proofmesh/shared-types';
import { GlobalHeader } from '../../components/GlobalHeader';
import { GlobalFooter } from '../../components/GlobalFooter';
import { VerifyFlow } from '../../components/VerifyFlow';
import { BadgeExample } from '../../components/BadgeExample';

const shortProgram = `${PROGRAM_ID.slice(0, 6)}…${PROGRAM_ID.slice(-4)}`;

export default function VerifyPage() {
  return (
    <div className="flex flex-col min-h-screen">
      <GlobalHeader />
      <main className="flex-1 w-full max-w-7xl mx-auto px-6 py-12 sm:py-16">
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-10 mb-12">
          <div className="flex flex-col gap-4 max-w-2xl">
            <div className="inline-flex w-fit items-center gap-2 px-3 py-1 rounded-full bg-surface-container border border-border-subtle">
              <span className="w-1.5 h-1.5 rounded-full bg-verified-dot animate-pulse"></span>
              <span className="font-label-mono-tag text-text-secondary uppercase tracking-wider text-[11px]">
                GET VERIFIED — PROOF PIPELINE
              </span>
            </div>
            <h1 className="font-headline-lg text-3xl sm:text-4xl text-text-primary tracking-tight font-medium leading-tight">
              Prove the work behind an identity — on-chain.
            </h1>
            <p className="font-body-lg text-body-lg text-text-secondary leading-relaxed">
              Point the pipeline at a real GitHub identity and a skill.
              ProofMesh pulls read-only evidence, scores it against the reference
              corpus, and streams every stage live — reviewer pass, skeptic pass,
              and the on-chain credential check.
            </p>
            <div className="flex items-center gap-x-5 gap-y-1.5 font-label-mono-tag text-[11px] text-text-muted flex-wrap mt-1">
              <span>
                PROGRAM <span className="text-text-secondary select-all">{shortProgram}</span>
              </span>
              <span aria-hidden className="text-border-strong">/</span>
              <span>SOLANA DEVNET</span>
              <span aria-hidden className="text-border-strong">/</span>
              <span>7-STAGE PIPELINE</span>
              <span aria-hidden className="text-border-strong">/</span>
              <span>NO LLM</span>
            </div>
          </div>

          <div className="flex flex-col gap-2.5 flex-shrink-0">
            <span className="font-label-caps text-[10px] text-text-muted uppercase tracking-wider">
              LIVE EMBEDDABLE BADGE — /api/badge/:wallet/:skill.svg
            </span>
            <BadgeExample />
          </div>
        </div>

        <VerifyFlow />
      </main>
      <GlobalFooter />
    </div>
  );
}