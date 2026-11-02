// The powers' icons, drawn for the buttons: the game's cartoon look, a thick ink outline
// round bold colour, a highlight on the lit side and a shade on the other. Inline SVG, so
// they are sharp at any size and cost nothing to load.

import type { Power } from '../sim/types';

const INK = '#10233F';
const line = `stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;

/** A bronze cannon on its carriage, firing up and to the right, the ball on its way. */
const broadside = `
<svg viewBox="0 0 64 64" aria-hidden="true">
  <g ${line}>
    <path d="M5 47 L33 40 L38 50 L8 57 Z" fill="#7A4521"/>
    <path d="M8 50 L34 43.5" stroke="#B0703A" stroke-width="2.4" fill="none"/>
    <circle cx="13" cy="55" r="6" fill="#5E3418"/>
    <g transform="rotate(-33 28 36)">
      <circle cx="6.5" cy="36" r="4.4" fill="#A86A1E"/>
      <path d="M9 27 C7 31 7 41 9 45 L39 41.5 L39 30.5 Z" fill="#D9982E"/>
      <path d="M11 31 L37 33" stroke="#FFE08A" stroke-width="3" fill="none"/>
      <path d="M11 41.5 L37 39.5" stroke="#A86A1E" stroke-width="2.4" fill="none"/>
      <rect x="18" y="27.5" width="4" height="17" rx="1.6" fill="#A86A1E"/>
      <rect x="37.5" y="28" width="7.5" height="16" rx="2.6" fill="#B87A26"/>
      <ellipse cx="45" cy="36" rx="1.5" ry="4.2" fill="#1A1206" stroke-width="1.6"/>
    </g>
    <circle cx="32" cy="51" r="7.5" fill="#8A5428"/>
    <circle cx="32" cy="51" r="2.6" fill="${INK}" stroke-width="0"/>
    <path d="M27.5 46.5 A6 6 0 0 1 35 45.5" stroke="#C98A4B" stroke-width="2" fill="none"/>
    <path d="M47 4 L50 12 L58 9.5 L53.5 16.5 L61.5 21 L53 22.5 L54.5 31 L47.5 25.5 L41 30.5 L41.5 22 L34 19.5 L41 15 L39 7 L45.5 11 Z" fill="#FFD43B"/>
    <path d="M47 12.5 L49 16 L53 16 L50.5 19 L52 22.5 L48 21 L44.5 23.5 L45 19.5 L42 17.5 L46 16.5 Z" fill="#FF7A1F" stroke-width="2"/>
    <circle cx="47.5" cy="18" r="2" fill="#FFFFFF" stroke="none"/>
    <circle cx="59" cy="4.5" r="3.6" fill="#2B3446" stroke-width="2.4"/>
  </g>
</svg>`;

/** A mermaid's tail curling up out of the water, and her notes. */
const song = `
<svg viewBox="0 0 64 64" aria-hidden="true">
  <defs>
    <linearGradient id="tail-g" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#1BAE92"/><stop offset="1" stop-color="#46ECC4"/>
    </linearGradient>
  </defs>
  <g ${line}>
    <path d="M11 61 C8 48 16 37 28 30 C33 27 36 24 37 20 C32 15 28 10 26 4 C34 6 41 9 45 14 C48 9 55 6 62 6 C59 15 52 22 45 25 C41 31 35 38 31 44 C27 50 26 55 29 61 Z" fill="url(#tail-g)"/>
    <g stroke="#0E7F6B" stroke-width="2" fill="none">
      <path d="M17 52 q3 3 6 0"/><path d="M19 45 q3 3 6 0"/><path d="M24 39 q3 3 6 0"/>
      <path d="M18 58 q3 3 6 0"/><path d="M29 34 q2.5 2.5 5 0"/>
    </g>
    <g stroke="#A8FFE9" stroke-width="2" fill="none">
      <path d="M39 21 L33 9"/><path d="M41 21 L52 11"/>
    </g>
    <path d="M15 56 C14 48 19 41 27 35" stroke="#B9FFEE" stroke-width="2.4" fill="none"/>
    <path d="M10 9 L23 5 L23 23" fill="none" stroke-width="7"/>
    <path d="M10 9 L23 5 L23 23" fill="none" stroke="#FFF6E0" stroke-width="3"/>
    <path d="M10 9 L10 27" fill="none" stroke-width="7"/>
    <path d="M10 9 L10 27" fill="none" stroke="#FFF6E0" stroke-width="3"/>
    <ellipse cx="6.5" cy="28" rx="5" ry="4" transform="rotate(-20 6.5 28)" fill="#FFF6E0"/>
    <ellipse cx="19.5" cy="24" rx="5" ry="4" transform="rotate(-20 19.5 24)" fill="#FFF6E0"/>
    <path d="M53 34 L53 50 M53 34 C57 36 60 38 58 44" fill="none" stroke-width="7"/>
    <path d="M53 34 L53 50 M53 34 C57 36 60 38 58 44" fill="none" stroke="#FFF6E0" stroke-width="3"/>
    <ellipse cx="49.5" cy="51" rx="4.6" ry="3.6" transform="rotate(-20 49.5 51)" fill="#FFF6E0"/>
  </g>
</svg>`;

/** A shield, a ball bouncing off it with a spark. */
const shield = `
<svg viewBox="0 0 64 64" aria-hidden="true">
  <defs>
    <clipPath id="shield-c"><path d="M30 8 C38 12 46 13 52 12 C53 32 47 47 30 59 C13 47 7 32 8 12 C14 13 22 12 30 8 Z"/></clipPath>
  </defs>
  <g ${line}>
    <path d="M30 8 C38 12 46 13 52 12 C53 32 47 47 30 59 C13 47 7 32 8 12 C14 13 22 12 30 8 Z" fill="#8FEAFF"/>
    <g clip-path="url(#shield-c)" stroke="none">
      <rect x="30" y="0" width="34" height="64" fill="#3FB8F2"/>
    </g>
    <path d="M30 8 C38 12 46 13 52 12 C53 32 47 47 30 59 C13 47 7 32 8 12 C14 13 22 12 30 8 Z" fill="none"/>
    <path d="M30 14 C36.5 17 42.5 18 47 17.5 C47 33 42 44 30 53 C18 44 13 33 13 17.5 C17.5 18 23.5 17 30 14 Z" fill="none" stroke="#E9FBFF" stroke-width="2.6"/>
    <path d="M17 22 C21 22 25 21 27 20 L23 36 C20 33 18 28 17 22 Z" fill="#FFFFFF" stroke="none" opacity=".75"/>
    <path d="M30 23 L33 30 L40 30.5 L34.5 35 L36.5 42 L30 38 L23.5 42 L25.5 35 L20 30.5 L27 30 Z" fill="#FFD43B" stroke-width="2.4"/>
    <circle cx="55" cy="7" r="5" fill="#2B3446"/>
    <path d="M53 5.5 A2.4 2.4 0 0 1 56 4.4" stroke="#6E7FA3" stroke-width="1.6" fill="none"/>
    <path d="M47 15 L44 11 M50 18 L54 17 M45 19 L41 21" stroke="#FFD43B" stroke-width="2.4"/>
  </g>
</svg>`;

export const POWER_ICON: Record<Power, string> = { broadside, song, shield };
