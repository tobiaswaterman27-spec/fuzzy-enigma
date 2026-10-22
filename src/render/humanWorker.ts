// Builds people's bodies off the main thread: the body blend, garment cuts and cloth smoothing take
// around a tenth of a second each, which would otherwise freeze a frame whenever someone appears or
// changes clothes. Results come back as plain arrays (see serializeHuman / adoptHuman).
import { loadHumanAsset, serializeHuman, setHumanWorkerMode } from './humanAsset';
import { registerTemplate, templateData } from './models';
import type { Appearance } from '../sim/types';

type Msg =
  | { type: 'init'; base: string; templates: NonNullable<ReturnType<typeof templateData>>[] }
  | { type: 'build'; key: string; a: Appearance };

let ready: Promise<boolean> | null = null;
self.onmessage = async (e: MessageEvent<Msg>) => {
  const m = e.data;
  if (m.type === 'init') {
    setHumanWorkerMode();
    for (const t of m.templates) registerTemplate(t);
    ready = loadHumanAsset(m.base, false);
    (self as unknown as Worker).postMessage({ type: 'ready', ok: await ready });
    return;
  }
  if (m.type === 'build') {
    if (!ready || !(await ready)) { (self as unknown as Worker).postMessage({ type: 'failed', key: m.key, error: 'not ready' }); return; }
    try {
      const { data, transfer } = serializeHuman(m.a);
      (self as unknown as Worker).postMessage({ type: 'built', key: m.key, data }, transfer);
    } catch (err) {
      (self as unknown as Worker).postMessage({ type: 'failed', key: m.key, error: String(err) });
    }
  }
};
