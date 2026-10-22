// Optional AI conversations: with the player's own OpenAI API key, townspeople reply in character.
// The key is kept only in this browser (localStorage) and sent only to api.openai.com. Without a key
// (or if a request fails) conversations use the built-in replies.
const KEY = 'bigshot.openai';
const MODEL_KEY = 'bigshot.openai.model';
export const DEFAULT_MODEL = 'gpt-4o-mini';

export function getApiKey(): string | null {
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}
export function setApiKey(k: string | null) {
  try { if (k) localStorage.setItem(KEY, k.trim()); else localStorage.removeItem(KEY); } catch { /* storage blocked */ }
}
export function getModel(): string {
  try { return localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL; } catch { return DEFAULT_MODEL; }
}
export function setModel(m: string) {
  try { localStorage.setItem(MODEL_KEY, m.trim() || DEFAULT_MODEL); } catch { /* storage blocked */ }
}
export const hasAi = () => !!getApiKey();

export interface ChatTurn { role: 'system' | 'user' | 'assistant'; content: string }

/** a JSON answer from the model (parsed), or an error to show */
export async function aiJson(messages: ChatTurn[], maxTokens = 220, signal?: AbortSignal): Promise<{ data: unknown } | { error: string }> {
  const key = getApiKey();
  if (!key) return { error: 'No API key set.' };
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: getModel(), messages, temperature: 0.9, max_tokens: maxTokens, response_format: { type: 'json_object' } }),
      signal,
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return { error: r.status === 401 ? 'Your OpenAI key was rejected. Check it in Menu.' : r.status === 429 ? 'OpenAI says too many requests or no credit left on the key.' : `The AI service said ${r.status}${t ? `: ${t.slice(0, 120)}` : ''}` };
    }
    const j = await r.json();
    const content = j.choices?.[0]?.message?.content ?? '';
    try { return { data: JSON.parse(content) }; } catch { return { data: { reply: String(content) } }; }
  } catch (e) {
    return { error: `Could not reach OpenAI (${(e as Error).message}).` };
  }
}

/** one reply in character: { reply, attitude } parsed from the model's JSON, or an error */
export async function aiReply(messages: ChatTurn[], signal?: AbortSignal): Promise<{ reply: string; attitude: number } | { error: string }> {
  const key = getApiKey();
  if (!key) return { error: 'No API key set.' };
  try {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: getModel(), messages, temperature: 0.8, max_tokens: 160, response_format: { type: 'json_object' } }),
      signal,
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      return { error: r.status === 401 ? 'The API key was rejected.' : `The AI service said ${r.status}${t ? `: ${t.slice(0, 120)}` : ''}` };
    }
    const j = await r.json();
    const content = j.choices?.[0]?.message?.content ?? '';
    try {
      const o = JSON.parse(content);
      return { reply: String(o.reply ?? '').slice(0, 400), attitude: Number(o.attitude) || 0 };
    } catch {
      return { reply: String(content).slice(0, 400), attitude: 0 };
    }
  } catch (e) {
    return { error: `Could not reach the AI service (${(e as Error).message}).` };
  }
}
