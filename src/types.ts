// Shared types for bgp-trombone.

export type Continent = "NA" | "SA" | "EU" | "AF" | "AS" | "OC" | "AN";

/** A place we believe something is, and how we came to believe it. */
export interface Location {
  label: string; // e.g. "Frankfurt, DE"
  country?: string; // ISO 3166-1 alpha-2
  continent?: Continent;
  source: "rdns" | "ris-peer" | "community" | "user" | "peeringdb";
  evidence?: string; // the token, hostname or community that gave it away
}

/** One route as seen by one RIS collector peer. */
export interface Vantage {
  collector: string; // e.g. "RRC00"
  collectorLocation?: string;
  peerIp: string;
  peerAsn: number;
  peerLocation?: Location;
  rawPath: number[]; // as received, prepends included
  path: number[]; // prepends collapsed
  origin: number;
  communities: Community[];
  lastUpdated?: string;
}

export interface Community {
  value: string; // "2914:410" or "3320:1:2:3" for large
  kind: "regular" | "large" | "extended";
  description?: string;
  location?: Location; // set when the description names a place
}

export interface GraphNode {
  asn: number;
  name?: string;
  depth: number; // AS hops from the origin (origin = 0)
  vantageCount: number; // how many vantage paths traverse this AS
  onFocusPath: boolean;
}

export interface GraphEdge {
  from: number; // closer to the vantage (traffic flows from -> to)
  to: number; // closer to the origin
  vantageCount: number;
  onFocusPath: boolean;
}

export interface AsGraph {
  origin: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface MtrHop {
  hop: number;
  host: string; // hostname or IP; "???" when unanswered
  ip?: string;
  lossPct?: number;
  sent?: number;
  avg?: number;
  best?: number;
  worst?: number;
  // derived
  rtt?: number; // the figure we analyze (best if present, otherwise avg)
  floor?: number; // min RTT of this hop and every later hop
  asn?: number;
  asName?: string;
  location?: Location;
}

export interface LatencyJump {
  afterHop: number; // the jump happens between afterHop and the next responding hop
  toHop: number;
  deltaMs: number;
  // Upper bound on extra one-way fibre distance this jump could buy, in km.
  maxExtraKm: number;
}

export interface Facility {
  id: number;
  name: string;
  city?: string;
  country?: string;
  continent?: Continent;
}

export interface Exchange {
  id: number;
  name: string;
  city?: string;
  country?: string;
  continent?: Continent;
}

export interface Interconnect {
  a: number;
  b: number;
  commonFacilities: Facility[];
  commonExchanges: Exchange[];
  error?: string;
}

export interface UpstreamShare {
  // The AS that hands traffic to the origin's network, as seen from a region.
  asn: number;
  name?: string;
  count: number;
}

export type VerdictLevel = "trombone" | "suspect" | "clean" | "unknown";

export interface Verdict {
  level: VerdictLevel;
  summary: string;
  reasons: string[];
}

export interface Report {
  generatedAt: string;
  prefix: string;
  origin?: number;
  originName?: string;
  focusAsn?: number;
  focusRegion?: Continent;
  sourceLocation?: Location;
  destLocation?: Location;
  focusPaths: Vantage[]; // vantage points that are, or sit behind, the focus AS
  vantages: Vantage[];
  originNetwork: number[]; // trailing ASNs most paths share: the origin's own network
  focusHandoff?: number; // the AS that hands the focus path into the origin's network
  regionalUpstreams: Partial<Record<Continent, UpstreamShare[]>>;
  graph: AsGraph;
  names: Record<number, string>;
  mtr?: {
    hops: MtrHop[];
    jumps: LatencyJump[];
  };
  suspectEdge?: [number, number];
  interconnect?: Interconnect;
  verdict: Verdict;
  warnings: string[];
}

export interface AnalyzeOptions {
  prefix: string;
  focusAsn?: number;
  mtrText?: string;
  sourceLocation?: string; // "Victoria, CA"
  destLocation?: string; // "Manassas, US"
  suspectEdge?: [number, number];
  jumpThresholdMs?: number;
  skipPeeringDb?: boolean;
  skipHopLookup?: boolean;
}
