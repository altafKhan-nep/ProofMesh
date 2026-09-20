/**
 * Embeddable SVG badge — /badge/:wallet/:skill.svg
 * Designed to match the Stitch "evidence graph" credential card language.
 */

export function renderBadgeSvg(input: {
  skillLabel: string;
  score: number;
  confidencePercent: number;
  levelLabel: string;
  wallet: string;
  verifyUrl: string;
}): string {
  const { skillLabel, score, confidencePercent, levelLabel, wallet, verifyUrl } = input;
  const shortWallet = `${wallet.slice(0, 5)}…${wallet.slice(-4)}`;
  const esc = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="96" viewBox="0 0 320 96" role="img">
  <defs>
    <linearGradient id="pmSoil" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#EBF4EE"/>
      <stop offset="1" stop-color="#F4F3EF"/>
    </linearGradient>
  </defs>
  <rect width="320" height="96" rx="14" fill="#FFFFFF" stroke="#E8E6DF" stroke-width="1.5"/>
  <rect x="16" y="12" width="40" height="40" rx="10" fill="#EBF4EE" stroke="#C2DFCD" stroke-width="1"/>
  <path d="M 34 40 V 30 M 34 27 a 3.2 3.2 0 1 1 4.6 2.9 c -1.2.6 -1.6 1.1 -1.6 2.2" stroke="#1D5D3A" stroke-width="2" stroke-linecap="round" fill="none"/>
  <text x="24" y="33" font-family="monospace" font-size="13" font-weight="700" fill="#1D5D3A">?</text>

  <text x="68" y="30" font-family="monospace" font-size="11" fill="#111413" font-weight="700">${esc(skillLabel)} — ${esc(levelLabel)}</text>
  <text x="68" y="44" font-family="monospace" font-size="9" fill="#7A7D78">github · ${esc(shortWallet)}</text>

  <circle cx="286" cy="28" r="3.5" fill="#10B981"/>
  <text x="232" y="32" font-family="monospace" font-size="9" font-weight="700" fill="#194D31" letter-spacing="0.5">VERIFIED</text>

  <line x1="16" y1="60" x2="304" y2="60" stroke="#EFEFEA" stroke-width="1"/>
  <text x="20" y="72" font-family="monospace" font-size="9" fill="#888A85" letter-spacing="1">SCORE</text>
  <text x="20" y="88" font-family="sans-serif" font-weight="700" font-size="15" fill="#111413">${score} / 100</text>
  <text x="150" y="72" font-family="monospace" font-size="9" fill="#888A85" letter-spacing="1">CONFIDENCE</text>
  <text x="150" y="88" font-family="sans-serif" font-weight="600" font-size="13" fill="#1D5D3A">${confidencePercent}%</text>
  <a href="${esc(verifyUrl)}" target="_blank">
    <text x="252" y="86" font-family="monospace" font-size="10" font-weight="600" fill="#1D5D3A">VERIFY ↗</text>
  </a>
</svg>
`;
}