// The Black Flag ticket card: `npm run qr [-- https://your.site]`. The bartender holds it
// out with every Black Flag. Prints the link to write to the card's NFC tag, and writes
// the QR code for its back (for phones without NFC) to qr/ticket.svg and qr/ticket.png.
// The links are plain by design (PLANS/MVP.md): a ticket is one a phone a night.
//
// The TV's own QR code gives practice, not a ticket: it is the plain site.

import { mkdirSync, writeFileSync } from 'node:fs';
import QRCode from 'qrcode';

/** On the register in supabase/migrations as 'ticket:black-flag'. */
const CODE = 'BLACKFLAG';

const site = (process.argv[2] || 'https://black-flag-two.vercel.app').replace(/\/+$/, '');
const tag = `${site}/u/${CODE}?src=nfc`, card = `${site}/u/${CODE}`;
mkdirSync('qr', { recursive: true });
writeFileSync('qr/ticket.svg', await QRCode.toString(card, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }));
await QRCode.toFile('qr/ticket.png', card, { width: 1024, margin: 2, errorCorrectionLevel: 'M' });
console.log(`NFC tag:       ${tag}`);
console.log(`QR (the back): ${card}   → qr/ticket.svg, qr/ticket.png`);
