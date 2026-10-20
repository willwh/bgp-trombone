import { test } from "node:test";
import assert from "node:assert/strict";
import { locateDescription, locateHostname, parseCityCountry } from "../src/geo.ts";

test("carrier rules beat generic site codes", () => {
  assert.equal(locateHostname("f-eh3-i.F.DE.NET.DTAG.DE")?.label, "Frankfurt, DE");
  assert.equal(locateHostname("h-xx.H.DE.NET.DTAG.DE")?.label, "Germany");
  assert.equal(locateHostname("s99-199-69-65.bc.hsia.telus.net")?.continent, "NA");
});

test("site codes match whole tokens, with digits stripped", () => {
  assert.equal(locateHostname("ae-2.r01.ams1.example.net")?.label, "Amsterdam, NL");
  assert.equal(locateHostname("xe-0-0-1.core1.yyz2.example.ca")?.label, "Toronto, CA");
  assert.equal(locateHostname("core.lond.example.net"), undefined); // "lond" isn't "lon"
});

test("IPs and silent hops have no location", () => {
  assert.equal(locateHostname("80.150.170.94"), undefined);
  assert.equal(locateHostname("???"), undefined);
});

test("RIS peer locations", () => {
  assert.deepEqual(parseCityCountry("Edmonton, CA", "ris-peer"), {
    label: "Edmonton, CA",
    country: "CA",
    continent: "NA",
    source: "ris-peer",
    evidence: "Edmonton, CA",
  });
});

test("community descriptions", () => {
  assert.equal(locateDescription("Route learned in Frankfurt", "x")?.continent, "EU");
  assert.equal(locateDescription("Received from a peer in Europe", "x")?.continent, "EU");
  assert.equal(locateDescription("Learned in US", "x")?.continent, "NA");
  // Lower-case "us" in prose is not the United States.
  assert.equal(locateDescription("Do not export to us", "x"), undefined);
  assert.equal(locateDescription("NTT and customer routes", "x"), undefined);
});
