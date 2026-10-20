// Tiny local web server: static files from web/, plus POST /api/analyze.

import { createServer, type IncomingMessage, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { analyze, type AnalyzeContext } from "./analyze.ts";
import type { AnalyzeOptions } from "./types.ts";

const WEB_ROOT = fileURLToPath(new URL("../web/", import.meta.url));
const MAX_BODY = 1_000_000;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

export function createApp(ctx: AnalyzeContext): Server {
  return createServer(async (req, res) => {
    const send = (status: number, body: string, type = "application/json") => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
    };
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (req.method === "POST" && url.pathname === "/api/analyze") {
        const opts = validate(JSON.parse(await readBody(req)));
        const report = await analyze(ctx, opts);
        return send(200, JSON.stringify(report));
      }
      if (req.method === "GET") {
        const rel = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
        const file = normalize(join(WEB_ROOT, rel));
        if (!file.startsWith(WEB_ROOT.endsWith(sep) ? WEB_ROOT : WEB_ROOT + sep)) return send(403, "forbidden", "text/plain");
        try {
          return send(200, await readFile(file, "utf8"), TYPES[extname(file)] ?? "text/plain");
        } catch {
          return send(404, "not found", "text/plain");
        }
      }
      send(405, "method not allowed", "text/plain");
    } catch (err) {
      send(400, JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
    }
  });
}

export function startServer(ctx: AnalyzeContext, opts: { port: number; host: string }): Promise<Server> {
  const server = createApp(ctx);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port, opts.host, () => resolve(server));
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("request too large"));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function validate(body: Record<string, unknown>): AnalyzeOptions {
  const prefix = String(body.prefix ?? "").trim();
  if (!/^[0-9a-f.:]+(\/\d{1,3})?$/i.test(prefix)) throw new Error("prefix must be an IP or CIDR prefix");
  const asn = (v: unknown) => {
    if (v === undefined || v === null || v === "") return undefined;
    const n = Number(String(v).replace(/^AS/i, ""));
    if (!Number.isInteger(n) || n <= 0) throw new Error(`not an ASN: ${v}`);
    return n;
  };
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const edge = Array.isArray(body.suspectEdge) && body.suspectEdge.length === 2 ? body.suspectEdge.map(asn) : undefined;
  return {
    prefix,
    focusAsn: asn(body.focusAsn),
    mtrText: text(body.mtrText),
    sourceLocation: text(body.sourceLocation),
    destLocation: text(body.destLocation),
    suspectEdge: edge && edge[0] && edge[1] ? [edge[0], edge[1]] : undefined,
    jumpThresholdMs: body.jumpThresholdMs ? Number(body.jumpThresholdMs) : undefined,
    skipPeeringDb: body.skipPeeringDb === true,
  };
}
