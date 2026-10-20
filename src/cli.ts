#!/usr/bin/env node
// bgp-trombone command line.

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { analyze } from "./analyze.ts";
import { makeContext } from "./context.ts";
import { formatReport } from "./format.ts";
import { startServer } from "./server.ts";

const HELP = `bgp-trombone: find BGP paths that cross an ocean and come back.

Usage:
  bgp-trombone analyze <prefix> [options]
  bgp-trombone serve [--port 4180] [--host 127.0.0.1]

Analyze options:
  --from <asn>        The network you're looking from (e.g. 852 for TELUS)
  --mtr <file|->      MTR output: --json, -r/-rw report, or a pasted abridged trace
  --src "City, CC"    Where the source is (default: the RIS peer location, if any)
  --dest "City, CC"   Where the destination is (needed to confirm a detour)
  --edge <a,b>        The AS hand-off to check in PeeringDB (default: guessed)
  --threshold <ms>    Smallest persistent RTT rise to call a jump (default 40)
  --no-peeringdb      Skip the PeeringDB lookup
  --json              Print the full report as JSON

Common options:
  --fixtures <dir>    Use offline fixtures instead of the network (see test/fixtures)
  -v, --verbose       Log each request
`;

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      from: { type: "string" },
      mtr: { type: "string" },
      src: { type: "string" },
      dest: { type: "string" },
      edge: { type: "string" },
      threshold: { type: "string" },
      "no-peeringdb": { type: "boolean" },
      json: { type: "boolean" },
      port: { type: "string" },
      host: { type: "string" },
      fixtures: { type: "string" },
      verbose: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, prefix] = positionals;
  if (values.help || !command) {
    console.log(HELP);
    return command ? 0 : 1;
  }

  const ctx = await makeContext({ fixtures: values.fixtures, verbose: values.verbose });

  if (command === "serve") {
    const port = Number(values.port ?? 4180);
    const host = values.host ?? "127.0.0.1";
    await startServer(ctx, { port, host });
    console.log(`bgp-trombone listening on http://${host}:${port}${values.fixtures ? " (fixtures)" : ""}`);
    return -1; // keep running
  }

  if (command === "analyze") {
    if (!prefix) {
      console.error("analyze needs a prefix or IP, e.g. 5.188.125.0/24");
      return 1;
    }
    const mtrText = values.mtr === "-" ? await readStdin() : values.mtr ? await readFile(values.mtr, "utf8") : undefined;
    const report = await analyze(ctx, {
      prefix,
      focusAsn: values.from ? parseAsn(values.from) : undefined,
      mtrText,
      sourceLocation: values.src,
      destLocation: values.dest,
      suspectEdge: values.edge ? parseEdge(values.edge) : undefined,
      jumpThresholdMs: values.threshold ? Number(values.threshold) : undefined,
      skipPeeringDb: values["no-peeringdb"],
    });
    console.log(values.json ? JSON.stringify(report, null, 2) : formatReport(report));
    return report.verdict.level === "trombone" ? 2 : 0;
  }

  console.error(`Unknown command "${command}".\n\n${HELP}`);
  return 1;
}

function parseAsn(text: string): number {
  const asn = Number(text.replace(/^AS/i, ""));
  if (!Number.isInteger(asn) || asn <= 0) throw new Error(`Not an ASN: ${text}`);
  return asn;
}

function parseEdge(text: string): [number, number] {
  const parts = text.split(/[,>\s]+/).filter(Boolean).map(parseAsn);
  if (parts.length !== 2) throw new Error(`--edge wants two ASNs, e.g. 3320,199524`);
  return [parts[0], parts[1]];
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

main(process.argv.slice(2)).then(
  (code) => {
    if (code >= 0) process.exitCode = code;
  },
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  },
);
