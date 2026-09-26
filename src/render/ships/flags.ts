// Colours a ship flies, painted once onto small canvases. The Jackdaw's is the black
// flag; the Spanish fly the Cross of Burgundy, as their navy did in 1715.

import * as THREE from 'three';
import type { FlagKind } from '../../data/types';

const cache = new Map<FlagKind, THREE.Texture>();

function paint(kind: FlagKind): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 168;
  const c = cv.getContext('2d')!;
  c.scale(2, 2);
  const W = cv.width / 2, H = cv.height / 2;
  if (kind === 'black') {
    c.fillStyle = '#0D0D0E'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#EDE6D4';
    // skull
    c.beginPath(); c.ellipse(W / 2, H * 0.4, 15, 14, 0, 0, Math.PI * 2); c.fill();
    c.fillRect(W / 2 - 9, H * 0.48, 18, 11);
    c.fillStyle = '#0D0D0E';
    c.beginPath(); c.arc(W / 2 - 6, H * 0.4, 4.5, 0, Math.PI * 2); c.arc(W / 2 + 6, H * 0.4, 4.5, 0, Math.PI * 2); c.fill();
    c.fillRect(W / 2 - 1.5, H * 0.47, 3, 5);
    // crossed bones
    c.strokeStyle = '#EDE6D4'; c.lineWidth = 6; c.lineCap = 'round';
    c.beginPath(); c.moveTo(W / 2 - 26, H * 0.66); c.lineTo(W / 2 + 26, H * 0.9);
    c.moveTo(W / 2 + 26, H * 0.66); c.lineTo(W / 2 - 26, H * 0.9); c.stroke();
  } else if (kind === 'spain') {
    c.fillStyle = '#F1ECDD'; c.fillRect(0, 0, W, H);
    c.strokeStyle = '#B3262A'; c.lineWidth = 11; c.lineCap = 'butt';
    c.beginPath(); c.moveTo(10, 8); c.lineTo(W - 10, H - 8); c.moveTo(W - 10, 8); c.lineTo(10, H - 8); c.stroke();
  } else if (kind === 'england') {
    c.fillStyle = '#A8242A'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#1E3A7A'; c.fillRect(0, 0, W * 0.45, H * 0.5);
    c.strokeStyle = '#F1ECDD'; c.lineWidth = 7;
    c.beginPath(); c.moveTo(W * 0.225, 0); c.lineTo(W * 0.225, H * 0.5); c.moveTo(0, H * 0.25); c.lineTo(W * 0.45, H * 0.25); c.stroke();
    c.strokeStyle = '#C8262C'; c.lineWidth = 3.5; c.stroke();
  } else if (kind === 'white') {
    c.fillStyle = '#FAF8F1'; c.fillRect(0, 0, W, H);
  } else if (kind === 'crimson') {
    c.fillStyle = '#6E1B22'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#1A0B0D'; c.fillRect(0, H * 0.4, W, H * 0.2);
  } else {
    c.fillStyle = '#D9A441'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#8A5F1B';
    c.beginPath(); c.arc(W / 2, H / 2, 18, 0, Math.PI * 2); c.fill();
  }
  // a little weathering
  c.globalAlpha = 0.12; c.fillStyle = '#000';
  for (let i = 0; i < 40; i++) c.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  return cv;
}

export function flagTexture(kind: FlagKind): THREE.Texture | null {
  if (cache.has(kind)) return cache.get(kind)!;
  const cv = paint(kind);
  if (!cv) return null;
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  cache.set(kind, t);
  return t;
}
