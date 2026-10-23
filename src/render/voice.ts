// Voices, from the browser's own speech synthesis: the townspeople say their lines out loud (each with
// their own pitch and pace, a British voice where the browser has one), and the radio DJs drop in
// between tracks. Quieter the further off someone is; nothing at all if the browser cannot speak.
const synth: SpeechSynthesis | null = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

let voices: SpeechSynthesisVoice[] = [];
const load = () => { voices = synth?.getVoices() ?? []; };
if (synth) { load(); synth.onvoiceschanged = load; }

const FEMALE = /female|hazel|libby|sonia|maisie|kate|serena|susan|emily|amy|fiona|moira|tessa|karen|samantha|victoria|zira/i;
const MALE = /male|george|ryan|thomas|daniel|oliver|arthur|alex|fred|david|mark|james|rishi/i;

function pick(female: boolean, seed: number): SpeechSynthesisVoice | null {
  if (!voices.length) return null;
  const en = voices.filter((v) => /^en/i.test(v.lang));
  const gb = en.filter((v) => /GB|UK/i.test(v.lang) || /UK|British/i.test(v.name));
  const pool = (gb.length ? gb : en.length ? en : voices);
  const match = pool.filter((v) => (female ? FEMALE.test(v.name) && !/\bmale/i.test(v.name.replace(/female/i, '')) : MALE.test(v.name) && !FEMALE.test(v.name)));
  const list = match.length ? match : pool;
  return list[seed % list.length];
}

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };

export const voice = {
  on: (() => { try { return localStorage.getItem('bigshot.voices') !== 'off'; } catch { return true; } })(),
  set(on: boolean) { this.on = on; try { localStorage.setItem('bigshot.voices', on ? 'on' : 'off'); } catch { /* */ } if (!on) synth?.cancel(); },
  get available() { return !!synth; },
  /** someone says a line: id picks their voice, dist (metres) sets how loud */
  say(id: string, text: string, female: boolean, dist = 3, muted = false) {
    if (!synth || !this.on || muted || dist > 22 || !text.trim()) return;
    // a backlog of chatter is dropped rather than read out late
    if (synth.pending) synth.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[*_#]/g, '').slice(0, 300));
    const h = hash(id);
    const v = pick(female, h);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-GB';
    u.pitch = (female ? 1.05 : 0.85) + ((h >> 4) % 100) / 300;
    u.rate = 0.92 + ((h >> 12) % 100) / 600;
    u.volume = Math.max(0.15, Math.min(1, 1 - dist / 24));
    synth.speak(u);
  },
  /** the DJ, over the radio */
  dj(text: string, female: boolean, muted = false) {
    if (!synth || !this.on || muted || synth.speaking) return;
    const u = new SpeechSynthesisUtterance(text);
    const v = pick(female, female ? 3 : 7);
    if (v) { u.voice = v; u.lang = v.lang; } else u.lang = 'en-GB';
    u.rate = 1.12; u.pitch = female ? 1.15 : 0.95; u.volume = 0.8;
    synth.speak(u);
  },
  stop() { synth?.cancel(); },
};
