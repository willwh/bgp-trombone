import { test } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "../src/server.ts";
import { fixtureContext } from "./helpers.ts";

test("serves the viewer and the analyze API", async (t) => {
  const server = createApp(await fixtureContext());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /<title>BGP Trombone<\/title>/);

  const res = await fetch(`${base}/api/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prefix: "5.188.125.0/24", focusAsn: "AS852", skipPeeringDb: true }),
  });
  assert.equal(res.status, 200);
  const report = await res.json();
  assert.equal(report.focusAsn, 852);
  assert.equal(report.vantages.length, 15);

  const bad = await fetch(`${base}/api/analyze`, { method: "POST", body: JSON.stringify({ prefix: "nope" }) });
  assert.equal(bad.status, 400);

  const outside = await fetch(`${base}/%2e%2e%2fsrc%2fcli.ts`);
  assert.notEqual(outside.status, 200);
});
