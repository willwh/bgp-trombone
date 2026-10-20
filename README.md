# bgp-trombone

Find and visualize BGP "trombones": routes that cross an ocean and come back,
like TELUS → Deutsche Telekom (Toronto) → Frankfurt → G-Core → Virginia.

An AS path tells you *who* passed a route along, never *where*. This tool joins
three views that each miss part of the picture:

| View | Source | Tells you |
| --- | --- | --- |
| Control plane | RIPE RIS looking glass (via RIPEstat) | Every RIS peer's best AS path, its location, and any communities |
| Data plane | Your MTR | Where latency rises *and stays up*, and router hostnames that leak locations |
| Interconnects | PeeringDB | Where the two networks at the bad hand-off are both present, so could meet locally |

It runs entirely on your machine: a CLI, plus a small local web viewer with an
AS graph, a trace chart and the PeeringDB overlap.

## Requirements

Node.js **22.18 or newer** (it runs the TypeScript directly, no build step).
There are no runtime dependencies. `npm install` only pulls TypeScript for `npm run typecheck`.

## Quick start

```sh
# Offline demo with synthetic fixtures modelled on the TELUS case
npm run demo                 # http://127.0.0.1:4180

# Live
npm run serve
node src/cli.ts analyze 5.188.125.0/24 --from 852 --mtr trace.txt --dest "Manassas, US"
```

Getting a trace worth analyzing:

```sh
mtr -rwbz -c 200 live01-win-01.dc02.albion.zone > trace.txt   # report: best RTT, hostnames, IPs
mtr --json -c 200 live01-win-01.dc02.albion.zone > trace.json # also fine
```

An abridged paste with `N ms` per hop works too.

## CLI

```
bgp-trombone analyze <prefix> [--from ASN] [--mtr file|-] [--src "City, CC"] [--dest "City, CC"]
                              [--edge A,B] [--threshold ms] [--no-peeringdb] [--json]
bgp-trombone serve [--port 4180] [--host 127.0.0.1]
Common: --fixtures <dir>, -v/--verbose
```

The CLI exits with code 2 when the verdict is `trombone`, so it can drive a cron
check or a script. `npm run analyze` will report that as a failure; call
`node src/cli.ts` directly if that bothers you.

## How the verdict works

1. **Persistent latency jumps.** For each hop the *floor* is the lowest RTT at that
   hop or any later one. Routers that are slow to answer ICMP spike on their own; a
   rise in the floor is real path latency. A rise of ≥ 40 ms (configurable) is a jump.
   One RTT millisecond buys at most ~100 km of one-way fibre.
2. **Geography.** Each jump owns the hops up to the next jump. If a located hop in that
   stretch is on a continent that is neither the source's nor the destination's, that's
   a **trombone**. Locations come from carrier hostname rules and site codes
   (`src/geo.ts`), never from GeoIP, which is unreliable for router addresses.
3. **Regional norm.** Among RIS peers in the source's region, which AS hands traffic
   into the origin's network? If yours is used by fewer than 20% of them, that's
   **suspect**.
4. **Communities.** If the focus path carries communities whose RIPEstat description
   names a far-off place, that's **suspect** too. TELUS strips communities on its RIS
   session, so this rarely fires for the case that started all this.

The *suspect edge* is the AS where the biggest jump lands plus the next AS on the
path. Failing that, it's the hand-off into the origin's network. That pair is what
gets checked in PeeringDB.

## Data sources and etiquette

- RIPEstat Data API (`looking-glass`, `network-info`, `as-overview`), tagged with `sourceapp=bgp-trombone`.
- bgp.tools `asns.csv` for AS names, fetched at most once a day. Set
  `BGP_TROMBONE_CONTACT` to add your contact to the User-Agent, as bgp.tools asks.
- PeeringDB API. Anonymous access is rate-limited; set `PEERINGDB_API_KEY` for more.

Responses are cached in `.cache/`: 15 minutes for routes, a day to a month for
names and PeeringDB data. Delete the directory to start fresh.

## Caveats

- RIS shows each peer's *best* path only. If your network isn't a RIS peer, you see
  paths from networks behind it, which may differ.
- Hostname location rules are a short, hand-curated list. Extend `HOSTNAME_RULES`
  and `SITE_CODES` in `src/geo.ts` as you meet new carriers.
- The fixtures in `test/fixtures` are synthetic: the shape of the real data, not the data.
