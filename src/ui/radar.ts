// The radar: a round map in the corner that turns with the camera, like GTA's. The city is drawn once
// into a big canvas (roads, buildings, parks, water); each frame a disc of it is copied round you,
// with blips on top: you, home, the waypoint, Vince's job, the police. It flashes red and blue while
// you are wanted, and zooms out when you are driving.
import type { GameState } from '../sim/types';
import { getWorld } from '../sim/world/layout';
import { CITY } from '../sim/world/city';
import { planX } from '../sim/world/levels';
import { missionGoal } from '../sim/missions';
import { homeDoor } from '../sim/npc';

const PAD = 120;
const S = 1; // pixels per metre in the base map

export class Radar {
  readonly el: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private zoom = 0.75;
  private last = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('canvas');
    this.el.id = 'radar';
    this.el.width = this.el.height = 200;
    parent.appendChild(this.el);
    this.ctx = this.el.getContext('2d')!;
  }

  private build() {
    const w = getWorld(), c = w.city;
    const cv = document.createElement('canvas');
    cv.width = (CITY.x1 - CITY.x0 + PAD * 2) * S; cv.height = (CITY.z1 - CITY.z0 + PAD * 2 + 200) * S;
    const g = cv.getContext('2d')!;
    g.setTransform(S, 0, 0, S, (PAD - CITY.x0) * S, (PAD - CITY.z0) * S);
    g.fillStyle = '#3c6e8c'; g.fillRect(CITY.x0 - PAD, CITY.z0 - PAD, CITY.x1 - CITY.x0 + PAD * 2, CITY.z1 - CITY.z0 + PAD * 2 + 200);
    g.fillStyle = '#5b6560'; g.fillRect(CITY.x0, CITY.z0, CITY.x1 - CITY.x0, CITY.z1 - CITY.z0);
    const GROUND: Record<string, string> = { paving: '#6d7470', grass: '#4f7a48', garden: '#557f4c', concrete: '#666c69', sand: '#b8a874', water: '#3c6e8c', gravel: '#7b7a70', pitch: '#4a8a44', car_park: '#5f6462' };
    const fill = (r: { x0: number; z0: number; x1: number; z1: number }, col: string) => { g.fillStyle = col; g.fillRect(r.x0, r.z0, r.x1 - r.x0, r.z1 - r.z0); };
    for (const gr of c.ground) fill(gr.rect, GROUND[gr.kind] ?? '#5b6560');
    for (const r of [...c.roads, ...w.roads]) fill(r.rect, r.kind === 'road' || r.kind === 'lane' ? '#c9ccce' : r.kind === 'grass' ? '#4f7a48' : '#7a807c');
    for (const b of c.buildings) fill(b.rect, '#363c3a');
    for (const b of w.buildings) if (!b.unit && !b.level) fill(b.rect, '#2f4a3a');
    this.base = cv;
  }

  update(state: GameState, camYaw: number, driving: boolean, waypoint: { x: number; z: number } | null, cops: { x: number; z: number; heli?: boolean }[] = []) {
    const now = performance.now();
    if (now - this.last < 60) return;
    this.last = now;
    if (!this.base) this.build();
    const p = state.people[state.playerId];
    if (!p) return;
    const ctx = this.ctx, W = this.el.width, R = W / 2 - 6;
    this.zoom += ((driving ? 0.42 : 0.8) - this.zoom) * 0.15;
    const px = planX(p.pos.x), pz = p.pos.z;
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath(); ctx.arc(W / 2, W / 2, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = '#3c6e8c'; ctx.fillRect(0, 0, W, W);
    // the map, turned so the way the camera looks is up
    ctx.translate(W / 2, W / 2); ctx.rotate(camYaw); ctx.scale(this.zoom / S, this.zoom / S);
    ctx.drawImage(this.base!, -(px - CITY.x0 + PAD) * S, -(pz - CITY.z0 + PAD) * S);
    ctx.restore();
    // blips: world position to radar position (clamped to the rim when off the edge)
    const toR = (x: number, z: number, clamp = true): [number, number, boolean] => {
      const dx = (x - px) * this.zoom, dz = (z - pz) * this.zoom;
      let sx = dx * Math.cos(camYaw) - dz * Math.sin(camYaw), sz = dx * Math.sin(camYaw) + dz * Math.cos(camYaw);
      const d = Math.hypot(sx, sz), edge = d > R - 7;
      if (edge && clamp) { sx *= (R - 7) / d; sz *= (R - 7) / d; }
      return [W / 2 + sx, W / 2 + sz, edge];
    };
    const blip = (x: number, z: number, col: string, size = 5, shape: 'dot' | 'square' | 'house' = 'dot', clamp = true) => {
      const [bx, bz, edge] = toR(x, z, clamp);
      if (edge && !clamp) return;
      ctx.fillStyle = col; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
      ctx.beginPath();
      if (shape === 'square') ctx.rect(bx - size, bz - size, size * 2, size * 2);
      else if (shape === 'house') { ctx.moveTo(bx - size, bz + size); ctx.lineTo(bx - size, bz - size * 0.2); ctx.lineTo(bx, bz - size * 1.2); ctx.lineTo(bx + size, bz - size * 0.2); ctx.lineTo(bx + size, bz + size); ctx.closePath(); }
      else ctx.arc(bx, bz, size, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
    };
    const home = p.homeId ? homeDoor(p.homeId) : null;
    if (home) blip(planX(home.x), home.z, '#4caf50', 5, 'house');
    const goal = missionGoal(state);
    if (goal) blip(planX(goal.x), goal.z, '#f4c430', 6, 'square');
    if (waypoint) blip(waypoint.x, waypoint.z, '#ffd400', 6);
    const flash = Math.floor(now / 250) % 2 === 0;
    for (const o of Object.values(state.people)) if (o.police && o.visible && !o.dead && o.where === 'outside') blip(planX(o.pos.x), o.pos.z, state.wanted ? (flash ? '#e53935' : '#1e5bff') : '#5c8dff', 3.5, 'dot', false);
    for (const c of cops) blip(c.x, c.z, flash ? '#e53935' : '#1e5bff', c.heli ? 6 : 4.5, c.heli ? 'square' : 'dot', !c.heli);
    // north
    const [nx, nz] = toR(px, pz - 1e5);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('N', nx, nz);
    // you: an arrow the way you face
    ctx.save(); ctx.translate(W / 2, W / 2); ctx.rotate(Math.PI - p.facing + camYaw);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 7); ctx.lineTo(0, 3.5); ctx.lineTo(-6, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    // the rim: flashing red and blue when they are after you
    ctx.beginPath(); ctx.arc(W / 2, W / 2, R, 0, Math.PI * 2);
    ctx.lineWidth = 6; ctx.strokeStyle = state.wanted ? (flash ? '#e53935' : '#1e5bff') : 'rgba(10,14,12,.85)'; ctx.stroke();
  }
}
