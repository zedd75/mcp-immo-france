const USER_AGENT = "mcp-immo-france/0.2 (+https://github.com/zedd75/mcp-immo-france)";
const TIMEOUT_MS = 25_000;

interface CacheEntry {
  at: number;
  value: unknown;
}

const cache = new Map<string, CacheEntry>();
const MAX_ENTRIES = 80;

function cacheGet(key: string, ttlMs: number): unknown | undefined {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) {
    // True LRU: re-insert on access so hot entries survive eviction.
    cache.delete(key);
    cache.set(key, hit);
    return hit.value;
  }
  if (hit) cache.delete(key);
  return undefined;
}

function cacheSet(key: string, value: unknown): void {
  if (cache.size >= MAX_ENTRIES) {
    // Evict the least recently used entry to bound memory
    // (commune CSVs can be several MB each).
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly url: string,
  ) {
    super(`HTTP ${status} for ${url}`);
  }
}

async function request(url: string): Promise<Response> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new HttpError(res.status, url);
  return res;
}

export async function fetchJson<T>(url: string, ttlMs = 5 * 60_000): Promise<T> {
  const cached = cacheGet(url, ttlMs);
  if (cached !== undefined) return cached as T;
  const res = await request(url);
  const data = (await res.json()) as T;
  cacheSet(url, data);
  return data;
}

export async function fetchText(
  url: string,
  ttlMs = 6 * 60 * 60_000,
  encoding: "utf-8" | "latin1" = "utf-8",
): Promise<string> {
  const key = `${encoding}:${url}`;
  const cached = cacheGet(key, ttlMs);
  if (cached !== undefined) return cached as string;
  const res = await request(url);
  const text =
    encoding === "latin1"
      ? new TextDecoder("latin1").decode(await res.arrayBuffer())
      : await res.text();
  cacheSet(key, text);
  return text;
}
