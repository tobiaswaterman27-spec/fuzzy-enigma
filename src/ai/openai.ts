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
/** Inside claude.ai the page's network is closed (so OpenAI cannot be reached from it), but the
 * page may ask Claude through the viewer's own account. When that is available it voices the people. */
type SampleFn = ((input: unknown, opts?: unknown) => Promise<{ text: string }>) & { json: (input: unknown, opts?: unknown) => Promise<unknown> };
let sampleFn: SampleFn | null = null;
export async function initClaudeAi() {
  try { const c = (window as any).claude; if (c?.use) sampleFn = (await c.use('sample')) as SampleFn | null; } catch { sampleFn = null; }
}
export const claudeAi = () => !!sampleFn;
export const hasAi = () => !!getApiKey() || !!sampleFn;

/** the same conversation, as Claude's page sampling takes it: instructions as a leading user turn */
async function viaClaude(messages: ChatTurn[], maxTokens: number): Promise<{ data: unknown } | { error: string }> {
  const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const turns: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: `${sys}\n\nKeep replies short (about ${Math.round(maxTokens * 0.6)} words at most). Reply with only the JSON object described, no other text.` }];
  for (const m of messages) if (m.role !== 'system' && m.content.trim()) turns.push({ role: m.role, content: m.content });
  if (turns[turns.length - 1].role !== 'user') turns.push({ role: 'user', content: '(go on)' });
  try {
    return { data: await sampleFn!.json(turns, { modelTier: 'quick', cache: false }) };
  } catch (e) {
    const code = (e as { code?: string })?.code ?? 'upstream_error';
    if (code === 'not_granted' || code === 'sampling_disabled' || code === 'capability_disabled' || code === 'not_declared') { sampleFn = null; return { error: 'Claude is not allowed for this page, so people cannot talk. Allow it in the page\'s permissions, or add an OpenAI key (Menu).' }; }
    if (code === 'rate_limited') return { error: 'Too many conversations at once: give it a moment.' };
    if (code === 'invalid_json') return { data: { reply: String((e as { text?: string }).text ?? '').slice(0, 400) } };
    return { error: `Claude could not answer (${code}).` };
  }
}

export interface ChatTurn { role: 'system' | 'user' | 'assistant'; content: string }

/** a JSON answer from the model (parsed), or an error to show */
export async function aiJson(messages: ChatTurn[], maxTokens = 220, signal?: AbortSignal): Promise<{ data: unknown } | { error: string }> {
  // your own OpenAI key comes first; Claude (inside claude.ai) when there is no key or OpenAI cannot be reached
  const key = getApiKey();
  if (!key) return sampleFn ? viaClaude(messages, maxTokens) : { error: 'No AI available: add an OpenAI key (Menu).' };
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
    if (sampleFn && !signal?.aborted) return viaClaude(messages, maxTokens);
    return { error: `Could not reach OpenAI (${(e as Error).message}). If you are playing inside claude.ai, allow Claude for this page instead.` };
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
