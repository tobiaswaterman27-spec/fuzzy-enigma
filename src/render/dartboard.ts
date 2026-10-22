// A dartboard: twenty segments in the standard order, doubles and trebles rings, outer and inner bull.
import * as THREE from 'three';

export const BOARD_ORDER = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
/** radii as fractions of the doubles ring's outer edge */
export const RINGS = { bull: 0.037, outerBull: 0.094, trebleIn: 0.582, trebleOut: 0.629, doubleIn: 0.953, doubleOut: 1 };

/** draw the board into a 2D context centred at (cx, cy) with the doubles ring at radius r */
export function drawBoard(c: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  c.fillStyle = '#111'; c.beginPath(); c.arc(cx, cy, r * 1.3, 0, Math.PI * 2); c.fill();
  for (let i = 0; i < 20; i++) {
    const a0 = -Math.PI / 2 + (i - 0.5) * (Math.PI / 10), a1 = a0 + Math.PI / 10;
    const dark = i % 2 === 0;
    const ring = (rin: number, rout: number, col: string) => { c.fillStyle = col; c.beginPath(); c.arc(cx, cy, r * rout, a0, a1); c.arc(cx, cy, r * rin, a1, a0, true); c.closePath(); c.fill(); };
    ring(RINGS.outerBull, RINGS.trebleIn, dark ? '#1a1a1a' : '#efe3c2');
    ring(RINGS.trebleIn, RINGS.trebleOut, dark ? '#c0392b' : '#1e8449');
    ring(RINGS.trebleOut, RINGS.doubleIn, dark ? '#1a1a1a' : '#efe3c2');
    ring(RINGS.doubleIn, RINGS.doubleOut, dark ? '#c0392b' : '#1e8449');
    c.fillStyle = '#f5f5f5'; c.font = `bold ${Math.round(r * 0.13)}px sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    const am = -Math.PI / 2 + i * (Math.PI / 10);
    c.fillText(String(BOARD_ORDER[i]), cx + Math.cos(am) * r * 1.15, cy + Math.sin(am) * r * 1.15);
  }
  c.fillStyle = '#1e8449'; c.beginPath(); c.arc(cx, cy, r * RINGS.outerBull, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#c0392b'; c.beginPath(); c.arc(cx, cy, r * RINGS.bull, 0, Math.PI * 2); c.fill();
}

/** score of a dart at (dx, dy) from the centre, as a fraction of the doubles radius (y down) */
export function scoreAt(dx: number, dy: number): { score: number; label: string } {
  const d = Math.hypot(dx, dy);
  if (d <= RINGS.bull) return { score: 50, label: 'BULLSEYE!' };
  if (d <= RINGS.outerBull) return { score: 25, label: '25' };
  if (d > RINGS.doubleOut) return { score: 0, label: 'Missed the board' };
  let a = Math.atan2(dy, dx) + Math.PI / 2 + Math.PI / 20;
  a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const n = BOARD_ORDER[Math.floor(a / (Math.PI / 10)) % 20];
  if (d >= RINGS.trebleIn && d <= RINGS.trebleOut) return { score: n * 3, label: `Treble ${n}` };
  if (d >= RINGS.doubleIn) return { score: n * 2, label: `Double ${n}` };
  return { score: n, label: String(n) };
}

export function dartboardMesh(): THREE.Mesh {
  const cv = document.createElement('canvas'); cv.width = cv.height = 512;
  drawBoard(cv.getContext('2d')!, 256, 256, 196);
  const m = new THREE.Mesh(new THREE.CircleGeometry(0.29, 48), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cv), roughness: 0.8 }));
  return m;
}
