import { PIPELINE_META } from '../lib/constants';
import { PIPELINE_STAGES } from '@proofmesh/shared-types';

/** Landing pipeline section — the real 7-stage deterministic pipeline. */
export function Pipeline() {
  const stages = PIPELINE_STAGES.map((stage, i) => ({
    n: String(i + 1).padStart(2, '0'),
    label: PIPELINE_META[stage].label,
    tag: PIPELINE_META[stage].tag,
    blurb: PIPELINE_META[stage].blurb
  }));
  return (
    <section id="pipeline" className="bg-paper text-ink grid-bg py-20 px-0 sm:px-8">
      <main className="max-w-5xl mx-auto w-full">
        <div className="mb-14">
          <div className="inline-flex items-center gap-2 px-3 py-1 bg-white border border-border-subtle rounded-md mb-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <span className="w-1.5 h-1.5 rounded-full bg-forest"></span>
            <span className="font-mono text-xs text-forest tracking-wider uppercase font-medium">[ EVIDENCE PIPELINE SPECIFICATION ]</span>
          </div>
          <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-ink">
            Cryptographic verification in seven deterministic stages.
          </h2>
        </div>

        <div className="border-t border-border-subtle divide-y divide-border-subtle">
          {stages.map((s) => (
            <div
              key={s.n}
              className="py-10 md:py-12 flex flex-col md:flex-row md:items-baseline gap-6 md:gap-16 group transition-colors duration-200"
            >
              <div className="w-24 shrink-0 font-mono text-xl md:text-2xl text-forest font-semibold tracking-tight">{s.n}</div>
              <div className="max-w-3xl flex-1">
                <h3 className="text-xl md:text-2xl font-bold text-ink tracking-tight mb-2 flex items-center gap-3">
                  {s.label}
                  <span className="font-mono text-[11px] font-normal text-ink-light px-2 py-0.5 rounded bg-forest-light/60 text-forest border border-forest/10">
                    {s.tag}
                  </span>
                </h3>
                <p className="text-base md:text-lg text-ink-muted leading-relaxed font-normal">{s.blurb}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-16 pt-6 border-t border-border-subtle flex items-center justify-between font-mono text-xs text-ink-light">
          <div className="flex items-center gap-2">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-forest"></span>
            <span>PROOF-SPEC // STAGES 01-07 VERIFIED</span>
          </div>
          <span>DETERMINISTIC CONSENSUS ENGINE</span>
        </div>
      </main>
    </section>
  );
}