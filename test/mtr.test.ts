import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFloors, findJumps, parseMtr } from "../src/analysis/mtr.ts";
import { fixture } from "./helpers.ts";

test("parses an mtr -r report, using best RTT and skipping silent hops", async () => {
  const hops = parseMtr(await fixture("mtr-report.txt"));
  assert.deepEqual(hops.map((h) => h.hop), [1, 2, 3, 12, 13, 14, 15, 18, 19]);
  const h14 = hops.find((h) => h.hop === 14)!;
  assert.equal(h14.host, "f-eh3-i.F.DE.NET.DTAG.DE");
  assert.equal(h14.best, 149.1);
  assert.equal(h14.avg, 150.2);
  assert.equal(h14.rtt, 149.1);
  assert.equal(h14.location?.label, "Frankfurt, DE");
  const silent = hops.find((h) => h.hop === 3)!;
  assert.equal(silent.rtt, undefined);
  assert.equal(hops.find((h) => h.hop === 13)!.ip, "80.150.170.94");
});

test("parses an abridged paste with 'N ms' columns", async () => {
  const hops = parseMtr(await fixture("mtr-abridged.txt"));
  assert.deepEqual(hops.map((h) => [h.hop, h.rtt]), [[2, 1], [12, 56.6], [13, 55.8], [14, 149.5], [18, 152.7]]);
  assert.equal(hops[0].location?.label, "British Columbia, CA");
});

test("parses mtr --json", () => {
  const json = JSON.stringify({
    report: {
      hubs: [
        { count: 1, host: "10.0.0.1", "Loss%": 0, Snt: 10, Avg: 0.5, Best: 0.4, Wrst: 0.9 },
        { count: 2, host: "ae-1.r20.frnkge13.de.bb.gin.ntt.net (129.250.2.1)", "Loss%": 0, Snt: 10, Avg: 101, Best: 100, Wrst: 110 },
      ],
    },
  });
  const hops = parseMtr(json);
  assert.equal(hops[1].host, "ae-1.r20.frnkge13.de.bb.gin.ntt.net");
  assert.equal(hops[1].ip, "129.250.2.1");
  assert.equal(hops[1].rtt, 100);
});

test("mtr -b style 'name (ip)' hosts in a report", () => {
  const hops = parseMtr("  4.|-- be3.yvr.example.net (203.0.113.9)   0.0%    10    9.9  10.1   9.8  11.0   0.3");
  assert.equal(hops[0].host, "be3.yvr.example.net");
  assert.equal(hops[0].ip, "203.0.113.9");
  assert.equal(hops[0].location?.label, "Vancouver, CA");
});

test("mtr -z AS columns are read, not mistaken for the hostname", () => {
  const hops = parseMtr(
    [
      "  2.|-- AS852    s99-199-69-65.bc.hsia.telus.net (99.199.69.65)   0.0%   200    1.0   1.2   0.9   4.0   0.3",
      "  3.|-- AS???    ???                                             100.0   200    0.0   0.0   0.0   0.0   0.0",
    ].join("\n"),
  );
  assert.equal(hops[0].asn, 852);
  assert.equal(hops[0].host, "s99-199-69-65.bc.hsia.telus.net");
  assert.equal(hops[0].ip, "99.199.69.65");
  assert.equal(hops[1].asn, undefined);
  assert.equal(hops[1].host, "???");
});

test("floors ignore a single slow router and jumps only count persistent rises", () => {
  const hops = computeFloors(
    parseMtr(`
 1. a 1.0 ms
 2. b 90.0 ms
 3. c 2.0 ms
 4. d 100.0 ms
 5. e 101.0 ms`),
  );
  assert.deepEqual(hops.map((h) => h.floor), [1, 2, 2, 100, 101]);
  const jumps = findJumps(hops, 40);
  assert.equal(jumps.length, 1);
  assert.deepEqual([jumps[0].afterHop, jumps[0].toHop, jumps[0].deltaMs], [3, 4, 98]);
  assert.equal(jumps[0].maxExtraKm, 9800);
});

test("silent hops get no floor", async () => {
  const hops = computeFloors(parseMtr(await fixture("mtr-report.txt")));
  assert.equal(hops.find((h) => h.hop === 3)!.floor, undefined);
});
