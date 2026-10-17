import './style.css';
import { Game } from './game/game';
import { UI } from './ui/ui';
import { createNewGame, SKIN_TONES, HAIR_COLORS, HAIR_STYLES, BUILDS } from './sim/newgame';
import type { Appearance } from './sim/types';
import * as sim from './sim/index';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const seed = (Date.now() % 100000) + 1;
const appearance = { skin: SKIN_TONES[2], hair: 'short', hairColor: HAIR_COLORS[1], build: 'average' } as Omit<Appearance, 'outfit' | 'height'>;
const state = createNewGame(seed, { name: 'Alex Morgan', appearance });
const game = new Game(canvas, state);
const ui = new UI(game);
(window as any).__bigshot = { game, ui, sim };
document.getElementById('boot')!.remove();

// --- character creator: edits the real player appearance live
function creator() {
  const el = document.getElementById('creator')!;
  el.hidden = false;
  document.body.classList.add('creating');
  game.uiOpen = true;
  game.camDist = 4.2;
  game.camPitch = 0.3;
  game.camYaw = Math.PI * 0.85;
  const p = () => game.state.people.player;
  const chip = (group: string, vals: readonly string[], cur: string, swatch = false) => `<div class="chips">${vals.map((v) => `<button data-g="${group}" data-v="${v}" class="${v === cur ? 'on' : ''} ${swatch ? 'swatch' : ''}" ${swatch ? `style="background:${v}" aria-label="${v}"` : ''}>${swatch ? '' : v}</button>`).join('')}</div>`;
  const render = () => {
    const a = p().appearance;
    el.innerHTML = `<h1>THE <span>BIGSHOT</span></h1><p class="muted">You have just moved to Harbourside with Cr 180 in the bank and a week's rent paid. Make a life: work, save, and build from there.</p>
      <label for="cc-name">Name</label><input id="cc-name" type="text" maxlength="24" value="${p().name}">
      <label>Skin</label>${chip('skin', SKIN_TONES, a.skin, true)}
      <label>Hair</label>${chip('hair', HAIR_STYLES, a.hair)}
      <label>Hair colour</label>${chip('hairColor', HAIR_COLORS, a.hairColor, true)}
      <label>Build</label>${chip('build', BUILDS, a.build)}
      <label>Height</label><div class="chips">${[0.94, 1, 1.06].map((h) => `<button data-g="height" data-v="${h}" class="${a.height === h ? 'on' : ''}">${h < 1 ? 'shorter' : h > 1 ? 'taller' : 'average'}</button>`).join('')}</div>
      <button class="primary" id="cc-start">Start life in Harbourside</button>
      <p class="muted">Drag to turn the camera. Controls: WASD to move, E to use, Tab for your phone.</p>`;
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
      game.camDist = 9;
      game.camPitch = 0.75;
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
