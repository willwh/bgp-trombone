import { test } from "node:test";
import assert from "node:assert/strict";
import { collapsePrepends, lookingGlass, parseAsPath } from "../src/sources/ripestat.ts";
import { parseAsnCsv, splitCsvLine } from "../src/sources/asnames.ts";
import { commonInterconnects } from "../src/sources/peeringdb.ts";
import { fixtureContext } from "./helpers.ts";

test("AS paths: prepends collapse and AS-sets flatten", () => {
  assert.deepEqual(parseAsPath("852 3320 199524 199524 202422"), [852, 3320, 199524, 199524, 202422]);
  assert.deepEqual(collapsePrepends([852, 3320, 199524, 199524, 202422]), [852, 3320, 199524, 202422]);
  assert.deepEqual(parseAsPath("1 2 {3,4}"), [1, 2, 3, 4]);
});

test("looking glass parses peers, locations and described communities", async () => {
  const { http } = await fixtureContext();
  const vantages = await lookingGlass(http, "5.188.125.0/24");
  assert.equal(vantages.length, 15);
  const telus = vantages.find((v) => v.peerAsn === 852)!;
  assert.deepEqual(telus.path, [852, 3320, 199524, 202422]);
  assert.equal(telus.origin, 202422);
  assert.equal(telus.peerLocation?.continent, "NA");
  const dtag = vantages.find((v) => v.peerAsn === 3320)!;
  const learned = dtag.communities.find((c) => c.value === "3320:1276")!;
  assert.equal(learned.location?.label, "Frankfurt, DE");
});

test("CSV parsing handles quoted commas", () => {
  assert.deepEqual(splitCsvLine('AS2914,"NTT America, Inc.",Unknown,US'), ["AS2914", "NTT America, Inc.", "Unknown", "US"]);
  const names = parseAsnCsv('asn,name\nAS1,"One, Inc."\nAS2,Two\n');
  assert.equal(names.get(1), "One, Inc.");
  assert.equal(names.get(2), "Two");
});

test("PeeringDB intersection", async () => {
  const { http } = await fixtureContext();
  const ic = await commonInterconnects(http, 3320, 199524);
  assert.equal(ic.error, undefined);
  assert.deepEqual(ic.commonFacilities.map((f) => f.id).sort(), [1, 2]);
  assert.equal(ic.commonFacilities.find((f) => f.id === 2)?.continent, "NA");
  assert.deepEqual(ic.commonExchanges.map((x) => x.name), ["DE-CIX Frankfurt"]);
});

test("PeeringDB failures are reported, not thrown", async () => {
  const { http } = await fixtureContext();
  const ic = await commonInterconnects(http, 64500, 64501);
  assert.match(ic.error ?? "", /no fixture/);
});
