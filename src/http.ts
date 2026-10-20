// HTTP access with an on-disk cache, and a seam for tests and offline fixtures.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

export interface Http {
  getJson<T = unknown>(url: string, opts?: GetOptions): Promise<T>;
  getText(url: string, opts?: GetOptions): Promise<string>;
}

export interface GetOptions {
  ttlSeconds?: number;
  headers?: Record<string, string>;
}

const USER_AGENT =
  "bgp-trombone/0.1 (local network-debugging tool)" +
  (process.env.BGP_TROMBONE_CONTACT ? ` contact: ${process.env.BGP_TROMBONE_CONTACT}` : "");

export interface CachingHttpOptions {
  cacheDir?: string;
  defaultTtlSeconds?: number;
  maxConcurrent?: number;
  fetchImpl?: typeof fetch;
  log?: (msg: string) => void;
}

/** Real network access, cached on disk so repeated runs are fast and polite. */
export function cachingHttp(options: CachingHttpOptions = {}): Http {
  const cacheDir = options.cacheDir ?? join(process.cwd(), ".cache");
  const defaultTtl = options.defaultTtlSeconds ?? 3600;
  const fetchImpl = options.fetchImpl ?? fetch;
  const limit = limiter(options.maxConcurrent ?? 6);
  const log = options.log ?? (() => {});

  async function getText(url: string, opts: GetOptions = {}): Promise<string> {
    const ttl = opts.ttlSeconds ?? defaultTtl;
    const file = join(cacheDir, createHash("sha1").update(url).digest("hex"));
    try {
      const info = await stat(file);
      if ((Date.now() - info.mtimeMs) / 1000 < ttl) return await readFile(file, "utf8");
    } catch {
      // not cached yet
    }
    const body = await limit(async () => {
      log(`GET ${url}`);
      const res = await fetchImpl(url, {
        headers: { "user-agent": USER_AGENT, accept: "application/json, text/csv;q=0.9, */*;q=0.5", ...opts.headers },
        signal: AbortSignal.timeout(30_000),
      });
      if (!res.ok) throw new HttpError(url, res.status, (await res.text()).slice(0, 300));
      return await res.text();
    });
    await mkdir(cacheDir, { recursive: true });
    await writeFile(file, body);
    return body;
  }

  return {
    getText,
    async getJson<T>(url: string, opts?: GetOptions) {
      return JSON.parse(await getText(url, opts)) as T;
    },
  };
}

/**
 * Offline mode: answer requests from files in a directory.
 * The file for a URL is chosen by the first matching rule in `<dir>/routes.json`:
 *   [{ "match": "looking-glass", "file": "looking-glass.json" }, ...]
 * Unmatched URLs fail, which keeps tests honest about what they touch.
 */
export async function fixtureHttp(dir: string): Promise<Http> {
  const routes = JSON.parse(await readFile(join(dir, "routes.json"), "utf8")) as { match: string; file: string }[];
  async function getText(url: string): Promise<string> {
    const route = routes.find((r) => url.includes(r.match));
    if (!route) throw new HttpError(url, 404, "no fixture for this URL");
    return await readFile(join(dir, route.file), "utf8");
  }
  return {
    getText,
    async getJson<T>(url: string) {
      return JSON.parse(await getText(url)) as T;
    },
  };
}

export class HttpError extends Error {
  readonly url: string;
  readonly status: number;
  constructor(url: string, status: number, body: string) {
    super(`HTTP ${status} for ${url}: ${body}`);
    this.url = url;
    this.status = status;
  }
}

/** Run at most `n` tasks at once. */
export function limiter(n: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= n) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}
