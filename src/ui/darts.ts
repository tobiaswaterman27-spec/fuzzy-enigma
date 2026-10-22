// Darts at The Anchor: 301, three darts a turn, finish exactly on nothing (go under and you bust).
// The aim drifts about the board; drink and tiredness make it wander more. Click (or Space) to throw.
import type { GameState, Person } from '../sim/types';
import { drawBoard, scoreAt } from '../render/dartboard';
import { transfer } from '../sim/ledger';
import { fmtMoney, clamp } from '../sim/core';
import { lifeEvent } from '../sim/events';
import { gesture } from '../sim/talk';

const R = 140, SIZE = 360;

export function openDarts(host: HTMLElement, state: GameState, me: Person, rival: Person | null, onDone: (msg: string) => void) {
  const stake = rival ? 500 : 0;
  const left = [301, 301];
  let turn = 0, dartsLeft = 3, turnStart = 301, log: string[] = [], over = false;
  const wobble = 0.08 + Math.min(0.5, (me.drunk ?? 0) / 160) + (me.needs.energy < 30 ? 0.08 : 0);
  const skill = rival ? 0.35 + rival.traits.conscientiousness * 0.4 - Math.min(0.3, (rival.drunk ?? 0) / 250) : 0;
  host.innerHTML = `<div class="darts"><h2>Darts at The Anchor</h2>
    <p class="muted">${rival ? `301 against ${rival.name.split(' ')[0]}, ${fmtMoney(stake)} on it.` : 'Practice: 301 on your own.'} Click the board (or press Space) to throw when the aim is where you want it. Finish exactly on 0.</p>
    <canvas width="${SIZE}" height="${SIZE}"></canvas>
    <div class="dscore"></div><div class="dlog muted"></div><div class="row"><button data-quit="1">Stop playing</button></div></div>`;
  host.hidden = false;
  const cv = host.querySelector('canvas')!, c = cv.getContext('2d')!;
  const scoreEl = host.querySelector('.dscore')!, logEl = host.querySelector('.dlog')!;
  const darts: { x: number; y: number }[] = [];
  const t0 = performance.now();
  const aim = () => {
    const t = (performance.now() - t0) / 1000;
    const a = 0.55 + wobble;
    return { x: Math.sin(t * 1.7) * a * 0.6 + Math.sin(t * 3.1) * wobble * 0.5, y: Math.sin(t * 1.3 + 1) * a * 0.55 + Math.cos(t * 2.3) * wobble * 0.5 };
  };
  const render = () => {
    c.fillStyle = '#2b1d14'; c.fillRect(0, 0, SIZE, SIZE);
    drawBoard(c, SIZE / 2, SIZE / 2, R);
    for (const d of darts) { c.fillStyle = '#ffd24d'; c.beginPath(); c.arc(SIZE / 2 + d.x * R, SIZE / 2 + d.y * R, 4, 0, Math.PI * 2); c.fill(); c.strokeStyle = '#000'; c.stroke(); }
    if (!over && turn === 0) {
      const a = aim();
      const x = SIZE / 2 + a.x * R, y = SIZE / 2 + a.y * R;
      c.strokeStyle = '#fff'; c.lineWidth = 2; c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.moveTo(x - 14, y); c.lineTo(x + 14, y); c.moveTo(x, y - 14); c.lineTo(x, y + 14); c.stroke();
    }
    scoreEl.innerHTML = `<b>You ${left[0]}</b>${rival ? ` · ${rival.name.split(' ')[0]} ${left[1]}` : ''} · ${over ? 'game over' : turn === 0 ? `your throw (${dartsLeft} dart${dartsLeft > 1 ? 's' : ''} left)` : `${rival?.name.split(' ')[0]} is throwing`}`;
    logEl.textContent = log.slice(-3).join(' · ');
    if (!over) requestAnimationFrame(render);
  };
  const finish = (won: boolean | null) => {
    over = true;
    let msg = '';
    if (rival && won !== null) {
      const r = won ? transfer(state, { from: rival.accountId, to: me.accountId, amount: stake, reason: 'transfer', memo: `Darts: beat ${rival.name}`, key: `darts:${Math.floor(state.minute)}` }) : transfer(state, { from: me.accountId, to: rival.accountId, amount: stake, reason: 'transfer', memo: `Darts: lost to ${rival.name}`, key: `darts:${Math.floor(state.minute)}` });
      rival.relations[me.id] = clamp((rival.relations[me.id] ?? 0) + 4, 0, 100);
      gesture(state, rival, won ? 'shrug' : 'laugh', 2.5);
      if (won) { me.dartsWon = (me.dartsWon ?? 0) + 1; lifeEvent(state, me, `Beat ${rival.name} at darts`); }
      msg = won ? `You win! ${r.ok ? fmtMoney(stake) : ''} from ${rival.name.split(' ')[0]}.` : `${rival.name.split(' ')[0]} wins. ${r.ok ? `${fmtMoney(stake)} lost.` : ''}`;
    } else if (won) msg = 'Checked out! Nicely done.';
    log.push(msg);
    render();
    setTimeout(() => { host.hidden = true; onDone(msg); }, won === null ? 0 : 2200);
  };
  const score = (who: number, s: number, label: string) => {
    const nl = left[who] - s;
    if (nl < 0 || nl === 1) { log.push(`${who ? rival!.name.split(' ')[0] : 'You'}: ${label} - bust!`); left[who] = turnStart; return 'bust'; }
    left[who] = nl;
    log.push(`${who ? rival!.name.split(' ')[0] : 'You'}: ${label}`);
    return nl === 0 ? 'won' : 'ok';
  };
  const rivalTurn = () => {
    turn = 1; turnStart = left[1]; darts.length = 0;
    let n = 0;
    const one = () => {
      if (over) return;
      // aim at a treble 20, or straight for the finish; skill decides how close they get
      const want = left[1] <= 50 ? { x: 0, y: 0 } : { x: 0, y: -0.6 };
      const spread = 0.42 - skill * 0.55;
      const d = { x: want.x + (Math.random() - 0.5) * spread * 2, y: want.y + (Math.random() - 0.5) * spread * 2 };
      darts.push(d);
      const r = score(1, scoreAt(d.x, d.y).score, scoreAt(d.x, d.y).label);
      n++;
      if (r === 'won') return finish(false);
      if (r === 'bust' || n === 3) { setTimeout(() => { turn = 0; dartsLeft = 3; turnStart = left[0]; darts.length = 0; }, 900); return; }
      setTimeout(one, 700);
    };
    setTimeout(one, 600);
  };
  const throwDart = () => {
    if (over || turn !== 0) return;
    const a = aim();
    const d = { x: a.x + (Math.random() - 0.5) * wobble * 0.3, y: a.y + (Math.random() - 0.5) * wobble * 0.3 };
    darts.push(d);
    gesture(state, me, 'punch', 0.6);
    const s = scoreAt(d.x, d.y);
    const r = score(0, s.score, s.label);
    dartsLeft--;
    if (r === 'won') return finish(true);
    if (r === 'bust' || dartsLeft === 0) { if (rival) setTimeout(rivalTurn, 700); else setTimeout(() => { dartsLeft = 3; turnStart = left[0]; darts.length = 0; }, 700); }
  };
  cv.addEventListener('click', throwDart);
  const key = (e: KeyboardEvent) => { if (e.code === 'Space') { e.preventDefault(); throwDart(); } if (over) window.removeEventListener('keydown', key); };
  window.addEventListener('keydown', key);
  host.querySelector('[data-quit]')!.addEventListener('click', () => { window.removeEventListener('keydown', key); finish(null); });
  render();
}
