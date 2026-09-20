/**
 * The Exemplar Data Card — primary card spec from the Stitch component spec
 * sheet (section 03). Data-driven so it renders real attestation output.
 */
interface DataCardProps {
  title: string;
  repo: string;
  score: number;
  confidence: number;
  verified?: boolean;
  metricA: { label: string; pct: number };
  metricB: { label: string; pct: number };
  walletTag: string;
  href: string;
}

export function DataCard({
  title,
  repo,
  score,
  confidence,
  verified = true,
  metricA,
  metricB,
  walletTag,
  href
}: DataCardProps) {
  return (
    <article className="w-full max-w-md bg-paper-card border border-border-subtle rounded-2xl p-6 shadow-soft-card hover:shadow-card-hover transition-all duration-200">
      <div className="flex items-start justify-between gap-4 pb-5 border-b border-border-subtle">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-paper-surface border border-border-subtle flex items-center justify-center text-ink-primary shadow-xs">
            <svg className="w-5 h-5 text-ink-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="6" y1="3" x2="6" y2="15"></line>
              <circle cx="18" cy="6" r="3"></circle>
              <circle cx="6" cy="18" r="3"></circle>
              <path d="M18 9a9 9 0 0 1-9 9"></path>
            </svg>
          </div>
          <div>
            <h3 className="font-semibold text-base text-ink-primary tracking-tight">{title}</h3>
            <p className="font-mono text-xs text-ink-muted">{repo}</p>
          </div>
        </div>

        {verified ? (
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-accent-subtle border border-accent-border text-accent font-mono text-xs font-semibold">
            <svg className="w-3.5 h-3.5 stroke-[2.5]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"></path>
            </svg>
            <span>VERIFIED</span>
          </div>
        ) : (
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-surface-container border border-border-strong text-text-muted font-mono text-xs font-semibold">
            <span>NO CREDENTIAL</span>
          </div>
        )}
      </div>

      <div className="py-6 space-y-4">
        <div className="flex items-baseline justify-between">
          <div>
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-muted font-medium block">Aggregated Skill Score</span>
            <div className="flex items-baseline gap-1.5 mt-1">
              <span className="text-4xl font-bold font-mono tracking-tight text-ink-primary">{score.toFixed(1)}</span>
              <span className="font-mono text-sm text-ink-muted">/100</span>
            </div>
          </div>
          <div className="text-right">
            <span className="font-mono text-[11px] uppercase tracking-wider text-ink-muted font-medium block">Confidence</span>
            <div className="inline-flex items-center gap-1.5 mt-1 px-2 py-0.5 rounded bg-paper-surface border border-paper-border">
              <span className="w-1.5 h-1.5 rounded-full bg-accent"></span>
              <span className="font-mono text-sm font-semibold text-ink-primary">{confidence.toFixed(1)}%</span>
            </div>
          </div>
        </div>

        {[metricA, metricB].map((m) => {
          const pct = Math.round(m.pct);
          return (
            <div key={m.label} className="space-y-2 pt-2">
              <div className="flex justify-between text-xs font-mono text-ink-muted">
                <span>{m.label}</span>
                <span className="text-ink-primary font-medium">{pct}%</span>
              </div>
              <div className="w-full h-1.5 bg-paper-border rounded-full overflow-hidden">
                <div className="h-full bg-accent rounded-full" style={{ width: `${pct}%` }}></div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="pt-4 border-t border-paper-border flex items-center justify-between text-xs font-mono">
        <div className="flex items-center gap-1.5 text-ink-muted">
          <span className="w-2 h-2 rounded-full bg-accent"></span>
          <span className="truncate max-w-[170px]" title={walletTag}>{walletTag}</span>
        </div>
        <a href={href} className="text-accent hover:text-accent-hover font-semibold inline-flex items-center gap-1 transition-colors">
          <span>EXPLORE PROOF</span>
          <span>↗</span>
        </a>
      </div>
    </article>
  );
}