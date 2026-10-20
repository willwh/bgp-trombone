// Build an AnalyzeContext for live use or for offline fixtures.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cachingHttp, fixtureHttp } from "./http.ts";
import { defaultResolveHost, type AnalyzeContext } from "./analyze.ts";

export async function makeContext(opts: { fixtures?: string; verbose?: boolean }): Promise<AnalyzeContext> {
  const log = opts.verbose ? (msg: string) => console.error(`· ${msg}`) : undefined;
  if (opts.fixtures) {
    let dns: Record<string, string> = {};
    try {
      dns = JSON.parse(await readFile(join(opts.fixtures, "dns.json"), "utf8"));
    } catch {
      // no fixture DNS; hostnames stay unresolved
    }
    return { http: await fixtureHttp(opts.fixtures), resolveHost: async (h) => dns[h], log };
  }
  return { http: cachingHttp({ log }), resolveHost: defaultResolveHost, log };
}
