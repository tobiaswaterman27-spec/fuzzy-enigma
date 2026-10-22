import './style.css';
import { Game } from './game/game';
import * as THREE from 'three';
import { UI } from './ui/ui';
import { createNewGame, SKIN_TONES, HAIR_COLORS, HAIR_STYLES, BUILDS } from './sim/newgame';
import type { Appearance } from './sim/types';
import * as sim from './sim/index';
import { loadHumanAsset, buildRealHuman } from './render/humanAsset';
import { loadModels } from './render/models';
import { CASUAL_TOPS } from './render/human';
import { requestHuman, startHumanBuilder, workerActive } from './render/humanBuilder';
import { hasHumanBuild } from './render/humanAsset';
import { buildRig, loadMocap } from './render/character';
import { hasAi, initClaudeAi, setApiKey } from './ai/openai';

await Promise.all([loadHumanAsset(), loadMocap(), loadModels(['car', 'van', 'car_lod', 'van_lod', 'saloon', 'saloon_lod', 'suv', 'suv_lod', 'sports', 'sports_lod', 'gondola_bay', 'checkout', 'sofa', 'bed', 'wardrobe', 'table', 'chair', 'tvunit', 'kitchen_base', 'cooker', 'fridge', 'coffee_table', 'bookcase', 'drawers', 'armchair', 'desk', 'sideboard', 'bedside', 'basin', 'baler', 'dumpster', 'shopbin', 'washer', 'binbag', 'carton', 'storage_shelf', 'ironing_board', 'laundry_basket', 'drying_rack', 'bike', 'vacuum', 'rack_bay', 'pallet_load', 'pallet', 'forklift', 'roller_door', 'terminal', 'locker', 'kiosk', 'notice_board', 'office_desk', 'tree', 'park_bench', 'street_bin', 'bus_shelter', 'house_plant', 'floor_lamp', 'cafe_counter', 'bistro_set', 'waiting_chairs', 'water_cooler', 'leaflet_stand', 'shoe_trainer', 'shoe_oxford', 'shoe_boot', 'site_cabin', 'cement_mixer', 'heras_panel', 'wheelbarrow', 'tool_spade', 'tool_shovel', 'tool_hammer', 'tool_drill', 'tool_roller'])]);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const seed = (Date.now() % 100000) + 1;
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
document.getElementById('boot')!.remove();

const EYE_COLORS = ['#4a6b8a', '#5a4632', '#3b2a1c', '#4f6b3a', '#6b7f8c', '#7a5a2a'] as const;
const GAITS = [['walk', 'normal'], ['walk_b', 'relaxed'], ['walk_c', 'casual'], ['walk_brisk', 'brisk'], ['walk_proud', 'confident']] as const;

// --- character creator: edits the real player appearance live
function creator() {
  const el = document.getElementById('creator')!;
  el.hidden = false;
  document.body.classList.add('creating');
  game.uiOpen = true;
  game.camDist = 2.6;
  game.camPitch = 0.12;
  game.camYaw = Math.PI * 0.92;
  const p = () => game.state.people.player;
  const chip = (group: string, vals: readonly string[], cur: string, swatch = false) => `<div class="chips">${vals.map((v) => `<button data-g="${group}" data-v="${v}" class="${v === cur ? 'on' : ''} ${swatch ? 'swatch' : ''}" ${swatch ? `style="background:${v}" aria-label="${v}"` : ''}>${swatch ? '' : v}</button>`).join('')}</div>`;
  const render = () => {
    const a = p().appearance;
    el.innerHTML = `<h1>THE <span>BIGSHOT</span></h1><p class="muted">You have just moved to Harbourside with Cr 180 in the bank and a week's rent paid. Make a life: work, save, and build from there.</p>
      <label for="cc-name">Name</label><input id="cc-name" type="text" maxlength="24" value="${p().name}">
      <label>Body</label><div class="chips">${[['m', 'masculine'], ['f', 'feminine']].map(([v, l]) => `<button data-g="frame" data-v="${v}" class="${(a.frame ?? 'm') === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <label>Skin</label>${chip('skin', SKIN_TONES, a.skin, true)}
      <label>Hair</label>${chip('hair', HAIR_STYLES, a.hair)}
      <label>Hair colour</label>${chip('hairColor', HAIR_COLORS, a.hairColor, true)}
      <label>Build</label>${chip('build', BUILDS, a.build)}
      <label>Everyday clothes</label><div class="chips">${CASUAL_TOPS.map(([c], i) => `<button data-g="style" data-v="${i}" class="swatch ${(a.style ?? 0) % CASUAL_TOPS.length === i && a.style !== undefined ? 'on' : ''}" style="background:${c}" aria-label="top ${i + 1}"></button>`).join('')}</div>
      <label>Height</label><div class="chips">${[0.94, 1, 1.06].map((h) => `<button data-g="height" data-v="${h}" class="${a.height === h ? 'on' : ''}">${h < 1 ? 'shorter' : h > 1 ? 'taller' : 'average'}</button>`).join('')}</div>
      <label>Eyes</label>${chip('eyes', EYE_COLORS, a.eyes ?? '', true)}
      <label>Walk</label><div class="chips">${GAITS.map(([v, l]) => `<button data-g="gait" data-v="${v}" class="${(p().gait ?? 'walk') === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      <label for="cc-ai">OpenAI API key <span class="muted">(optional)</span></label>
      <input id="cc-ai" type="password" placeholder="${hasAi() ? 'Key saved in this browser - leave blank to keep it' : 'sk-… - leave blank to play without'}" autocomplete="off">
      <p class="muted" style="margin-top:4px">People answer anything you say to them, in character, from their job, family, money, mood and history. Playing inside claude.ai, they are voiced by Claude on your own account (you will be asked to allow it the first time) and no key is needed. Elsewhere, add your OpenAI key: it is stored only in this browser and sent only to OpenAI.</p>
      <button class="primary" id="cc-start">Start life in Harbourside</button>
      <p class="muted">Controls: W/S to walk, A/D to turn, Shift to run, E to use, F to fight, G to take a car, Tab for your phone. The camera follows behind you; drag with the mouse to look around and scroll to zoom.</p>`;
  };
  render();
  el.onclick = (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.id === 'cc-start') {
      const name = (document.getElementById('cc-name') as HTMLInputElement).value.trim();
      if (name) p().name = name;
      const key = (document.getElementById('cc-ai') as HTMLInputElement).value.trim();
      if (key) setApiKey(key);
      el.hidden = true;
      document.body.classList.remove('creating');
      game.uiOpen = false;
      game.camDist = 4.2;
      game.camPitch = 0.22;
      game.camYaw = Math.PI;
      return;
    }
    const g = b.dataset.g as keyof Appearance;
    if ((g as string) === 'gait') { p().gait = b.dataset.v === 'walk' ? undefined : b.dataset.v; render(); return; }
    if (g === 'style') {
      // keep the chosen top; step through trousers and shoes when the same top is picked again
      const cur = p().appearance.style;
      const top = Number(b.dataset.v);
      p().appearance.style = cur !== undefined && cur % CASUAL_TOPS.length === top ? (cur + CASUAL_TOPS.length * 13) % 1000 : top;
    } else (p().appearance as any)[g] = g === 'height' ? Number(b.dataset.v) : b.dataset.v;
    render();
  };
}

const params = new URLSearchParams(location.search);
if (!params.has('skipcreator')) creator();
game.start();
