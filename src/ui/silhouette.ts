// A ship's profile as a small SVG, drawn from the same recipe the 3D hull is lofted from.
// For the captain's log and the shipyard list, where a WebGL canvas per card would cost
// more than the whole sea does.

import type { HullRecipe } from '../data/types';

export function silhouette(R: HullRecipe, w = 100, h = 56): string {
  const L = R.length;
  const tallest = R.mastHeight * L * 0.85;
  const span = L * (R.bowsprit ? 1.3 : 1.05);
  const top = tallest + R.freeboard + R.sheer;
  const bottom = R.draft;
  const s = Math.min((w * 0.9) / span, (h * 0.9) / (top + bottom));
  const ox = (w - span * s) / 2 + L * 0.02 * s, oy = h * 0.05 + top * s;
  const X = (x: number) => (ox + x * s).toFixed(1);
  const Y = (y: number) => (oy - y * s).toFixed(1);
  const P = R.palette;

  const rail = (u: number) => R.freeboard + R.sheer * (u > 0.45 ? ((u - 0.45) / 0.55) ** 2 : ((0.45 - u) / 0.45) ** 2 * 0.8);
  const pts: string[] = [];
  for (let i = 0; i <= 10; i++) { const u = i / 10; pts.push(`${X(u * L)},${Y(rail(u))}`); }
  pts.push(`${X(L * 0.97)},${Y(-R.draft * 0.3)}`, `${X(L * 0.82)},${Y(-R.draft)}`, `${X(L * 0.05)},${Y(-R.draft)}`, `${X(0)},${Y(-R.draft * 0.2)}`);
  let svg = `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`;
  svg += `<line x1="0" y1="${Y(0)}" x2="${w}" y2="${Y(0)}" stroke="rgba(120,180,190,.35)" stroke-width="0.6"/>`;

  const at = R.masts === 1 ? [0.55] : R.masts === 2 ? [0.36, 0.67] : [0.22, 0.5, 0.75];
  const tall = R.masts === 1 ? [1] : R.masts === 2 ? [1, 0.9] : [0.76, 1, 0.9];
  at.forEach((u, i) => {
    const x = u * L, base = rail(u) - 0.4, mh = tallest * tall[i];
    if (R.rig === 'square') {
      const fr = R.tiers === 3 ? [0.3, 0.58, 0.84] : R.tiers === 2 ? [0.36, 0.72] : [0.5];
      fr.forEach((f, k) => {
        const y1 = base + mh * f, y0 = k === 0 ? base + R.freeboard * 0.5 : base + mh * fr[k - 1] + 0.3;
        const hw = L * 0.075 * (1 - k * 0.2);
        svg += `<path d="M${X(x - hw)},${Y(y1)} L${X(x + hw)},${Y(y1)} L${X(x + hw * 1.05)},${Y(y0)} L${X(x - hw * 1.05)},${Y(y0)}Z" fill="${P.sail}" opacity=".92"/>`;
      });
    } else if (R.rig === 'fore-aft') {
      svg += `<path d="M${X(x - 0.3)},${Y(base + mh * 0.74)} L${X(x - L * 0.36)},${Y(base + mh * 0.9)} L${X(x - L * 0.42)},${Y(base + 1)} L${X(x - 0.3)},${Y(base + 1)}Z" fill="${P.sail}" opacity=".92"/>`;
      if (i === at.length - 1 && R.bowsprit) svg += `<path d="M${X(x + 0.4)},${Y(base + mh * 0.86)} L${X(L * 1.22)},${Y(rail(1) + L * 0.08)} L${X(x + 1.4)},${Y(base + 1.4)}Z" fill="${P.sail}" opacity=".85"/>`;
    } else if (R.rig === 'lateen') {
      svg += `<path d="M${X(x + L * 0.34)},${Y(base + 1)} L${X(x - L * 0.3)},${Y(base + mh)} L${X(x - L * 0.18)},${Y(base + 0.9)}Z" fill="${P.sail}" opacity=".9"/>`;
    }
    svg += `<line x1="${X(x)}" y1="${Y(base)}" x2="${X(x)}" y2="${Y(base + mh)}" stroke="${P.rail}" stroke-width="${Math.max(0.8, L * 0.012 * s).toFixed(2)}"/>`;
  });
  if (R.bowsprit) svg += `<line x1="${X(L)}" y1="${Y(rail(1))}" x2="${X(L * 1.28)}" y2="${Y(rail(1) + L * 0.09)}" stroke="${P.rail}" stroke-width="1"/>`;
  if (R.stern === 'castle' || R.stern === 'galleon') {
    const ch = R.freeboard * (R.stern === 'galleon' ? 0.8 : 0.42);
    svg += `<rect x="${X(0)}" y="${Y(rail(0) + ch)}" width="${(L * 0.26 * s).toFixed(1)}" height="${(ch * s).toFixed(1)}" fill="${P.hull}"/>`;
  }
  svg += `<polygon points="${pts.join(' ')}" fill="${P.hull}"/>`;
  svg += `<line x1="${X(L * 0.04)}" y1="${Y(R.freeboard * 0.5)}" x2="${X(L * 0.9)}" y2="${Y(R.freeboard * 0.5 + R.sheer * 0.3)}" stroke="${P.wale}" stroke-width="${Math.max(0.8, R.freeboard * 0.18 * s).toFixed(2)}"/>`;
  svg += '</svg>';
  return svg;
}
