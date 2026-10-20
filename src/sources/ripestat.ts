// RIPEstat Data API: https://stat.ripe.net/docs/data_api
// Looking Glass returns the current best path each RIS collector peer has for a prefix.

import type { Http } from "../http.ts";
import type { Community, Vantage } from "../types.ts";
import { locateDescription, parseCityCountry } from "../geo.ts";

const BASE = "https://stat.ripe.net/data";
const SOURCE_APP = "bgp-trombone";

function url(call: string, params: Record<string, string>): string {
  const q = new URLSearchParams({ ...params, sourceapp: SOURCE_APP });
  return `${BASE}/${call}/data.json?${q}`;
}

interface DescribedCommunity {
  description?: string;
}

interface LgPeer {
  peer: string;
  as_path: string;
  asn_origin?: number | string;
  community?: string;
  largeCommunity?: string;
  extendedCommunity?: string;
  community_info?: {
    regular?: Record<string, DescribedCommunity>;
    large?: Record<string, DescribedCommunity>;
    extended?: Record<string, DescribedCommunity>;
  };
  peer_location?: string;
  last_updated?: string;
}

interface LgResponse {
  data: {
    rrcs: { rrc: string; location?: string; peers: LgPeer[] }[];
  };
}

/** Parse "852 3320 199524 199524 202422" (AS-sets like "{1,2}" are flattened). */
export function parseAsPath(text: string): number[] {
  return text
    .replace(/[{}]/g, " ")
    .split(/[\s,]+/)
    .filter((t) => /^\d+$/.test(t))
    .map(Number);
}

/** Collapse prepends: 199524 199524 -> 199524. */
export function collapsePrepends(path: number[]): number[] {
  return path.filter((asn, i) => i === 0 || path[i - 1] !== asn);
}

function parseCommunities(peer: LgPeer): Community[] {
  const out: Community[] = [];
  const add = (raw: string | undefined, kind: Community["kind"], info?: Record<string, DescribedCommunity>) => {
    for (const value of (raw ?? "").split(/\s+/).filter(Boolean)) {
      const description = info?.[value]?.description;
      out.push({ value, kind, description, location: locateDescription(description, `${value}: ${description}`) });
    }
  };
  add(peer.community, "regular", peer.community_info?.regular);
  add(peer.largeCommunity, "large", peer.community_info?.large);
  add(peer.extendedCommunity, "extended", peer.community_info?.extended);
  return out;
}

export async function lookingGlass(http: Http, prefix: string): Promise<Vantage[]> {
  const res = await http.getJson<LgResponse>(url("looking-glass", { resource: prefix }), { ttlSeconds: 900 });
  const vantages: Vantage[] = [];
  for (const rrc of res.data?.rrcs ?? []) {
    for (const peer of rrc.peers ?? []) {
      const rawPath = parseAsPath(peer.as_path ?? "");
      if (rawPath.length === 0) continue;
      const path = collapsePrepends(rawPath);
      vantages.push({
        collector: rrc.rrc,
        collectorLocation: rrc.location,
        peerIp: peer.peer,
        peerAsn: path[0],
        peerLocation: parseCityCountry(peer.peer_location, "ris-peer"),
        rawPath,
        path,
        origin: path[path.length - 1],
        communities: parseCommunities(peer),
        lastUpdated: peer.last_updated,
      });
    }
  }
  return vantages;
}

interface NetworkInfoResponse {
  data: { asns: (string | number)[]; prefix?: string };
}

/** Which AS originates the covering prefix for an IP (used to label traceroute hops). */
export async function networkInfo(http: Http, ip: string): Promise<{ asn?: number; prefix?: string }> {
  const res = await http.getJson<NetworkInfoResponse>(url("network-info", { resource: ip }), { ttlSeconds: 7 * 86400 });
  const asn = res.data?.asns?.map(Number).find((n) => Number.isFinite(n));
  return { asn, prefix: res.data?.prefix };
}

interface AsOverviewResponse {
  data: { holder?: string };
}

export async function asHolder(http: Http, asn: number): Promise<string | undefined> {
  const res = await http.getJson<AsOverviewResponse>(url("as-overview", { resource: `AS${asn}` }), {
    ttlSeconds: 30 * 86400,
  });
  return res.data?.holder || undefined;
}
