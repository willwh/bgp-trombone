import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { makeContext } from "../src/context.ts";

export const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));

export function fixture(name: string): Promise<string> {
  return readFile(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

export function fixtureContext() {
  return makeContext({ fixtures: FIXTURES });
}
