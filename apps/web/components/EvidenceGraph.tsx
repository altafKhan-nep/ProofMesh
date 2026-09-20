interface EvidenceGraphProps {
  score?: number;
  confidence?: number;
  walletTag?: string;
}

/**
 * Pixel-faithful mirror of the Stitch "Evidence Graph Illustration" SVG
 * (760x640) — graph resolution to on-chain credential shape. Numbers are
 * injectable so the credential card reflects real deterministic output.
 */
export function EvidenceGraph({ score = 94.1, confidence = 99.1, walletTag = 'solana:8xPt...3k9L' }: EvidenceGraphProps) {
  const confPct = Math.round(confidence * 10) / 10;
  const circ = 201.06;
  const dashOffset = circ * (1 - confPct / 100);

  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 640" width="100%" height="100%" className="w-full h-auto" fill="none" preserveAspectRatio="xMidYMid meet">
      <defs>
        <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
          <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#E6E4DD" strokeWidth="0.75" strokeDasharray="2 4" />
        </pattern>
        <radialGradient id="cardGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#1D5D3A" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#1D5D3A" stopOpacity="0" />
        </radialGradient>
        <filter id="softShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="12" stdDeviation="16" floodColor="#111413" floodOpacity="0.06" />
          <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#111413" floodOpacity="0.04" />
        </filter>
      </defs>

      <rect width="760" height="640" rx="16" fill="#FBFBF9" stroke="#E8E6DF" strokeWidth="1" />
      <rect width="760" height="640" rx="16" fill="url(#grid)" />

      <g stroke="#1D5D3A" strokeWidth="1.5" strokeOpacity="0.35" fill="none">
        <path d="M 90 120 C 160 120, 220 230, 310 270" strokeDasharray="4 3" />
        <path d="M 110 200 C 190 200, 230 280, 310 280" />
        <path d="M 70 300 C 150 300, 210 290, 310 290" />
        <path d="M 120 400 C 190 400, 230 320, 310 310" />
        <path d="M 90 490 C 170 490, 230 360, 310 320" strokeDasharray="4 3" />
      </g>

      <g transform="translate(90, 120)">
        <circle r="18" fill="#FFFFFF" stroke="#E8E6DF" strokeWidth="1.5" filter="url(#softShadow)" />
        <circle r="5" fill="#1D5D3A" />
        <text x="30" y="4" fontFamily="monospace" fontSize="11" fill="#666864">commit:8f4c2e · gpg_verified</text>
      </g>
      <g transform="translate(110, 200)">
        <circle r="16" fill="#FFFFFF" stroke="#E8E6DF" strokeWidth="1.5" filter="url(#softShadow)" />
        <circle r="4" fill="#1D5D3A" />
        <text x="28" y="4" fontFamily="monospace" fontSize="11" fill="#666864">pr:merge_entropy_0.94</text>
      </g>
      <g transform="translate(70, 300)">
        <circle r="16" fill="#FFFFFF" stroke="#E8E6DF" strokeWidth="1.5" filter="url(#softShadow)" />
        <circle r="4" fill="#1D5D3A" />
        <text x="28" y="4" fontFamily="monospace" fontSize="11" fill="#666864">peer_review:torvalds_tree</text>
      </g>
      <g transform="translate(120, 400)">
        <circle r="16" fill="#FFFFFF" stroke="#E8E6DF" strokeWidth="1.5" filter="url(#softShadow)" />
        <circle r="4" fill="#1D5D3A" />
        <text x="28" y="4" fontFamily="monospace" fontSize="11" fill="#666864">repo:stars_citations_idx</text>
      </g>
      <g transform="translate(90, 490)">
        <circle r="18" fill="#FFFFFF" stroke="#E8E6DF" strokeWidth="1.5" filter="url(#softShadow)" />
        <circle r="5" fill="#1D5D3A" />
        <text x="30" y="4" fontFamily="monospace" fontSize="11" fill="#666864">zk_proof:circuit_sol_anchor</text>
      </g>

      <circle cx="310" cy="295" r="44" fill="url(#cardGlow)" />
      <circle cx="310" cy="295" r="8" fill="#1D5D3A" />
      <circle cx="310" cy="295" r="22" stroke="#1D5D3A" strokeWidth="1.5" strokeDasharray="3 3" />

      <path d="M 332 295 L 400 295" stroke="#1D5D3A" strokeWidth="2" />
      <polygon points="404,295 396,290 396,300" fill="#1D5D3A" />

      <g transform="translate(415, 155)" filter="url(#softShadow)">
        <rect width="295" height="280" rx="14" fill="#FFFFFF" stroke="#E2E0D8" strokeWidth="1.5" />

        <rect x="20" y="24" width="32" height="32" rx="8" fill="#F4F3EF" />
        <path d="M 33 46 V 36 M 33 36 C 33 33 38 31 43 31 M 43 31 V 38" stroke="#111413" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="33" cy="46" r="2" fill="#111413" />
        <circle cx="33" cy="36" r="2" fill="#111413" />
        <circle cx="43" cy="38" r="2" fill="#111413" />

        <text x="62" y="38" fontFamily="sans-serif" fontWeight="600" fontSize="13" fill="#111413">Systems Engineering</text>
        <text x="62" y="52" fontFamily="monospace" fontSize="10" fill="#7A7D78">github.com/developer</text>

        <rect x="205" y="24" width="70" height="22" rx="11" fill="#EBF4EE" stroke="#C2DFCD" strokeWidth="1" />
        <path d="M 216 35 L 220 39 L 227 31" stroke="#1D5D3A" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
        <text x="232" y="39" fontFamily="monospace" fontWeight="700" fontSize="9" fill="#1D5D3A" letterSpacing="0.5">VERIFIED</text>

        <line x1="20" y1="72" x2="275" y2="72" stroke="#EFEFEA" strokeWidth="1" />

        <text x="20" y="98" fontFamily="monospace" fontSize="9" fill="#888A85" letterSpacing="1">AGGREGATED SCORE</text>
        <text x="200" y="98" fontFamily="monospace" fontSize="9" fill="#888A85" letterSpacing="1">CONFIDENCE</text>

        <text x="20" y="132" fontFamily="sans-serif" fontWeight="700" fontSize="34" fill="#111413">{score.toFixed(1)}</text>
        <text x="96" y="128" fontFamily="sans-serif" fontSize="13" fill="#7A7D78">/100</text>

        <rect x="200" y="112" width="68" height="22" rx="4" fill="#F4F3EF" />
        <circle cx="210" cy="123" r="3" fill="#1D5D3A" />
        <text x="218" y="127" fontFamily="monospace" fontWeight="600" fontSize="11" fill="#111413">{confPct.toFixed(1)}%</text>

        <text x="20" y="162" fontFamily="monospace" fontSize="9.5" fill="#666864">Code Integrity (4,218 commits)</text>
        <text x="245" y="162" fontFamily="monospace" fontSize="9.5" fontWeight="600" fill="#111413">98.2%</text>
        <rect x="20" y="170" width="255" height="5" rx="2.5" fill="#EBE9E1" />
        <rect x="20" y="170" width="250" height="5" rx="2.5" fill="#1D5D3A" />

        <text x="20" y="196" fontFamily="monospace" fontSize="9.5" fill="#666864">Peer Review Dispersion</text>
        <text x="245" y="196" fontFamily="monospace" fontSize="9.5" fontWeight="600" fill="#111413">92.0%</text>
        <rect x="20" y="204" width="255" height="5" rx="2.5" fill="#EBE9E1" />
        <rect x="20" y="204" width="234" height="5" rx="2.5" fill="#1D5D3A" />

        <rect x="20" y="232" width="255" height="30" rx="6" fill="#FAF9F6" stroke="#EAE8E1" strokeWidth="1" />
        <circle cx="32" cy="247" r="3.5" fill="#1D5D3A" />
        <text x="42" y="251" fontFamily="monospace" fontSize="10" fill="#555853">{walletTag}</text>
        <text x="212" y="251" fontFamily="sans-serif" fontWeight="600" fontSize="10" fill="#1D5D3A">ANCHORED ↗</text>
      </g>

      <text x="40" y="605" fontFamily="monospace" fontSize="10" fill="#8E918B" letterSpacing="1">FIGURE 01: GRAPH RESOLUTION TO ON-CHAIN CREDENTIAL SHAPE</text>
      <text x="630" y="605" fontFamily="monospace" fontSize="10" fill="#1D5D3A" fontWeight="600">STATE: VERIFIED</text>

      <line x1="40" y1="614" x2="720" y2="614" stroke="#EFEFEA" strokeWidth="1" />
      <text x="40" y="628" fontFamily="monospace" fontSize="9.5" fill="#8E918B">INPUT: GIT_TREE_HASH(SHA-256)</text>
      <text x="290" y="628" fontFamily="monospace" fontSize="9.5" fill="#8E918B">PROOF-CIRCUIT: GROTH16_SOL</text>
      <text x="650" y="628" fontFamily="monospace" fontSize="9.5" fontWeight="600" fill="#1D5D3A">STATUS: FINALIZED</text>
    </svg>
  );
}