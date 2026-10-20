// Parse MTR output (JSON, report/wide report, or a loosely pasted abridged trace)
// and find latency jumps that persist to the destination.

import type { LatencyJump, MtrHop } from "../types.ts";
import { KM_PER_RTT_MS, locateHostname } from "../geo.ts";

const IPV4 = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;
const IPV6 = /\b([0-9a-f]{0,4}(?::[0-9a-f]{0,4}){2,7})\b/i;

export function parseMtr(text: string): MtrHop[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{")) return parseJson(trimmed);
  const report = parseReport(trimmed);
  return report.length > 0 ? report : parseLoose(trimmed);
}

// mtr --json
function parseJson(text: string): MtrHop[] {
  const doc = JSON.parse(text) as {
    report?: { hubs?: Record<string, number | string>[] };
  };
  return (doc.report?.hubs ?? []).map((hub, i) => {
    const host = String(hub.host ?? "???");
    return finishHop({
      hop: Number(hub.count ?? i + 1),
      host,
      lossPct: num(hub["Loss%"]),
      sent: num(hub.Snt),
      avg: num(hub.Avg),
      best: num(hub.Best),
      worst: num(hub.Wrst),
    });
  });
}

// mtr -r / -rw:  "  2.|-- s99-199-69-65.bc.hsia.telus.net   0.0%   500    1.0   1.1   0.8   3.2   0.2"
// With -b the host column is "name (1.2.3.4)"; with -z an "AS852" (or "AS???") column comes first.
// 100% loss prints as "100.0" with no percent sign.
const REPORT_LINE =
  /^\s*(\d+)\.\s*(?:\|--|`--|\|-)?\s*(?:AS(\d+|\?\?\?)\s+)?(.+?)\s+(\d+(?:\.\d+)?)%?\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/;

function parseReport(text: string): MtrHop[] {
  const hops: MtrHop[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = REPORT_LINE.exec(line);
    if (!m) continue;
    const [, hop, asn, host, loss, sent, , avg, best, worst] = m;
    hops.push(
      finishHop({
        hop: Number(hop),
        host: host.trim(),
        asn: asn && asn !== "???" ? Number(asn) : undefined,
        lossPct: Number(loss),
        sent: Number(sent),
        avg: Number(avg),
        best: Number(best),
        worst: Number(worst),
      }),
    );
  }
  return hops;
}

// Abridged paste: "14. f-eh3-i.F.DE.NET.DTAG.DE   149.5 ms   Deutsche Telekom, Frankfurt"
const LOOSE_LINE = /^\s*(\d+)[.)]?\s+(\S+)\s+(?:.*?\s)?(\d+(?:\.\d+)?)\s*ms\b/i;

function parseLoose(text: string): MtrHop[] {
  const hops: MtrHop[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = LOOSE_LINE.exec(line);
    if (!m) continue;
    hops.push(finishHop({ hop: Number(m[1]), host: m[2], avg: Number(m[3]) }));
  }
  return hops;
}

function num(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number.parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : undefined;
}

function finishHop(hop: MtrHop): MtrHop {
  // "name (1.2.3.4)" from mtr -b
  const paren = /^(.*?)\s*\(([^)]+)\)$/.exec(hop.host);
  if (paren) {
    hop.host = paren[1] || paren[2];
    hop.ip = paren[2];
  } else {
    hop.ip = IPV4.exec(hop.host)?.[1] ?? (hop.host.includes(":") ? IPV6.exec(hop.host)?.[1] : undefined);
  }
  // Fully-lost hops report 0.0 for everything; treat them as silent.
  const silent = hop.host === "???" || (hop.lossPct === 100);
  hop.rtt = silent ? undefined : (hop.best ?? hop.avg);
  hop.location = locateHostname(hop.host);
  return hop;
}

/**
 * Routers often deprioritize ICMP to themselves, so a single slow hop means little.
 * What matters is latency that persists: the floor at hop i is the lowest RTT seen
 * at hop i or any later hop. A rise in the floor is real path latency.
 */
export function computeFloors(hops: MtrHop[]): MtrHop[] {
  let floor = Number.POSITIVE_INFINITY;
  for (let i = hops.length - 1; i >= 0; i--) {
    const rtt = hops[i].rtt;
    if (rtt === undefined) continue; // silent hops say nothing about the path
    floor = Math.min(floor, rtt);
    hops[i].floor = floor;
  }
  return hops;
}

export function findJumps(hops: MtrHop[], thresholdMs = 40): LatencyJump[] {
  const jumps: LatencyJump[] = [];
  let prev: MtrHop | undefined;
  for (const hop of hops) {
    if (hop.rtt === undefined || hop.floor === undefined) continue;
    if (prev?.floor !== undefined) {
      const delta = hop.floor - prev.floor;
      if (delta >= thresholdMs) {
        jumps.push({
          afterHop: prev.hop,
          toHop: hop.hop,
          deltaMs: round1(delta),
          maxExtraKm: Math.round(delta * KM_PER_RTT_MS),
        });
      }
    }
    prev = hop;
  }
  return jumps;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
