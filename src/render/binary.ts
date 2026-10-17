// Fetches a binary asset. Hosts that do not serve binary types (artifact builds) get a
// base64 text copy next to it (`<name>.txt`), produced by scripts/make-artifact.mjs.
export async function fetchBinary(url: string): Promise<ArrayBuffer> {
  try {
    const r = await fetch(url);
    if (r.ok && !(r.headers.get('content-type') ?? '').includes('text/html')) return await r.arrayBuffer();
  } catch { /* fall through to the text copy */ }
  const txt = await (await fetch(url + '.txt')).text();
  const raw = atob(txt.trim());
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}
