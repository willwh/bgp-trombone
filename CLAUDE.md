# bgp-trombone: notes for Claude Code

Local tool that decides whether a BGP route "trombones" (crosses an ocean and back)
by joining RIPE RIS paths, an MTR trace and PeeringDB. See README.md for the user view.

## Conventions

- **Canadian English** in code, comments, UI text and docs (colour, centre, neighbour, behaviour; -ize verbs: analyze, normalize).
- **No runtime dependencies.** Node built-ins only. `typescript` and `@types/node` are dev-only for `npm run typecheck`.
- **TypeScript run natively** by Node ≥ 22.18 (type stripping). So: erasable syntax only
  (no enums, namespaces or parameter properties), relative imports end in `.ts`,
  and type-only imports use `import type`.
- The browser code in `web/` is plain ES modules with no build step. Keep it that way.
- Git commits: no Claude attribution or Co-Authored-By lines.

## Layout

```
src/
  cli.ts              entry: analyze | serve
  server.ts           node:http server: static web/ + POST /api/analyze
  analyze.ts          orchestration + decide(): the verdict logic
  context.ts          live vs fixture AnalyzeContext
  http.ts             cached fetch (.cache/), fixtureHttp for offline, limiter
  geo.ts              country→continent, hostname rules, site codes, community text → Location
  format.ts           terminal rendering
  types.ts            shared types (Report is the API contract with web/)
  analysis/mtr.ts     MTR parsing (json, -r report, loose), floors, jumps
  analysis/graph.ts   layered AS graph, origin-network suffix, hand-off AS
  sources/ripestat.ts looking-glass, network-info, as-overview
  sources/asnames.ts  bgp.tools asns.csv with RIPEstat fallback
  sources/peeringdb.ts shared facilities/exchanges between two ASNs
web/                  index.html, style.css, app.js (SVG graph + trace chart)
test/                 node:test suites; fixtures/ is synthetic, routed by fixtures/routes.json
```

## Commands

```sh
npm test            # node --test, fully offline via fixtures
npm run typecheck
npm run demo        # viewer on :4180 with fixtures
node src/cli.ts analyze 5.188.125.0/24 --from 852 --mtr test/fixtures/mtr-report.txt --dest "Manassas, US" --fixtures test/fixtures
```

Adding a fixture: drop the file in `test/fixtures/` and add a `{ "match": "<url substring>", "file": "<name>" }`
rule to `routes.json`. The first matching rule wins, and unmatched URLs fail on purpose.

## Not yet verified against live APIs

The workspace this was written in couldn't reach these hosts, so the field names come from docs and memory:

- PeeringDB: `netfac?local_asn=` (fields `fac_id, name, city, country`), `netixlan?asn=` (`ix_id, name`), `ix?id__in=`.
- bgp.tools `asns.csv`: assumed header `asn,name,class,cc` with `AS`-prefixed ASNs (the parser tolerates either).
- RIPEstat `network-info` (`data.asns`, `data.prefix`) and `as-overview` (`data.holder`).

The looking-glass shape *was* checked live: TELUS (AS852) peers with RRC00 multihop from Edmonton,
its path is `852 3320 199524 199524 202422`, and it sends no communities.

## Ideas

- History: RIPEstat `bgplay` / `routing-history` to show when the bad path appeared and flapped.
- Live: RIS Live websocket, alerting when the focus path changes.
- Run the trace too: wrap `mtr --json` so the viewer has a "trace now" button.
- RIPE Atlas: traceroutes from other probes in the same region, to show what "normal" looks like.
- More carrier hostname rules (Arelion, Cogent, NTT, Zayo, Hurricane Electric, Bell, Rogers, Shaw).
- Community dictionaries for carriers whose RIPEstat descriptions are thin.
- A map view (MapLibre, vendored) drawing located hops.
- IPv6 prefixes and dual-stack comparison.
