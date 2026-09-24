'use client';

import { useEffect, useState } from 'react';
import { detectWallets, useWallet, type WalletOption } from '../lib/wallet';

const INSTALL_URLS: Record<string, string> = {
  phantom: 'https://phantom.app/download',
  backpack: 'https://backpack.app/download',
  solflare: 'https://solflare.com/download'
};

function WalletMark({ id }: { id: string }) {
  const tone: Record<string, string> = {
    phantom: 'from-[#ab9ff2] to-[#6859e8]',
    backpack: 'from-[#f7a600] to-[#e86f16]',
    solflare: 'from-[#8b5cf6] to-[#4f46e5]',
    demo: 'from-surface-container to-surface-subtle'
  };
  return (
    <span
      className={`w-9 h-9 rounded-xl bg-gradient-to-br ${tone[id] ?? tone.demo} flex items-center justify-center font-label-caps text-[11px] font-bold text-white shrink-0`}
    >
      {id === 'demo' ? 'DM' : id.slice(0, 2).toUpperCase()}
    </span>
  );
}

/** Wallet picker. Lists detected extensions, links to install missing ones, and
 *  always offers the local demo key so the SIWS flow is testable without one. */
export function WalletModal() {
  const { modalOpen, closeModal, connect, connecting, error, clearError } = useWallet();
  const [options, setOptions] = useState<WalletOption[]>([]);

  useEffect(() => {
    if (modalOpen) {
      setOptions(detectWallets());
      clearError();
    }
  }, [modalOpen, clearError]);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen, closeModal]);

  if (!modalOpen) return null;

  const installed = options.filter((o) => o.installed);
  const missing = ['phantom', 'backpack', 'solflare'].filter(
    (id) => !options.some((o) => o.id === id)
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={closeModal}
      role="dialog"
      aria-modal="true"
      aria-label="Connect wallet"
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border-subtle bg-surface-card shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border-subtle flex items-start justify-between">
          <div>
            <h2 className="font-headline-sm text-sm font-semibold text-text-primary">Connect a wallet</h2>
            <p className="font-label-code text-[11px] text-text-muted mt-0.5">
              Your wallet signs a one-time proof-of-ownership message. No transaction, no gas.
            </p>
          </div>
          <button
            onClick={closeModal}
            className="text-text-muted hover:text-text-primary transition-colors text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="p-3 flex flex-col gap-2">
          {installed.map((o) => (
            <button
              key={o.id}
              onClick={() => void connect(o.id).catch(() => undefined)}
              disabled={connecting}
              className="flex items-center gap-3 p-3 rounded-xl border border-border-subtle bg-surface-subtle hover:border-primary-container/50 hover:bg-surface-container transition-colors text-left disabled:opacity-50"
            >
              <WalletMark id={o.id} />
              <span className="flex-1 min-w-0">
                <span className="block font-body-md text-sm font-medium text-text-primary">{o.name}</span>
                <span className="block font-label-code text-[10px] text-text-muted">
                  {o.id === 'demo' ? 'Local key for testing — no extension required' : 'Detected browser extension'}
                </span>
              </span>
              <span className="font-label-mono-tag text-[10px] text-text-muted">
                {connecting ? 'CONNECTING…' : 'CONNECT →'}
              </span>
            </button>
          ))}

          {missing.length > 0 && (
            <div className="mt-1 px-3 py-2.5 rounded-xl border border-dashed border-border-subtle">
              <div className="font-label-caps text-[10px] text-text-muted uppercase tracking-wider mb-1.5">
                Not installed
              </div>
              <div className="flex flex-wrap gap-2">
                {missing.map((id) => (
                  <a
                    key={id}
                    href={INSTALL_URLS[id]}
                    target="_blank"
                    rel="noreferrer"
                    className="font-label-mono-tag text-[10px] px-2 py-1 rounded border border-border-subtle text-text-secondary hover:text-text-primary hover:border-border-strong transition-colors"
                  >
                    {id.toUpperCase()} ↗
                  </a>
                ))}
              </div>
            </div>
          )}

          {error && <p className="px-3 py-2 font-label-code text-[11px] text-error">{error}</p>}
        </div>
      </div>
    </div>
  );
}
