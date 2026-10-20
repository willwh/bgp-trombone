// AS names. bgp.tools publishes the whole table as one CSV, which beats hundreds of
// per-AS lookups. Anything missing falls back to RIPEstat's as-overview.
// bgp.tools asks for a descriptive User-Agent; set BGP_TROMBONE_CONTACT to add yours.

import type { Http } from "../http.ts";
import { asHolder } from "./ripestat.ts";

const BGP_TOOLS_CSV = "https://bgp.tools/asns.csv";

/** Minimal CSV line splitter that understands double-quoted fields. */
export function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

export function parseAsnCsv(csv: string): Map<number, string> {
  const names = new Map<number, string>();
  const lines = csv.split(/\r?\n/);
  for (const line of lines.slice(1)) {
    if (!line) continue;
    const [asnField, name] = splitCsvLine(line);
    const asn = Number(asnField?.replace(/^AS/i, ""));
    if (Number.isFinite(asn) && name) names.set(asn, name);
  }
  return names;
}

export async function resolveNames(
  http: Http,
  asns: Iterable<number>,
  opts: { mustResolve?: Iterable<number>; warn?: (msg: string) => void } = {},
): Promise<Record<number, string>> {
  const wanted = new Set(asns);
  const out: Record<number, string> = {};
  try {
    const table = parseAsnCsv(await http.getText(BGP_TOOLS_CSV, { ttlSeconds: 86400 }));
    for (const asn of wanted) {
      const name = table.get(asn);
      if (name) out[asn] = name;
    }
  } catch (err) {
    opts.warn?.(`AS name table unavailable (${(err as Error).message}); using RIPEstat for key ASNs only.`);
  }
  // Fall back per-AS, but only for the ones that matter, to stay polite.
  const fallback = [...new Set(opts.mustResolve ?? [])].filter((asn) => !out[asn]);
  await Promise.all(
    fallback.map(async (asn) => {
      try {
        const name = await asHolder(http, asn);
        if (name) out[asn] = name;
      } catch {
        // a missing name is cosmetic
      }
    }),
  );
  return out;
}
