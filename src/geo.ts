// Turning hostnames, "City, CC" strings and community descriptions into rough locations.
// Everything here is heuristic. Each Location carries its evidence so the UI can show why.

import type { Continent, Location } from "./types.ts";

const CONTINENT_BY_COUNTRY: Record<string, Continent> = {
  // North America (incl. Central America and the Caribbean)
  US: "NA", CA: "NA", MX: "NA", PR: "NA", GT: "NA", CR: "NA", PA: "NA", HN: "NA", SV: "NA", NI: "NA",
  JM: "NA", DO: "NA", BS: "NA", TT: "NA", BB: "NA", CU: "NA", HT: "NA", BZ: "NA", KY: "NA", BM: "NA",
  // South America
  BR: "SA", AR: "SA", CL: "SA", CO: "SA", PE: "SA", VE: "SA", EC: "SA", UY: "SA", PY: "SA", BO: "SA",
  // Europe
  GB: "EU", UK: "EU", IE: "EU", FR: "EU", DE: "EU", NL: "EU", BE: "EU", LU: "EU", CH: "EU", AT: "EU",
  IT: "EU", ES: "EU", PT: "EU", DK: "EU", SE: "EU", NO: "EU", FI: "EU", IS: "EU", PL: "EU", CZ: "EU",
  SK: "EU", HU: "EU", RO: "EU", BG: "EU", GR: "EU", HR: "EU", SI: "EU", RS: "EU", BA: "EU", ME: "EU",
  MK: "EU", AL: "EU", EE: "EU", LV: "EU", LT: "EU", UA: "EU", MD: "EU", BY: "EU", RU: "EU", CY: "EU",
  MT: "EU", MC: "EU", LI: "EU", GI: "EU", JE: "EU", GG: "EU", IM: "EU",
  // Africa
  ZA: "AF", NG: "AF", KE: "AF", EG: "AF", MA: "AF", TN: "AF", DZ: "AF", GH: "AF", TZ: "AF", UG: "AF",
  ET: "AF", AO: "AF", MZ: "AF", SN: "AF", CI: "AF", MU: "AF", DJ: "AF", RW: "AF", ZM: "AF", ZW: "AF",
  // Asia (incl. the Middle East)
  CN: "AS", HK: "AS", MO: "AS", TW: "AS", JP: "AS", KR: "AS", SG: "AS", MY: "AS", TH: "AS", VN: "AS",
  PH: "AS", ID: "AS", IN: "AS", PK: "AS", BD: "AS", LK: "AS", NP: "AS", AE: "AS", SA: "AS", QA: "AS",
  BH: "AS", KW: "AS", OM: "AS", IL: "AS", JO: "AS", LB: "AS", TR: "AS", IR: "AS", IQ: "AS", KZ: "AS",
  UZ: "AS", GE: "AS", AM: "AS", AZ: "AS", MN: "AS", KH: "AS", MM: "AS", LA: "AS", BN: "AS",
  // Oceania
  AU: "OC", NZ: "OC", FJ: "OC", PG: "OC", GU: "OC", NC: "OC", PF: "OC",
};

export function continentOf(country?: string): Continent | undefined {
  return country ? CONTINENT_BY_COUNTRY[country.toUpperCase()] : undefined;
}

export const CONTINENT_NAMES: Record<Continent, string> = {
  NA: "North America",
  SA: "South America",
  EU: "Europe",
  AF: "Africa",
  AS: "Asia",
  OC: "Oceania",
  AN: "Antarctica",
};

/** Parse "Edmonton, CA" (or just "CA") into a Location. */
export function parseCityCountry(text: string | undefined, source: Location["source"]): Location | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  const match = /^(?:(.*?),\s*)?([A-Za-z]{2})$/.exec(trimmed);
  if (!match) return { label: trimmed, source, evidence: trimmed };
  const country = match[2].toUpperCase();
  return { label: trimmed, country, continent: continentOf(country), source, evidence: trimmed };
}

interface Place {
  label: string;
  country: string;
}

// Site codes that show up in router hostnames. Mostly IATA, plus a few carrier favourites.
// Short codes are only matched as whole hostname tokens, never as substrings.
export const SITE_CODES: Record<string, Place> = {
  // Canada
  yvr: { label: "Vancouver, CA", country: "CA" }, van: { label: "Vancouver, CA", country: "CA" },
  vancouver: { label: "Vancouver, CA", country: "CA" }, yyj: { label: "Victoria, CA", country: "CA" },
  yyz: { label: "Toronto, CA", country: "CA" }, tor: { label: "Toronto, CA", country: "CA" },
  toronto: { label: "Toronto, CA", country: "CA" }, tor1: { label: "Toronto, CA", country: "CA" },
  yul: { label: "Montreal, CA", country: "CA" }, mtl: { label: "Montreal, CA", country: "CA" },
  montreal: { label: "Montreal, CA", country: "CA" }, yyc: { label: "Calgary, CA", country: "CA" },
  cgy: { label: "Calgary, CA", country: "CA" }, calgary: { label: "Calgary, CA", country: "CA" },
  yeg: { label: "Edmonton, CA", country: "CA" }, edtn: { label: "Edmonton, CA", country: "CA" },
  edmonton: { label: "Edmonton, CA", country: "CA" }, ywg: { label: "Winnipeg, CA", country: "CA" },
  winnipeg: { label: "Winnipeg, CA", country: "CA" }, yow: { label: "Ottawa, CA", country: "CA" },
  // United States
  sea: { label: "Seattle, US", country: "US" }, seattle: { label: "Seattle, US", country: "US" },
  pdx: { label: "Portland, US", country: "US" }, sjc: { label: "San Jose, US", country: "US" },
  sfo: { label: "San Francisco, US", country: "US" }, pao: { label: "Palo Alto, US", country: "US" },
  lax: { label: "Los Angeles, US", country: "US" }, losangeles: { label: "Los Angeles, US", country: "US" },
  phx: { label: "Phoenix, US", country: "US" }, den: { label: "Denver, US", country: "US" },
  dfw: { label: "Dallas, US", country: "US" }, dal: { label: "Dallas, US", country: "US" },
  dallas: { label: "Dallas, US", country: "US" }, hou: { label: "Houston, US", country: "US" },
  ord: { label: "Chicago, US", country: "US" }, chi: { label: "Chicago, US", country: "US" },
  chicago: { label: "Chicago, US", country: "US" }, atl: { label: "Atlanta, US", country: "US" },
  mia: { label: "Miami, US", country: "US" }, miami: { label: "Miami, US", country: "US" },
  iad: { label: "Ashburn, US", country: "US" }, ash: { label: "Ashburn, US", country: "US" },
  ashburn: { label: "Ashburn, US", country: "US" }, was: { label: "Washington DC, US", country: "US" },
  wdc: { label: "Washington DC, US", country: "US" }, manassas: { label: "Manassas, US", country: "US" },
  nyc: { label: "New York, US", country: "US" }, jfk: { label: "New York, US", country: "US" },
  ewr: { label: "Newark, US", country: "US" }, newyork: { label: "New York, US", country: "US" },
  bos: { label: "Boston, US", country: "US" }, slc: { label: "Salt Lake City, US", country: "US" },
  // Europe
  lhr: { label: "London, GB", country: "GB" }, lon: { label: "London, GB", country: "GB" },
  london: { label: "London, GB", country: "GB" }, man: { label: "Manchester, GB", country: "GB" },
  dub: { label: "Dublin, IE", country: "IE" }, ams: { label: "Amsterdam, NL", country: "NL" },
  amsterdam: { label: "Amsterdam, NL", country: "NL" }, fra: { label: "Frankfurt, DE", country: "DE" },
  frankfurt: { label: "Frankfurt, DE", country: "DE" }, ffm: { label: "Frankfurt, DE", country: "DE" },
  muc: { label: "Munich, DE", country: "DE" }, ham: { label: "Hamburg, DE", country: "DE" },
  dus: { label: "Düsseldorf, DE", country: "DE" }, ber: { label: "Berlin, DE", country: "DE" },
  par: { label: "Paris, FR", country: "FR" }, cdg: { label: "Paris, FR", country: "FR" },
  paris: { label: "Paris, FR", country: "FR" }, mrs: { label: "Marseille, FR", country: "FR" },
  bru: { label: "Brussels, BE", country: "BE" }, zrh: { label: "Zurich, CH", country: "CH" },
  vie: { label: "Vienna, AT", country: "AT" }, mil: { label: "Milan, IT", country: "IT" },
  mxp: { label: "Milan, IT", country: "IT" }, mad: { label: "Madrid, ES", country: "ES" },
  lis: { label: "Lisbon, PT", country: "PT" }, cph: { label: "Copenhagen, DK", country: "DK" },
  sto: { label: "Stockholm, SE", country: "SE" }, arn: { label: "Stockholm, SE", country: "SE" },
  stockholm: { label: "Stockholm, SE", country: "SE" }, osl: { label: "Oslo, NO", country: "NO" },
  hel: { label: "Helsinki, FI", country: "FI" }, waw: { label: "Warsaw, PL", country: "PL" },
  prg: { label: "Prague, CZ", country: "CZ" }, bud: { label: "Budapest, HU", country: "HU" },
  lux: { label: "Luxembourg, LU", country: "LU" },
  // Asia-Pacific and South America
  sin: { label: "Singapore, SG", country: "SG" }, hkg: { label: "Hong Kong, HK", country: "HK" },
  nrt: { label: "Tokyo, JP", country: "JP" }, tyo: { label: "Tokyo, JP", country: "JP" },
  syd: { label: "Sydney, AU", country: "AU" }, akl: { label: "Auckland, NZ", country: "NZ" },
  gru: { label: "São Paulo, BR", country: "BR" }, sao: { label: "São Paulo, BR", country: "BR" },
};

// Whole-hostname patterns for carriers whose naming schemes don't use site codes.
// Order matters: the first match wins.
export const HOSTNAME_RULES: { pattern: RegExp; place: Place; note: string }[] = [
  { pattern: /\.bc\.hsia\.telus\.net$/i, place: { label: "British Columbia, CA", country: "CA" }, note: "TELUS BC access" },
  { pattern: /\.ab\.hsia\.telus\.net$/i, place: { label: "Alberta, CA", country: "CA" }, note: "TELUS AB access" },
  { pattern: /\.F\.DE\.NET\.DTAG\.DE$/i, place: { label: "Frankfurt, DE", country: "DE" }, note: "DTAG site letter F" },
  { pattern: /\.DE\.NET\.DTAG\.DE$/i, place: { label: "Germany", country: "DE" }, note: "DTAG German backbone" },
];

/** Guess where a router is from its reverse-DNS name. */
export function locateHostname(host: string | undefined): Location | undefined {
  if (!host || host === "???" || /^[\d.:]+$/.test(host)) return undefined;
  for (const rule of HOSTNAME_RULES) {
    if (rule.pattern.test(host)) {
      return { ...rule.place, continent: continentOf(rule.place.country), source: "rdns", evidence: `${host} (${rule.note})` };
    }
  }
  // Split on dots, dashes and digit runs: "ae-1.r20.frnkge13.de.bb.gin.ntt.net" -> ae, r, frnkge, de, ...
  const tokens = host.toLowerCase().split(/[.\-_]+/).flatMap((t) => [t, t.replace(/\d+/g, "")]);
  for (const token of tokens) {
    const place = SITE_CODES[token];
    if (place) return { ...place, continent: continentOf(place.country), source: "rdns", evidence: `${host} (token "${token}")` };
  }
  return undefined;
}

const DESCRIPTION_PLACES: { pattern: RegExp; place: Place | { label: string; continent: Continent } }[] = [
  // Acronyms are matched case-sensitively so "us" in prose doesn't count.
  { pattern: /\bnorth america|united states/i, place: { label: "North America", continent: "NA" } },
  { pattern: /\b(?:USA?|NA|NAM)\b/, place: { label: "North America", continent: "NA" } },
  { pattern: /\bcanada\b/i, place: { label: "Canada", country: "CA" } },
  { pattern: /\beurope/i, place: { label: "Europe", continent: "EU" } },
  { pattern: /\b(?:EU|EMEA)\b/, place: { label: "Europe", continent: "EU" } },
  { pattern: /\basia/i, place: { label: "Asia-Pacific", continent: "AS" } },
  { pattern: /\bAPAC\b/, place: { label: "Asia-Pacific", continent: "AS" } },
  { pattern: /\bsouth america/i, place: { label: "South America", continent: "SA" } },
  { pattern: /\bLATAM\b/, place: { label: "South America", continent: "SA" } },
  { pattern: /\bgermany\b/i, place: { label: "Germany", country: "DE" } },
  { pattern: /\bnetherlands\b/i, place: { label: "Netherlands", country: "NL" } },
  { pattern: /\bunited kingdom|\bengland\b/i, place: { label: "United Kingdom", country: "GB" } },
  { pattern: /\bfrance\b/i, place: { label: "France", country: "FR" } },
];

/** Pull a place out of a BGP community description like "Learned at Frankfurt peering". */
export function locateDescription(description: string | undefined, evidence: string): Location | undefined {
  if (!description) return undefined;
  // City names first: they're more specific than regions.
  for (const word of description.toLowerCase().split(/[^a-z]+/)) {
    if (word.length >= 5) {
      const place = SITE_CODES[word];
      if (place) return { ...place, continent: continentOf(place.country), source: "community", evidence };
    }
  }
  for (const { pattern, place } of DESCRIPTION_PLACES) {
    if (pattern.test(description)) {
      const continent = "continent" in place ? place.continent : continentOf(place.country);
      const country = "country" in place ? place.country : undefined;
      return { label: place.label, country, continent, source: "community", evidence };
    }
  }
  return undefined;
}

/** Light-in-fibre travels about 200 km per ms, so 1 ms of RTT buys at most ~100 km of one-way distance. */
export const KM_PER_RTT_MS = 100;
