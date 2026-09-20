import Link from 'next/link';

const solutions = ['GitHub Commit Attestation', 'Peer Review Consensus', 'Enterprise Verification', 'Maintainer Grants', 'ZK Reputation Proofs'];
const company = ['Protocol Overview', 'Security Audits & CVEs', 'Research & Whitepaper', 'Careers', 'Press & Media Kit'];
const resources = ['Developer Docs & SDK', 'Solana SPL Program ID', 'Merkle Tree Verifier', 'Network Status', 'Community Discord & Forum'];

function Solutions() {
  return (
    <div className="space-y-4" id="solutions">
      <h3 className="font-label-caps text-xs tracking-wider text-text-primary font-semibold uppercase">Solutions</h3>
      <ul className="space-y-2.5 font-body-sm text-sm text-text-secondary">
        {solutions.map((s) => (
          <li key={s}>
            <Link href="/sponsors" className="hover:text-primary transition-colors flex items-center justify-between group">
              <span>{s}</span>
              <span className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity font-mono text-xs">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Company() {
  return (
    <div className="space-y-4" id="company">
      <h3 className="font-label-caps text-xs tracking-wider text-text-primary font-semibold uppercase">Company</h3>
      <ul className="space-y-2.5 font-body-sm text-sm text-text-secondary">
        {company.map((s, i) => (
          <li key={s}>
            <Link href={i === 3 ? '/sponsors' : '/dev/components'} className="hover:text-primary transition-colors flex items-center justify-between group">
              <span className={i === 3 ? 'flex items-center gap-2' : undefined}>
                {s}
                {i === 3 && (
                  <span className="text-[10px] font-label-caps font-semibold px-1.5 py-0.5 rounded bg-badge-green-bg text-badge-green-text border border-badge-green-border">
                    HIRING
                  </span>
                )}
              </span>
              <span className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity font-mono text-xs">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Resources() {
  return (
    <div className="space-y-4" id="resources">
      <h3 className="font-label-caps text-xs tracking-wider text-text-primary font-semibold uppercase">Resources</h3>
      <ul className="space-y-2.5 font-body-sm text-sm text-text-secondary">
        {resources.map((s, i) => (
          <li key={s}>
            <Link href={i === 0 ? '/dev/components' : '/verify'} className="hover:text-primary transition-colors flex items-center justify-between group">
              <span className="flex items-center gap-1.5">
                {s}
                {i === 3 && <span className="inline-block w-1.5 h-1.5 rounded-full bg-verified-dot"></span>}
              </span>
              <span className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity font-mono text-xs">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function GlobalFooter() {
  return (
    <footer className="w-full bg-surface-base relative border-t border-border-subtle bg-grid-tech">
      <div className="w-full border-b border-border-subtle/80 bg-surface-base/90 backdrop-blur-xs">
        <div className="max-w-7xl mx-auto px-6 h-10 flex items-center justify-between font-label-caps text-[11px] text-text-muted tracking-wider">
          <div className="flex items-center space-x-2">
            <span className="text-primary-container font-bold">[</span>
            <span className="text-text-secondary font-medium tracking-widest uppercase">ProofMesh Protocol // Global Footer</span>
            <span className="text-primary-container font-bold">]</span>
          </div>
          <div className="hidden md:flex items-center space-x-4">
            <span className="flex items-center gap-1.5 text-text-secondary font-label-mono-tag">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-verified-dot"></span>
              SOLANA CLUSTER: DEVNET
            </span>
            <span className="text-border-strong">/</span>
            <span className="text-text-muted font-label-mono-tag">NODE LATENCY: 22MS</span>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-16 lg:py-20">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16">
          <div className="lg:col-span-5 flex flex-col justify-between space-y-8">
            <div className="space-y-4">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded bg-text-primary text-surface-card flex items-center justify-center font-label-caps font-bold text-xs tracking-tight shadow-xs">
                  PM
                </div>
                <span className="font-headline-md text-2xl font-bold tracking-tight text-text-primary">ProofMesh</span>
              </div>
              <p className="font-body-md text-text-secondary text-sm leading-relaxed max-w-sm">
                Deterministic developer attribution anchored on Solana. Cryptographically verified GitHub telemetry,
                trustless reputation primitives, and automated engineering compensation.
              </p>
              <div className="pt-1">
                <Link
                  href="/verify"
                  className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-badge-green-border bg-badge-green-bg/80 text-badge-green-text font-label-code text-xs"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-verified-dot opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-verified-dot"></span>
                  </span>
                  <span className="font-medium">Solana Cluster: Devnet</span>
                  <span className="text-text-muted">|</span>
                  <span className="text-[11px] font-label-mono-tag tracking-wider text-text-secondary uppercase">Epoch 624 Active</span>
                </Link>
              </div>
            </div>
            <div className="space-y-2 pt-4 border-t border-border-subtle">
              <div className="text-[11px] font-label-caps text-text-muted tracking-wider uppercase mb-1">PHYSICAL HUBS // FOUNDATION</div>
              <div className="font-label-code text-xs text-text-secondary flex items-start space-x-2">
                <span className="text-primary font-bold">sf://</span>
                <span>San Francisco — 550 Montgomery St, Fl 4, San Francisco, CA 94111</span>
              </div>
              <div className="font-label-code text-xs text-text-secondary flex items-start space-x-2">
                <span className="text-primary font-bold">ch://</span>
                <span>Zurich — Gotthardstrasse 26, 8002 Zürich, Switzerland</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-8">
            <Solutions />
            <Company />
            <Resources />
          </div>
        </div>
      </div>

      <div className="w-full border-t border-border-subtle bg-surface-base">
        <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col md:flex-row items-center justify-between gap-4 font-body-sm text-xs text-text-muted">
          <div className="flex flex-col sm:flex-row items-center gap-3 sm:gap-6 text-center sm:text-left">
            <p>© 2026 ProofMesh Labs Inc. Cryptographic verification protocol.</p>
            <div className="flex items-center space-x-4 font-body-sm">
              <Link href="/verify" className="hover:text-text-primary transition-colors">Privacy Policy</Link>
              <span className="text-border-strong">·</span>
              <Link href="/verify" className="hover:text-text-primary transition-colors">Terms of Service</Link>
              <span className="text-border-strong">·</span>
              <Link href="/verify" className="hover:text-text-primary transition-colors">Security Disclosures</Link>
            </div>
          </div>
          <div className="flex items-center space-x-6">
            <div className="flex items-center space-x-4 text-text-secondary">
              <a aria-label="X former Twitter" className="hover:text-text-primary transition-colors p-1" href="https://twitter.com" rel="noopener noreferrer" target="_blank">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"></path>
                </svg>
              </a>
              <a aria-label="GitHub telemetry source" className="hover:text-text-primary transition-colors p-1" href="https://github.com" rel="noopener noreferrer" target="_blank">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path clipRule="evenodd" fillRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"></path>
                </svg>
              </a>
              <a aria-label="Discord community channel" className="hover:text-text-primary transition-colors p-1" href="https://discord.com" rel="noopener noreferrer" target="_blank">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.929 1.793 8.18 1.793 12.061 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.894.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.028zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"></path>
                </svg>
              </a>
              <a aria-label="Research Mirror and Whitepapers" className="hover:text-text-primary transition-colors p-1" href="https://mirror.xyz" rel="noopener noreferrer" target="_blank">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M4 3.75A1.75 1.75 0 0 1 5.75 2h12.5A1.75 1.75 0 0 1 20 3.75v16.5A1.75 1.75 0 0 1 18.25 22H5.75A1.75 1.75 0 0 1 4 20.25V3.75zm3 3.25a.75.75 0 0 0 0 1.5h10a.75.75 0 0 0 0-1.5H7zm0 4a.75.75 0 0 0 0 1.5h10a.75.75 0 0 0 0-1.5H7zm0 4a.75.75 0 0 0 0 1.5h6a.75.75 0 0 0 0-1.5H7z"></path>
                </svg>
              </a>
            </div>
            <div className="hidden lg:inline-flex items-center px-2 py-1 rounded bg-surface-container border border-border-subtle font-label-mono-tag text-[10px] text-text-secondary tracking-widest uppercase">
              SHA-256 SPEC V2.4.1 // ATTEST-NODE-SOL-OK
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}