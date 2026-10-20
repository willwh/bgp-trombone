// Plain-text rendering of a Report for the terminal.

import type { Continent, Report } from "./types.ts";
import { CONTINENT_NAMES } from "./geo.ts";

const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (useColour ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = paint("1");
const dim = paint("2");
const red = paint("31");
const yellow = paint("33");
const green = paint("32");

const LEVEL_STYLE = { trombone: red, suspect: yellow, clean: green, unknown: dim };

export function formatReport(r: Report): string {
  const out: string[] = [];
  const name = (asn: number) => (r.names[asn] ? `AS${asn} ${dim(r.names[asn])}` : `AS${asn}`);
  const section = (title: string) => out.push("", bold(title));

  out.push(bold(`${r.prefix}`) + (r.origin ? `  originated by ${name(r.origin)}` : ""));
  out.push(`${r.vantages.length} RIS vantage points`);

  section("Verdict");
  out.push(`  ${LEVEL_STYLE[r.verdict.level](r.verdict.level.toUpperCase())}  ${r.verdict.summary}`);
  for (const reason of r.verdict.reasons) out.push(`  - ${reason}`);

  if (r.focusAsn) {
    section(`Path from AS${r.focusAsn}`);
    if (r.focusPaths.length === 0) out.push("  (none visible)");
    for (const v of r.focusPaths.slice(0, 3)) {
      out.push(`  ${v.collector} peer ${v.peerIp}${v.peerLocation ? ` (${v.peerLocation.label})` : ""}`);
      out.push(`    raw:  ${v.rawPath.join(" ")}`);
      out.push(`    hops: ${v.path.map(name).join(" → ")}`);
      if (v.communities.length > 0) out.push(`    communities: ${v.communities.map((c) => c.value).join(" ")}`);
    }
  }

  const regions = Object.keys(r.regionalUpstreams) as Continent[];
  if (regions.length > 0) {
    section("Who hands traffic to the origin's network, by vantage region");
    const ordered = [...regions].sort((a, b) => (a === r.focusRegion ? -1 : b === r.focusRegion ? 1 : 0));
    for (const region of ordered) {
      const list = r.regionalUpstreams[region] ?? [];
      const total = list.reduce((n, u) => n + u.count, 0);
      const parts = list.map((u) => `${name(u.asn)} ${u.count}`);
      out.push(`  ${(CONTINENT_NAMES[region] + ` (${total})`).padEnd(22)} ${parts.join(", ")}`);
    }
  }

  if (r.mtr) {
    section("Trace");
    const jumpAt = new Map(r.mtr.jumps.map((j) => [j.toHop, j]));
    for (const h of r.mtr.hops) {
      const jump = jumpAt.get(h.hop);
      const cols = [
        String(h.hop).padStart(3) + ".",
        h.host.slice(0, 34).padEnd(34),
        (h.asn ? `AS${h.asn}` : "").padEnd(9),
        h.rtt === undefined ? "    -   " : `${h.rtt.toFixed(1).padStart(6)} ms`,
        h.floor === undefined ? "" : dim(`floor ${h.floor.toFixed(1)}`),
        h.location ? h.location.label : "",
      ];
      const line = `  ${cols.join("  ")}`;
      out.push(jump ? `${line}  ${red(`▲ +${jump.deltaMs} ms`)}` : line);
    }
  }

  if (r.suspectEdge) {
    const [a, b] = r.suspectEdge;
    section(`Where ${name(a)} and ${name(b)} could meet (PeeringDB)`);
    const ic = r.interconnect;
    if (!ic) out.push("  (skipped)");
    else if (ic.error) out.push(`  lookup failed: ${ic.error}`);
    else {
      const place = (x: { city?: string; country?: string }) => [x.city, x.country].filter(Boolean).join(", ");
      const byRegion = (list: { name: string; city?: string; country?: string }[]) =>
        list.map((x) => `    ${x.name}${place(x) ? dim(`  ${place(x)}`) : ""}`);
      out.push(`  ${plural(ic.commonFacilities.length, "shared facility", "shared facilities")}`, ...byRegion(ic.commonFacilities));
      out.push(`  ${plural(ic.commonExchanges.length, "shared exchange", "shared exchanges")}`, ...byRegion(ic.commonExchanges));
    }
  }

  if (r.warnings.length > 0) {
    section("Warnings");
    for (const w of r.warnings) out.push(`  ${yellow("!")} ${w}`);
  }
  return out.join("\n");
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
