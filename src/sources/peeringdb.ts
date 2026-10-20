// PeeringDB: where two networks are both present, i.e. where they could interconnect.
// Anonymous access is rate-limited; set PEERINGDB_API_KEY for a higher allowance.

import type { Http } from "../http.ts";
import type { Exchange, Facility, Interconnect } from "../types.ts";
import { continentOf } from "../geo.ts";

const BASE = "https://www.peeringdb.com/api";
const TTL = 7 * 86400;

function headers(): Record<string, string> {
  const key = process.env.PEERINGDB_API_KEY;
  return key ? { authorization: `Api-Key ${key}` } : {};
}

interface NetFac {
  fac_id: number;
  name: string;
  city?: string;
  country?: string;
}

interface NetIxLan {
  ix_id: number;
  name: string;
}

interface Ix {
  id: number;
  name: string;
  city?: string;
  country?: string;
}

async function facilities(http: Http, asn: number): Promise<Facility[]> {
  const res = await http.getJson<{ data: NetFac[] }>(`${BASE}/netfac?local_asn=${asn}`, { ttlSeconds: TTL, headers: headers() });
  return res.data.map((f) => ({ id: f.fac_id, name: f.name, city: f.city, country: f.country, continent: continentOf(f.country) }));
}

async function exchangeIds(http: Http, asn: number): Promise<Map<number, string>> {
  const res = await http.getJson<{ data: NetIxLan[] }>(`${BASE}/netixlan?asn=${asn}`, { ttlSeconds: TTL, headers: headers() });
  return new Map(res.data.map((l) => [l.ix_id, l.name]));
}

async function exchangeDetails(http: Http, ids: number[]): Promise<Map<number, Ix>> {
  if (ids.length === 0) return new Map();
  const res = await http.getJson<{ data: Ix[] }>(`${BASE}/ix?id__in=${ids.join(",")}`, { ttlSeconds: TTL, headers: headers() });
  return new Map(res.data.map((ix) => [ix.id, ix]));
}

/** Facilities and exchanges where both ASNs are present. */
export async function commonInterconnects(http: Http, a: number, b: number): Promise<Interconnect> {
  try {
    const [facA, facB, ixA, ixB] = await Promise.all([
      facilities(http, a),
      facilities(http, b),
      exchangeIds(http, a),
      exchangeIds(http, b),
    ]);
    const idsB = new Set(facB.map((f) => f.id));
    const commonFacilities = dedupeById(facA.filter((f) => idsB.has(f.id)));
    const commonIxIds = [...ixA.keys()].filter((id) => ixB.has(id));
    const details = await exchangeDetails(http, commonIxIds);
    const commonExchanges: Exchange[] = commonIxIds.map((id) => {
      const ix = details.get(id);
      return { id, name: ix?.name ?? ixA.get(id) ?? `IX ${id}`, city: ix?.city, country: ix?.country, continent: continentOf(ix?.country) };
    });
    return { a, b, commonFacilities, commonExchanges };
  } catch (err) {
    return { a, b, commonFacilities: [], commonExchanges: [], error: (err as Error).message };
  }
}

function dedupeById<T extends { id: number }>(items: T[]): T[] {
  return [...new Map(items.map((i) => [i.id, i])).values()];
}
