// Put it all together: fetch the BGP view, read the trace, and decide whether it trombones.

import { lookup } from "node:dns/promises";
import type { Http } from "./http.ts";
import type {
  AnalyzeOptions,
  Continent,
  LatencyJump,
  Location,
  MtrHop,
  Report,
  UpstreamShare,
  Vantage,
  Verdict,
} from "./types.ts";
import { lookingGlass, networkInfo } from "./sources/ripestat.ts";
import { resolveNames } from "./sources/asnames.ts";
import { commonInterconnects } from "./sources/peeringdb.ts";
import { buildGraph, handoffAs, originSuffix } from "./analysis/graph.ts";
import { computeFloors, findJumps, parseMtr } from "./analysis/mtr.ts";
import { CONTINENT_NAMES, parseCityCountry } from "./geo.ts";

export interface AnalyzeContext {
  http: Http;
  /** Resolve a hostname to an IP. Injected so tests and fixtures stay offline. */
  resolveHost?: (host: string) => Promise<string | undefined>;
  log?: (msg: string) => void;
}

export async function defaultResolveHost(host: string): Promise<string | undefined> {
  try {
    return (await lookup(host)).address;
  } catch {
    return undefined;
  }
}

export async function analyze(ctx: AnalyzeContext, opts: AnalyzeOptions): Promise<Report> {
  const warnings: string[] = [];
  const warn = (msg: string) => warnings.push(msg);
  const log = ctx.log ?? (() => {});

  log(`Fetching RIS looking glass for ${opts.prefix}`);
  const vantages = await lookingGlass(ctx.http, opts.prefix);
  if (vantages.length === 0) warn(`No RIS peer currently has a route for ${opts.prefix}.`);

  // --- The focus network's own view -----------------------------------------
  const focusAsn = opts.focusAsn;
  let focusPaths: Vantage[] = [];
  if (focusAsn) {
    focusPaths = vantages.filter((v) => v.peerAsn === focusAsn);
    if (focusPaths.length === 0) {
      // Not a RIS peer itself: fall back to peers that route through it.
      focusPaths = vantages.filter((v) => v.path.includes(focusAsn));
      if (focusPaths.length > 0) {
        warn(`AS${focusAsn} doesn't feed RIS directly; showing ${focusPaths.length} path(s) from networks behind it.`);
      } else {
        warn(`No RIS path for ${opts.prefix} passes through AS${focusAsn}.`);
      }
    }
  }
  const focusPath = focusPaths[0] ? trimToFocus(focusPaths[0].path, focusAsn) : [];

  const sourceLocation =
    parseCityCountry(opts.sourceLocation, "user") ?? focusPaths.find((v) => v.peerLocation?.continent)?.peerLocation;
  const focusRegion = sourceLocation?.continent;

  // --- Who hands traffic to the origin, by region ----------------------------
  const suffix = originSuffix(vantages);
  const regionalUpstreams: Partial<Record<Continent, UpstreamShare[]>> = {};
  const tallies = new Map<Continent, Map<number, number>>();
  for (const v of vantages) {
    const region = v.peerLocation?.continent;
    const handoff = handoffAs(v.path, suffix);
    if (!region || handoff === undefined) continue;
    const tally = tallies.get(region) ?? new Map<number, number>();
    tally.set(handoff, (tally.get(handoff) ?? 0) + 1);
    tallies.set(region, tally);
  }
  for (const [region, tally] of tallies) {
    regionalUpstreams[region] = [...tally.entries()]
      .map(([asn, count]) => ({ asn, count }))
      .sort((a, b) => b.count - a.count);
  }

  // --- The trace ---------------------------------------------------------------
  let hops: MtrHop[] | undefined;
  let jumps: LatencyJump[] = [];
  if (opts.mtrText?.trim()) {
    hops = computeFloors(parseMtr(opts.mtrText));
    if (hops.length === 0) warn("Couldn't parse any hops from the MTR text.");
    jumps = findJumps(hops, opts.jumpThresholdMs ?? 40);
    if (!opts.skipHopLookup) await labelHops(ctx, hops, warn);
  }

  // --- Names ---------------------------------------------------------------------
  const allAsns = new Set<number>(vantages.flatMap((v) => v.path));
  for (const hop of hops ?? []) if (hop.asn) allAsns.add(hop.asn);
  const names = await resolveNames(ctx.http, allAsns, {
    mustResolve: [...focusPath, ...suffix, ...(hops ?? []).flatMap((h) => (h.asn ? [h.asn] : []))],
    warn,
  });
  for (const hop of hops ?? []) if (hop.asn) hop.asName = names[hop.asn];
  for (const list of Object.values(regionalUpstreams)) for (const u of list ?? []) u.name = names[u.asn];

  // --- Where does it go wrong? ---------------------------------------------------
  const suspectEdge = opts.suspectEdge ?? guessSuspectEdge(focusPath, suffix, hops, jumps);
  let interconnect;
  if (suspectEdge && !opts.skipPeeringDb) {
    log(`Checking PeeringDB for AS${suspectEdge[0]} <-> AS${suspectEdge[1]}`);
    interconnect = await commonInterconnects(ctx.http, suspectEdge[0], suspectEdge[1]);
    if (interconnect.error) warn(`PeeringDB lookup failed: ${interconnect.error}`);
  }

  // Deliberately not inferred from the trace: on a tromboned path the last located hop
  // can be on the wrong continent, which would make the detour look like home.
  const destLocation = parseCityCountry(opts.destLocation, "user");

  const graph = buildGraph(vantages, focusPath);
  for (const node of graph.nodes) node.name = names[node.asn];

  const verdict = decide({
    focusAsn,
    focusPath,
    focusPaths,
    focusRegion,
    sourceLocation,
    destLocation,
    regionalUpstreams,
    suffix,
    hops,
    jumps,
    names,
  });

  return {
    generatedAt: new Date().toISOString(),
    prefix: opts.prefix,
    origin: graph.origin || undefined,
    originName: names[graph.origin],
    focusAsn,
    focusRegion,
    sourceLocation,
    destLocation,
    focusPaths,
    vantages,
    originNetwork: suffix,
    focusHandoff: handoffAs(focusPath, suffix),
    regionalUpstreams,
    graph,
    names,
    mtr: hops ? { hops, jumps } : undefined,
    suspectEdge,
    interconnect,
    verdict,
    warnings,
  };
}

/** If the focus AS sits mid-path (we're seeing a customer's view), drop the ASNs before it. */
function trimToFocus(path: number[], focusAsn?: number): number[] {
  if (!focusAsn) return path;
  const i = path.indexOf(focusAsn);
  return i > 0 ? path.slice(i) : path;
}

async function labelHops(ctx: AnalyzeContext, hops: MtrHop[], warn: (m: string) => void): Promise<void> {
  const resolve = ctx.resolveHost ?? defaultResolveHost;
  let failures = 0;
  await Promise.all(
    hops.map(async (hop) => {
      if (hop.host === "???" || hop.asn !== undefined) return; // mtr -z already told us
      if (!hop.ip) hop.ip = await resolve(hop.host);
      if (!hop.ip || isPrivate(hop.ip)) return;
      try {
        hop.asn = (await networkInfo(ctx.http, hop.ip)).asn;
      } catch {
        failures++;
      }
    }),
  );
  if (failures > 0) warn(`Couldn't look up the origin AS for ${failures} hop(s).`);
}

function isPrivate(ip: string): boolean {
  return /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|169\.254\.|fe80:|fc|fd)/i.test(ip);
}

function guessSuspectEdge(
  focusPath: number[],
  suffix: number[],
  hops: MtrHop[] | undefined,
  jumps: LatencyJump[],
): [number, number] | undefined {
  // Best evidence: the AS where the biggest latency jump lands, and whoever it hands off to next.
  for (const jump of [...jumps].sort((a, b) => b.deltaMs - a.deltaMs)) {
    const asn = hops?.find((h) => h.hop === jump.toHop)?.asn;
    const i = asn === undefined ? -1 : focusPath.indexOf(asn);
    if (i >= 0 && i < focusPath.length - 1) return [focusPath[i], focusPath[i + 1]];
  }
  // Otherwise: the hand-off into the origin's network.
  const handoff = handoffAs(focusPath, suffix);
  if (handoff !== undefined) return [handoff, suffix[0]];
  return undefined;
}

/** A rise this large with no explanation looks like an ocean crossing. */
export const OCEAN_SCALE_MS = 75;

interface DecideInput {
  focusAsn?: number;
  focusPath: number[];
  focusPaths: Vantage[];
  focusRegion?: Continent;
  sourceLocation?: Location;
  destLocation?: Location;
  regionalUpstreams: Partial<Record<Continent, UpstreamShare[]>>;
  suffix: number[];
  hops?: MtrHop[];
  jumps: LatencyJump[];
  names: Record<number, string>;
}

export function decide(input: DecideInput): Verdict {
  const reasons: string[] = [];
  let strong = false;
  let weak = false;
  const label = (asn: number) => (input.names[asn] ? `AS${asn} (${input.names[asn]})` : `AS${asn}`);
  const home = input.sourceLocation?.continent;
  const dest = input.destLocation?.continent;

  // 1. The trace leaves both the source's and the destination's continent.
  // Each jump owns the hops from where it lands up to where the next jump lands,
  // so a domestic jump isn't blamed on a later ocean crossing.
  const landings = input.jumps.map((j) => j.toHop);
  for (const [index, jump] of input.jumps.entries()) {
    const segmentEnd = landings[index + 1] ?? Number.POSITIVE_INFINITY;
    const segment =
      input.hops?.filter((h) => h.hop >= jump.toHop && h.hop < segmentEnd && h.location?.continent) ?? [];
    const away = segment.find((h) => h.location!.continent !== home && h.location!.continent !== dest);
    const where = away?.location;
    const staysHome = !where && segment.length > 0;
    if (staysHome) {
      reasons.push(
        `Latency rises ${jump.deltaMs} ms between hops ${jump.afterHop} and ${jump.toHop}, but the path stays in ` +
          `${CONTINENT_NAMES[segment[0].location!.continent!]} (${segment[0].location!.label}): distance, not a detour.`,
      );
    } else if (where && home && dest) {
      strong = true;
      reasons.push(
        `Latency rises ${jump.deltaMs} ms between hops ${jump.afterHop} and ${jump.toHop}, and hop ${away!.hop} is in ` +
          `${where.label} (${CONTINENT_NAMES[where.continent!]}), while both ends are in ` +
          `${home === dest ? CONTINENT_NAMES[home] : `${CONTINENT_NAMES[home]} and ${CONTINENT_NAMES[dest]}`}. ` +
          `Evidence: ${where.evidence}.`,
      );
    } else if (where && home) {
      weak = true;
      reasons.push(
        `Latency rises ${jump.deltaMs} ms at hop ${jump.toHop} and the path reaches ${where.label}, ` +
          `outside ${CONTINENT_NAMES[home]}. Give a destination location to confirm whether that's a detour.`,
      );
    } else {
      // No geography for this stretch. Only an ocean-sized rise is worth worrying about;
      // crossing a continent by land can cost 50-70 ms on its own.
      if (jump.deltaMs >= OCEAN_SCALE_MS) weak = true;
      reasons.push(
        `Latency rises ${jump.deltaMs} ms between hops ${jump.afterHop} and ${jump.toHop} and stays up ` +
          `(enough for up to ~${jump.maxExtraKm.toLocaleString("en-CA")} km of extra fibre). ` +
          `No hostname here says where that is.`,
      );
    }
  }

  // 2. Communities on the focus path that say the route was learnt somewhere else.
  for (const v of input.focusPaths.slice(0, 3)) {
    for (const c of v.communities) {
      const c1 = c.location?.continent;
      if (c1 && c1 !== home && c1 !== dest) {
        weak = true;
        reasons.push(`Community ${c.value} on the ${v.collector} path says "${c.description}".`);
      }
    }
  }

  // 3. The focus network's hand-off is unusual for its region.
  const handoff = handoffAs(input.focusPath, input.suffix);
  const regional = input.focusRegion ? input.regionalUpstreams[input.focusRegion] : undefined;
  if (handoff !== undefined && regional && regional.length > 0) {
    const total = regional.reduce((n, u) => n + u.count, 0);
    const mine = regional.find((u) => u.asn === handoff)?.count ?? 0;
    const share = mine / total;
    if (total >= 5 && share < 0.2) {
      weak = true;
      const usual = regional
        .filter((u) => u.asn !== handoff)
        .slice(0, 4)
        .map((u) => label(u.asn))
        .join(", ");
      reasons.push(
        `Only ${mine} of ${total} ${CONTINENT_NAMES[input.focusRegion!]} vantage points reach the origin's network via ` +
          `${label(handoff)}, as ${input.focusAsn ? label(input.focusAsn) : "this network"} does. Most use ${usual}.`,
      );
    }
  }

  if (strong) {
    return { level: "trombone", summary: "This path detours through another continent and back.", reasons };
  }
  if (weak) {
    return { level: "suspect", summary: "Something about this path looks off. See the reasons below.", reasons };
  }
  if (input.hops && input.hops.length > 0) {
    return { level: "clean", summary: "No persistent latency jump and nothing unusual in the BGP view.", reasons };
  }
  return {
    level: "unknown",
    summary: "The BGP view looks ordinary, but AS paths carry no geography. Add an MTR to check latency.",
    reasons,
  };
}
