import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ProofMesh — Deterministic Developer Credentials on Solana',
  description:
    'ProofMesh deterministically evaluates GitHub commit history, peer reviews, and code integrity to issue unforgeable skill credentials anchored on Solana.',
  openGraph: {
    title: 'ProofMesh — Deterministic Developer Credentials on Solana',
    description:
      'Deterministic evidence, quantified and verifiable down to the commit.',
    type: 'website'
  }
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-surface-base text-text-primary font-sans antialiased min-h-screen flex flex-col">
        {children}
      </body>
    </html>
  );
}