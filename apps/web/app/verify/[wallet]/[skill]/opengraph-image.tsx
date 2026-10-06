import { ImageResponse } from 'next/og';
import { skillLabel } from '@/lib/constants';

export const runtime = 'edge';
export const alt = 'ProofMesh Credential';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OgImage({
  params
}: {
  params: Promise<{ wallet: string; skill: string }>;
}) {
  const { wallet, skill } = await params;
  const label = skillLabel(skill);
  const shortWallet = `${wallet.slice(0, 4)}…${wallet.slice(-4)}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#f9f8f6',
          padding: '60px',
          fontFamily: 'sans-serif'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ width: '48px', height: '48px', borderRadius: '12px', background: '#1d5d3a' }} />
          <span style={{ fontSize: '28px', fontWeight: 700, color: '#111413', letterSpacing: '-0.02em' }}>
            ProofMesh
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <span
            style={{
              fontSize: '14px',
              fontWeight: 600,
              color: '#7a827e',
              textTransform: 'uppercase',
              letterSpacing: '0.15em'
            }}
          >
            Verified Credential
          </span>
          <span style={{ fontSize: '56px', fontWeight: 700, color: '#111413', letterSpacing: '-0.03em', lineHeight: 1.1 }}>
            {label}
          </span>
          <span style={{ fontSize: '24px', color: '#484e4b', fontWeight: 500 }}>
            {shortWallet} · Issued on Solana
          </span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '16px', color: '#7a827e', fontFamily: 'monospace' }}>
            proofmesh.xyz/verify/{shortWallet}/{skill}
          </span>
          <span style={{ fontSize: '14px', color: '#10b981', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            On-chain attested
          </span>
        </div>
      </div>
    ),
    { ...size }
  );
}
