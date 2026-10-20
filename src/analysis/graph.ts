// Build a layered AS graph from many vantage paths, with the origin at depth 0.

import type { AsGraph, GraphEdge, GraphNode, Vantage } from "../types.ts";

export function buildGraph(vantages: Vantage[], focusPath: number[] = []): AsGraph {
  const nodes = new Map<number, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const focusAsns = new Set(focusPath);
  const focusEdges = new Set(focusPath.slice(1).map((asn, i) => `${focusPath[i]}>${asn}`));
  const originCounts = new Map<number, number>();

  for (const v of vantages) {
    const path = v.path;
    originCounts.set(v.origin, (originCounts.get(v.origin) ?? 0) + 1);
    path.forEach((asn, i) => {
      const depth = path.length - 1 - i;
      const node = nodes.get(asn);
      if (node) {
        node.depth = Math.min(node.depth, depth);
        node.vantageCount++;
      } else {
        nodes.set(asn, { asn, depth, vantageCount: 1, onFocusPath: focusAsns.has(asn) });
      }
      if (i < path.length - 1) {
        const key = `${asn}>${path[i + 1]}`;
        const edge = edges.get(key);
        if (edge) edge.vantageCount++;
        else edges.set(key, { from: asn, to: path[i + 1], vantageCount: 1, onFocusPath: focusEdges.has(key) });
      }
    });
  }

  const origin = [...originCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  return {
    origin,
    nodes: [...nodes.values()].sort((a, b) => a.depth - b.depth || b.vantageCount - a.vantageCount),
    edges: [...edges.values()],
  };
}

/**
 * The longest run of trailing ASNs shared by most paths: the origin's own network,
 * which can span several ASNs (G-Core uses 199524 and 202422, for instance).
 */
export function originSuffix(vantages: Vantage[], share = 0.8): number[] {
  if (vantages.length === 0) return [];
  const suffix: number[] = [];
  for (let k = 1; ; k++) {
    const counts = new Map<number, number>();
    for (const v of vantages) {
      const asn = v.path[v.path.length - k];
      if (asn !== undefined) counts.set(asn, (counts.get(asn) ?? 0) + 1);
    }
    const [asn, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (asn === undefined || count / vantages.length < share) break;
    suffix.unshift(asn);
  }
  // Always include the origin, even if the share test failed at k = 1.
  return suffix.length > 0 ? suffix : [vantages[0].origin];
}

/** The AS that hands traffic to the origin's network on this path. */
export function handoffAs(path: number[], suffix: number[]): number | undefined {
  const start = path.indexOf(suffix[0]);
  if (start <= 0) return undefined;
  return path[start - 1];
}
