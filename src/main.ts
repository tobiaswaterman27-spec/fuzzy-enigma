import './style.css';
import { Game } from './game/game';
import * as THREE from 'three';
import { UI } from './ui/ui';
import { createNewGame, SKIN_TONES, HAIR_COLORS, HAIR_STYLES, BUILDS } from './sim/newgame';
import type { Appearance } from './sim/types';
import * as sim from './sim/index';
import { loadHumanAsset, buildRealHuman } from './render/humanAsset';
import { loadModels } from './render/models';
import { buildRig, loadMocap } from './render/character';

await Promise.all([loadHumanAsset(), loadMocap(), loadModels(['car', 'van', 'gondola_bay', 'checkout', 'sofa', 'bed', 'wardrobe', 'table', 'chair', 'tvunit', 'kitchen_base', 'cooker', 'fridge', 'coffee_table', 'bookcase', 'drawers', 'armchair', 'desk', 'sideboard', 'bedside', 'basin', 'baler', 'dumpster', 'shopbin', 'washer', 'binbag', 'carton', 'storage_shelf', 'ironing_board', 'laundry_basket', 'drying_rack', 'bike', 'vacuum', 'rack_bay', 'pallet_load', 'pallet', 'forklift', 'roller_door', 'terminal', 'locker', 'kiosk', 'notice_board', 'office_desk', 'tree', 'park_bench', 'street_bin', 'bus_shelter', 'house_plant', 'floor_lamp', 'cafe_counter', 'bistro_set', 'waiting_chairs', 'water_cooler', 'leaflet_stand', 'shoe_trainer', 'shoe_oxford', 'shoe_boot', 'site_cabin', 'cement_mixer', 'heras_panel', 'wheelbarrow', 'tool_spade', 'tool_shovel', 'tool_hammer', 'tool_drill', 'tool_roller'])]);
const canvas = document.getElementById('view') as HTMLCanvasElement;
const seed = (Date.now() % 100000) + 1;
const appearance = { frame: 'm', skin: SKIN_TONES[2], hair: 'short', hairColor: HAIR_COLORS[1], build: 'average' } as Omit<Appearance, 'outfit' | 'height'>;
const state = createNewGame(seed, { name: 'Alex Morgan', appearance });
const game = new Game(canvas, state);
const ui = new UI(game);
(window as any).__bigshot = { game, ui, sim, THREE, buildRig, buildRealHuman };
document.getElementById('boot')!.remove();

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
      <label>Height</label><div class="chips">${[0.94, 1, 1.06].map((h) => `<button data-g="height" data-v="${h}" class="${a.height === h ? 'on' : ''}">${h < 1 ? 'shorter' : h > 1 ? 'taller' : 'average'}</button>`).join('')}</div>
      <button class="primary" id="cc-start">Start life in Harbourside</button>
      <p class="muted">Controls: WASD to walk (the camera follows behind you), Shift to run, E to use, Tab for your phone. The camera follows you.</p>`;
  };
  render();
  el.onclick = (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.id === 'cc-start') {
      const name = (document.getElementById('cc-name') as HTMLInputElement).value.trim();
      if (name) p().name = name;
      el.hidden = true;
      document.body.classList.remove('creating');
      game.uiOpen = false;
      game.camDist = 4.2;
      game.camPitch = 0.22;
      game.camYaw = Math.PI;
      return;
    }
    const g = b.dataset.g as keyof Appearance;
    (p().appearance as any)[g] = g === 'height' ? Number(b.dataset.v) : b.dataset.v;
    render();
  };
}

const params = new URLSearchParams(location.search);
if (!params.has('skipcreator')) creator();
game.start();
