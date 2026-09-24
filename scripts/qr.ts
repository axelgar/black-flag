// Print a QR code for every ship on the register: `npm run qr [-- https://your.site]`.
// Writes qr/<ship>-<code>.svg and .png, each opening https://<site>/u/<CODE>. The codes
// are plain shared links by design — whoever scans one gets the ship.

import { mkdirSync, writeFileSync } from 'node:fs';
import QRCode from 'qrcode';
import { CODES, unlockPath } from '../src/data/unlocks';

const site = (process.argv[2] || 'https://black-flag-two.vercel.app').replace(/\/+$/, '');
mkdirSync('qr', { recursive: true });

for (const { ship, code } of CODES) {
  const url = `${site}${unlockPath(code)}`;
  const base = `qr/${ship}-${code}`;
  writeFileSync(`${base}.svg`, await QRCode.toString(url, { type: 'svg', margin: 2, errorCorrectionLevel: 'M' }));
  await QRCode.toFile(`${base}.png`, url, { width: 1024, margin: 2, errorCorrectionLevel: 'M' });
  console.log(`${ship.padEnd(10)} ${url}`);
}
