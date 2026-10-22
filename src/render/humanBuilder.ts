// Asks the worker for bodies and adopts them into the build cache. If workers are unavailable (or the
// worker fails), bodies are built on the main thread instead, one at a time between frames.
import type { Appearance } from '../sim/types';
import { adoptHuman, appearanceKey, buildRealHuman, hasHumanBuild, humanAsset, type HumanData } from './humanAsset';
import { templateData } from './models';
import HumanWorker from './humanWorker?worker&inline';

let worker: Worker | null = null;
let workerOk = false;
const pending = new Map<string, Appearance>();
const queue: { key: string; a: Appearance }[] = [];
let inFlight = 0;
const MAX_IN_FLIGHT = 2;

export function startHumanBuilder(shoeStyles: string[]) {
  try {
    worker = new HumanWorker();
    worker.onmessage = (e: MessageEvent<any>) => {
      const m = e.data;
      if (m.type === 'ready') { workerOk = !!m.ok; pump(); return; }
      if (m.type === 'built') {
        inFlight--;
        const a = pending.get(m.key);
        pending.delete(m.key);
        if (a && !hasHumanBuild(a)) adoptHuman(a, m.data as HumanData);
        pump();
      }
      if (m.type === 'failed') { inFlight--; console.warn('body build failed in worker', m.error); workerOk = false; }
    };
    worker.onerror = (e) => { console.warn('body worker unavailable', e.message); workerOk = false; worker = null; };
    const base = new URL('assets/human/', location.href).href;
    worker.postMessage({ type: 'init', base, templates: shoeStyles.map(templateData).filter(Boolean) });
  } catch (e) {
    console.warn('no worker for bodies', e);
    worker = null;
  }
}

function pump() {
  if (!worker || !workerOk) return;
  while (inFlight < MAX_IN_FLIGHT && queue.length) {
    const job = queue.shift()!;
    if (hasHumanBuild(job.a)) { pending.delete(job.key); continue; }
    inFlight++;
    worker.postMessage({ type: 'build', key: job.key, a: job.a });
  }
}

/** true when this appearance's body is ready to use; otherwise it is requested (first come, first served,
 * or first in line with `urgent`) */
export function requestHuman(a: Appearance, urgent = false): boolean {
  if (!humanAsset()) return true; // procedural bodies are cheap
  if (hasHumanBuild(a)) return true;
  const key = appearanceKey(a);
  if (!pending.has(key)) {
    pending.set(key, a);
    if (urgent) queue.unshift({ key, a }); else queue.push({ key, a });
  } else if (urgent) {
    const i = queue.findIndex((q) => q.key === key);
    if (i > 0) queue.unshift(...queue.splice(i, 1));
  }
  pump();
  return false;
}

/** without a worker: build one queued body now (call when the frame has time to spare) */
export function buildOneOnMainThread(): boolean {
  if (worker && workerOk) return false;
  const job = queue.shift();
  if (!job) return false;
  pending.delete(job.key);
  if (!hasHumanBuild(job.a)) buildRealHuman(job.a);
  return true;
}

export const workerActive = () => !!worker && workerOk;
