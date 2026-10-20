import { test } from "node:test";
import assert from "node:assert/strict";
import { analyze } from "../src/analyze.ts";
import { originSuffix } from "../src/analysis/graph.ts";
import { fixture, fixtureContext } from "./helpers.ts";

const PREFIX = "5.188.125.0/24";

test("the TELUS case is a trombone when both ends are known", async () => {
  const ctx = await fixtureContext();
  const r = await analyze(ctx, {
    prefix: PREFIX,
    focusAsn: 852,
    mtrText: await fixture("mtr-report.txt"),
    destLocation: "Manassas, US",
  });
  assert.equal(r.verdict.level, "trombone");
  assert.equal(r.origin, 202422);
  assert.deepEqual(r.originNetwork, [199524, 202422]);
  assert.equal(r.focusHandoff, 3320);
  // The biggest jump lands in DTAG, which hands to G-Core: that's the edge to fix.
  assert.deepEqual(r.suspectEdge, [3320, 199524]);
  assert.ok(r.interconnect?.commonFacilities.some((f) => f.city === "Ashburn"));
  assert.equal(r.mtr?.hops.find((h) => h.hop === 14)?.asn, 3320);
  assert.equal(r.names[852], "TELUS Communications Inc.");
  assert.deepEqual(r.warnings, []);
});

test("without a destination it's only suspect, and the trace is never used as the destination", async () => {
  const ctx = await fixtureContext();
  const r = await analyze(ctx, { prefix: PREFIX, focusAsn: 852, mtrText: await fixture("mtr-abridged.txt") });
  assert.equal(r.verdict.level, "suspect");
  assert.equal(r.destLocation, undefined);
  assert.ok(r.verdict.reasons.some((x) => x.includes("Give a destination")));
});

test("BGP alone flags an unusual regional hand-off", async () => {
  const ctx = await fixtureContext();
  const r = await analyze(ctx, { prefix: PREFIX, focusAsn: 852, skipPeeringDb: true });
  assert.equal(r.verdict.level, "suspect");
  assert.ok(r.verdict.reasons.some((x) => x.startsWith("Only 1 of 9 North America")));
  assert.deepEqual(r.suspectEdge, [3320, 199524]);
});

test("a network that follows the regional norm is not flagged", async () => {
  const ctx = await fixtureContext();
  const r = await analyze(ctx, { prefix: PREFIX, focusAsn: 6939, skipPeeringDb: true });
  assert.equal(r.verdict.level, "unknown");
  assert.equal(r.focusHandoff, 1299);
});

test("a short domestic trace is clean", async () => {
  const ctx = await fixtureContext();
  const r = await analyze(ctx, {
    prefix: PREFIX,
    focusAsn: 6939,
    mtrText: " 1. a.yvr.example.net 1.0 ms\n 2. b.sea.example.net 4.0 ms\n 3. c.iad.example.net 62.0 ms\n",
    destLocation: "Manassas, US",
    skipPeeringDb: true,
    skipHopLookup: true,
  });
  assert.equal(r.verdict.level, "clean");
  assert.ok(r.verdict.reasons[0].includes("distance, not a detour"));
});

test("an AS that isn't a RIS peer falls back to paths through it", async () => {
  const ctx = await fixtureContext();
  const r = await analyze(ctx, { prefix: PREFIX, focusAsn: 174, skipPeeringDb: true });
  assert.ok(r.focusPaths.length >= 1);
  assert.match(r.warnings[0], /doesn't feed RIS directly/);
});

test("origin suffix spans a multi-ASN origin network", () => {
  const v = (path: number[]) => ({ path }) as never;
  assert.deepEqual(originSuffix([v([1, 9, 8]), v([2, 9, 8]), v([3, 4, 9, 8]), v([9, 8])]), [9, 8]);
});
