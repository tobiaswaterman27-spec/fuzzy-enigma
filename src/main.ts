import './style.css';
import { Game } from './game/game';
import * as THREE from 'three';
import { UI } from './ui/ui';
import { createNewGame, SKIN_TONES, HAIR_COLORS, HAIR_STYLES } from './sim/newgame';
import type { Appearance } from './sim/types';
import * as sim from './sim/index';
import { loadHumanAsset, buildRealHuman } from './render/humanAsset';
import { loadModels } from './render/models';
import { CASUAL_TOPS, NIGHT_TOPS, TRACKSUITS } from './render/human';
import { requestHuman, startHumanBuilder, workerActive } from './render/humanBuilder';
import { hasHumanBuild } from './render/humanAsset';
import { buildRig, loadMocap } from './render/character';
import { hasAi, initClaudeAi, setApiKey } from './ai/openai';

// the loading screen: a real progress bar (each part ticks it on)

const bootFill = document.getElementById('boot-fill');
let bootDone = 0;
const bootTick = (_label: string, parts = 5) => { bootDone++; if (bootFill) bootFill.style.width = `${Math.min(100, (bootDone / parts) * 100)}%`; };
const ticked = <T,>(p: Promise<T>, label: string) => p.then((v) => { bootTick(label); return v; });
await Promise.all([ticked(loadHumanAsset(), 'Fitting the townspeople'), ticked(loadMocap(), 'Teaching them to walk'), ticked(loadModels(['car', 'van', 'car_lod', 'van_lod', 'saloon', 'saloon_lod', 'suv', 'suv_lod', 'sports', 'sports_lod', 'gondola_bay', 'checkout', 'sofa', 'bed', 'wardrobe', 'table', 'chair', 'tvunit', 'kitchen_base', 'cooker', 'fridge', 'coffee_table', 'bookcase', 'drawers', 'armchair', 'desk', 'sideboard', 'bedside', 'basin', 'baler', 'dumpster', 'shopbin', 'washer', 'binbag', 'carton', 'storage_shelf', 'ironing_board', 'laundry_basket', 'drying_rack', 'bike', 'vacuum', 'rack_bay', 'pallet_load', 'pallet', 'forklift', 'roller_door', 'terminal', 'locker', 'kiosk', 'notice_board', 'office_desk', 'tree', 'park_bench', 'street_bin', 'bus_shelter', 'house_plant', 'floor_lamp', 'cafe_counter', 'bistro_set', 'waiting_chairs', 'water_cooler', 'leaflet_stand', 'shoe_trainer', 'shoe_oxford', 'shoe_boot', 'site_cabin', 'cement_mixer', 'heras_panel', 'wheelbarrow', 'tool_spade', 'tool_shovel', 'tool_hammer', 'tool_drill', 'tool_roller']), 'Parking the cars')]);
bootTick('Building the city');
await new Promise((r) => setTimeout(r, 30));
const canvas = document.getElementById('view') as HTMLCanvasElement;
const seed = (Date.now() % 100000) + 1;
const OUTFITS = [['outfit_casual', 'Everyday'], ['outfit_sport', 'Tracksuit'], ['outfit_night', 'Going out'], ['outfit_smart', 'Suited']] as const;
const appearance = { frame: 'm', skin: SKIN_TONES[2], hair: 'short', hairColor: HAIR_COLORS[1], build: 'average' } as Omit<Appearance, 'outfit' | 'height'>;
const state = createNewGame(seed, { name: 'Alex Morgan', appearance });
startHumanBuilder(['shoe_trainer', 'shoe_oxford', 'shoe_boot']);
void initClaudeAi();
// build everyone's bodies in the background from the start: what they wear now, then their work uniform
for (const p of Object.values(state.people)) requestHuman(p.appearance, p.isPlayer);
for (const p of Object.values(state.people)) {
  const c = p.contractId ? state.contracts[p.contractId] : null;
  const uni = c ? state.businesses[c.businessId]?.positions.find((x) => x.id === c.positionId)?.uniform : null;
  if (uni) requestHuman({ ...p.appearance, outfit: uni });
}
const game = new Game(canvas, state);
const ui = new UI(game);
(window as any).__bigshot = { game, ui, sim, THREE, buildRig, buildRealHuman, bodies: { workerActive, hasHumanBuild } };
bootTick('Ready');

const EYE_COLORS = ['#4a6b8a', '#5a4632', '#3b2a1c', '#4f6b3a', '#6b7f8c', '#7a5a2a'] as const;
const GAITS = [['walk', 'normal'], ['walk_b', 'relaxed'], ['walk_c', 'casual'], ['walk_brisk', 'brisk'], ['walk_proud', 'confident']] as const;

// --- character creator: edits the real player appearance live
const EXTRAS: [string, string][] = [['glasses', 'Glasses'], ['sunglasses', 'Sunglasses'], ['studs', 'Ear studs'], ['hoops', 'Gold hoops'], ['chain', 'Gold chain'], ['watch', 'Watch'], ['flatcap', 'Flat cap'], ['beanie', 'Beanie'], ['cap', 'Baseball cap']];
type Shape = NonNullable<Appearance['shape']>;
const DEFAULT_SHAPE: Shape = { african: 0.33, asian: 0.33, caucasian: 0.34, muscle: 0, weight: 0, tall: 0, prop: 0.6 };

// --- character creator: tabs of sliders and swatches, editing the real player appearance live
function creator() {
  const el = document.getElementById('creator')!;
  el.hidden = false;
  document.body.classList.add('creating');
  game.uiOpen = true;
  game.camDist = 2.6;
  game.camPitch = 0.12;
  game.camYaw = Math.PI * 0.92;
  const p = () => game.state.people.player;
  // the swatches for the look chosen: tops, tracksuits or going-out shirts
  const palette = () => { const o = p().appearance.outfit; return o === 'outfit_sport' ? TRACKSUITS.map((t) => t[0]) : o === 'outfit_night' ? NIGHT_TOPS.map((t) => t[0]) : o === 'outfit_smart' ? ['#f1efe9', '#cfe0ef', '#f2e3e6', '#e9efe4'] : CASUAL_TOPS.map((t) => t[0]); };
  p().appearance.shape ??= { ...DEFAULT_SHAPE };
  let tab: 'body' | 'face' | 'hair' | 'style' | 'you' = 'body';
  const chip = (group: string, vals: readonly string[], cur: string, swatch = false) => `<div class="chips">${vals.map((v) => `<button data-g="${group}" data-v="${v}" class="${v === cur ? 'on' : ''} ${swatch ? 'swatch' : ''}" ${swatch ? `style="background:${v}" aria-label="${v}"` : ''}>${swatch ? '' : v}</button>`).join('')}</div>`;
  const slider = (key: keyof Shape | 'height', label: string, min: number, max: number, val: number, ends: [string, string]) => `<div class="slide"><span>${label}</span><input type="range" data-s="${key}" min="${min}" max="${max}" step="0.01" value="${val}"><small>${ends[0]}</small><small>${ends[1]}</small></div>`;
  const colour = (g: string, val: string) => `<label class="pick">Any colour <input type="color" data-c="${g}" value="${val}"></label>`;
  const render = () => {
    const a = p().appearance, sh = a.shape!;
    const tabs = (['body', 'face', 'hair', 'style', 'you'] as const).map((t) => `<button data-tab="${t}" class="${tab === t ? 'on' : ''}">${{ body: 'Body', face: 'Face & skin', hair: 'Hair', style: 'Style', you: 'You' }[t]}</button>`).join('');
    let body = '';
    if (tab === 'body') body = `<label>Frame</label><div class="chips">${[['m', 'masculine'], ['f', 'feminine']].map(([v, l]) => `<button data-g="frame" data-v="${v}" class="${(a.frame ?? 'm') === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${slider('height', 'Height', 0.92, 1.08, a.height ?? 1, ['shorter', 'taller'])}
      ${slider('tall', 'Build length', -1, 1, sh.tall, ['compact', 'long-limbed'])}
      ${slider('muscle', 'Muscle', -1, 1, sh.muscle, ['soft', 'muscular'])}
      ${slider('weight', 'Weight', -1, 1, sh.weight, ['lean', 'heavy'])}
      ${slider('prop', 'Proportions', 0, 1, sh.prop, ['natural', 'idealised'])}`;
    if (tab === 'face') body = `<p class="muted">Face and bone structure are a blend: drag to mix.</p>
      ${slider('african', 'African', 0, 1, sh.african, ['', ''])}${slider('asian', 'East Asian', 0, 1, sh.asian, ['', ''])}${slider('caucasian', 'European', 0, 1, sh.caucasian, ['', ''])}
      <label>Skin tone</label>${chip('skin', SKIN_TONES, a.skin, true)}${colour('skin', a.skin)}
      <label>Eyes</label>${chip('eyes', EYE_COLORS, a.eyes ?? '', true)}${colour('eyes', a.eyes ?? '#5a4632')}`;
    if (tab === 'hair') body = `<label>Style</label>${chip('hair', HAIR_STYLES, a.hair)}<label>Colour</label>${chip('hairColor', HAIR_COLORS, a.hairColor, true)}${colour('hairColor', a.hairColor)}`;
    if (tab === 'style') body = `<label>Look</label><div class="chips">${OUTFITS.map(([v, l]) => `<button data-g="outfit" data-v="${v}" class="${(a as any).outfit === v || (!(a as any).outfit && v === 'outfit_casual') ? 'on' : ''}">${l}</button>`).join('')}</div><label>Colours</label><div class="chips">${palette().map((c, i) => `<button data-g="style" data-v="${i}" class="swatch ${(a.style ?? 0) % palette().length === i && a.style !== undefined ? 'on' : ''}" style="background:${c}" aria-label="colour ${i + 1}"></button>`).join('')}</div><p class="muted">Pick the same colour again for different trousers, jackets and shoes.</p>
      <label>Hats, jewellery & glasses</label><div class="chips">${EXTRAS.map(([k, l]) => `<button data-x="${k}" class="${a.extras?.includes(k) ? 'on' : ''}">${l}</button>`).join('')}</div>
      <label>Walk</label><div class="chips">${GAITS.map(([v, l]) => `<button data-g="gait" data-v="${v}" class="${(p().gait ?? 'walk') === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    if (tab === 'you') body = `<label for="cc-name">Name</label><input id="cc-name" type="text" maxlength="24" value="${p().name}">
      <label for="cc-ai">OpenAI API key <span class="muted">(optional)</span></label>
      <input id="cc-ai" type="password" placeholder="${hasAi() ? 'Key saved in this browser - leave blank to keep it' : 'sk-… - leave blank to play without'}" autocomplete="off">
      <p class="muted" style="margin-top:4px">People answer anything you say to them, in character, from their job, family, money, mood and history. With your OpenAI key (stored only in this browser, sent only to OpenAI) they use that; playing inside claude.ai without a key, Claude voices them on your own account.</p>
      <p class="muted">Controls: W/S to walk, A/D to turn, Shift to run, E to use, F to fight, G to take a car, Space to jump (handbrake in a car), Tab for your phone.</p>`;
    el.innerHTML = `<h1>THE <span>BIGSHOT</span></h1><p class="muted">You have just moved to Harbourside with £180 in the bank and a week's rent paid.</p>
      <div class="cc-tabs">${tabs}</div><div class="cc-body">${body}</div>
      <div class="row"><button id="cc-dice" title="Randomise">🎲 Surprise me</button><button class="primary" id="cc-start">Start life in Harbourside</button></div>`;
  };
  render();
  // sliders reshape the body a moment after you stop dragging (a rebuild per pixel would crawl)
  let pending = 0;
  el.oninput = (e) => {
    const t = e.target as HTMLInputElement;
    const a = p().appearance;
    if (t.dataset.s) {
      const v = Number(t.value);
      window.clearTimeout(pending);
      pending = window.setTimeout(() => { if (t.dataset.s === 'height') a.height = v; else a.shape = { ...a.shape!, [t.dataset.s!]: v }; }, 220);
    } else if (t.dataset.c) {
      window.clearTimeout(pending);
      pending = window.setTimeout(() => { (a as any)[t.dataset.c!] = t.value; }, 220);
    }
  };
  el.onchange = (e) => { const t = e.target as HTMLInputElement; if (t.id === 'cc-name' && t.value.trim()) p().name = t.value.trim(); };
  el.onclick = (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    const a = p().appearance;
    if (b.dataset.tab) { tab = b.dataset.tab as typeof tab; render(); return; }
    if (b.id === 'cc-dice') {
      const r = Math.random, pick = <T,>(x: readonly T[]) => x[Math.floor(r() * x.length)];
      const h = [r(), r(), r()], t = h[0] + h[1] + h[2];
      a.shape = { african: h[0] / t, asian: h[1] / t, caucasian: h[2] / t, muscle: r() * 1.4 - 0.6, weight: r() * 1.4 - 0.7, tall: r() * 1.6 - 0.8, prop: 0.3 + r() * 0.6 };
      a.skin = pick(SKIN_TONES); a.hair = pick(HAIR_STYLES); a.hairColor = pick(HAIR_COLORS); a.eyes = pick(EYE_COLORS); a.height = 0.94 + r() * 0.12;
      a.extras = EXTRAS.map(([k]) => k).filter(() => r() < 0.18).filter((k, _, all) => !(k === 'glasses' && all.includes('sunglasses')));
      a.style = Math.floor(r() * 1000);
      render(); return;
    }
    if (b.id === 'cc-start') {
      const nameEl = document.getElementById('cc-name') as HTMLInputElement | null;
      if (nameEl?.value.trim()) p().name = nameEl.value.trim();
      const key = (document.getElementById('cc-ai') as HTMLInputElement | null)?.value.trim();
      if (key) setApiKey(key);
      el.hidden = true;
      game.audio.theme.play(false);
      document.body.classList.remove('creating');
      game.uiOpen = false;
      game.camDist = 4.2;
      game.camPitch = 0.22;
      game.camYaw = Math.PI;
      return;
    }
    if (b.dataset.x) {
      const k = b.dataset.x, set = new Set(a.extras ?? []);
      if (set.has(k)) set.delete(k); else { set.add(k); if (k === 'glasses') set.delete('sunglasses'); if (k === 'sunglasses') set.delete('glasses'); for (const h of ['flatcap', 'beanie', 'cap']) if (h !== k && ['flatcap', 'beanie', 'cap'].includes(k)) set.delete(h); }
      a.extras = [...set]; render(); return;
    }
    const g = b.dataset.g as keyof Appearance;
    if ((g as string) === 'gait') { p().gait = b.dataset.v === 'walk' ? undefined : b.dataset.v; render(); return; }
    if (g === 'style') {
      // keep the chosen top; step through trousers and shoes when the same top is picked again
      const cur = a.style;
      const top = Number(b.dataset.v);
      const n = palette().length;
      a.style = cur !== undefined && cur % n === top ? (cur + n * 13) % (n * 50) : top;
    } else if ((g as string) === 'outfit') {
      a.outfit = b.dataset.v!;
      const wr = p().wardrobeId ? game.state.containers[p().wardrobeId!] : null;
      if (wr && !wr.items[a.outfit]) sim.addItems(wr, a.outfit, 1);
    } else (a as any)[g] = b.dataset.v;
    render();
  };
}

const params = new URLSearchParams(location.search);
const boot = document.getElementById('boot')!;
if (params.has('skipcreator')) boot.remove();
else {
  // the title: the loading art fades away to the city itself, the camera drifting round the harbour,
  // until a key is pressed; then the music starts and the character creator opens
  boot.classList.add('title');
  document.body.classList.add('titling');
  game.uiOpen = true;
  const t0 = performance.now();
  let titling = true;
  const fly = () => { if (!titling) return; boot.style.background = `rgba(0,0,0,${game.titleShot((performance.now() - t0) / 1000).toFixed(3)})`; requestAnimationFrame(fly); };
  fly();
  const go = () => {
    window.removeEventListener('keydown', go); boot.removeEventListener('pointerdown', go);
    titling = false;
    game.freeCam = false;
    boot.style.background = '';
    document.body.classList.remove('titling');
    creator();
    game.audio.start();
    game.audio.theme.play(true);
    boot.classList.add('gone');
    window.setTimeout(() => boot.remove(), 1000);
  };
  window.addEventListener('keydown', go); boot.addEventListener('pointerdown', go);
}
game.start();
