// A captain's name: typed on the first screen, shown over her ship and on the bar's TV.
// The phone checks it as it is typed and the sea checks it again when she comes aboard.

/** 3 to 12 letters, numbers and spaces. */
export const NAME_MIN = 3;
export const NAME_MAX = 12;

// Words kept off the bar's TV, English and Spanish, matched inside a name with spaces,
// numbers and repeated letters taken out ("a s s", "a55", "asss"). Short and blunt: a
// determined guest can get round any list, and the bartender can see the TV. Words that
// hide inside real names (Hancock, Penelope, Conor) are left off.
const BLOCK = [
  'fuck', 'shit', 'cunt', 'bitch', 'pussy', 'whore', 'slut', 'nigg', 'faggot',
  'nazi', 'hitler', 'puta', 'puto', 'coño', 'joder', 'mierda',
  'cabron', 'cabrón', 'maricon', 'maricón', 'zorra', 'follar', 'verga',
];

const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', '$': 's' };

/** The name as it will be shown: trimmed, inner spaces single, or null with why not. */
export function checkName(raw: string): { name: string } | { why: 'short' | 'long' | 'chars' | 'rude' } {
  const name = raw.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (name.length < NAME_MIN) return { why: 'short' };
  if (name.length > NAME_MAX) return { why: 'long' };
  if (!/^[\p{L}\p{N} ]+$/u.test(name)) return { why: 'chars' };
  const flat = [...name.toLowerCase()].map((c) => LEET[c] ?? c).join('').replace(/[^\p{L}]/gu, '').replace(/(.)\1+/g, '$1');
  if (BLOCK.some((w) => flat.includes(w.replace(/(.)\1+/g, '$1')))) return { why: 'rude' };
  return { name };
}
