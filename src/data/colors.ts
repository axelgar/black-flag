// The captains' colors on the bar's screen, and the dot by each name on a phone.
//
// Seven, because seven is as many as stay apart on the water: past that, two of them look
// the same to someone, and a color that only seems to be yours is worse than one you
// share with a captain of another name. They were searched for in OKLab, kept clear of
// the Spanish red, the gold of a shell's ring and the cargo, the cream of a prize's ring
// and the shallows, and checked every pair against every other, since any two captains
// may sail side by side:
//   - to normal eyes, every pair at least ΔE 16.5 apart (OKLab ×100; 15 is the floor)
//   - to red-green colour-blind eyes, at least 7.7 (8 is the target; the name over every
//     ring, and the dash below, are what make up the difference)
//   - every one at least 3:1 against the open sea seen from above (#14465A)
// They are brighter than a chart's colors would be: these are rings of light on dark
// water, read from across a room.
//
// Each comes as a solid ring and as a dashed one that turns, so fourteen captains can be
// told apart by their mark alone, and the rest by their names.

export const COLORS = ['#9AFF00', '#FF2FFC', '#FEAFFF', '#34BF02', '#14F7C9', '#C97AC6', '#628DFF'];

/** Marks a captain can be given: every color, solid then dashed. */
export const MARKS = COLORS.length * 2;

/** A captain's mark: her color, and whether her ring is the dashed one. */
export const markOf = (c: number) => ({ color: COLORS[((c % COLORS.length) + COLORS.length) % COLORS.length], dashed: c >= COLORS.length });
