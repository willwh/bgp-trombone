// bgp-trombone viewer. Plain browser JS, no build step, no dependencies.

const $ = (sel, root = document) => root.querySelector(sel);
const app = $("#app");
const tooltip = $("#tooltip");
const form = $("#query");

const CONTINENTS = {
  NA: "North America", SA: "South America", EU: "Europe", AF: "Africa", AS: "Asia", OC: "Oceania", AN: "Antarctica",
};
const SERIES_SLOTS = 5; // categorical slots used for hand-off ASNs; the rest fold into "Other"
const SVG_NS = "http://www.w3.org/2000/svg";

let state = { report: null, region: "focus", pinned: null };

// ---------------------------------------------------------------------------
// Utilities

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function svg(tag, attrs = {}, children = []) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, v);
  for (const child of [].concat(children)) if (child) el.append(child);
  return el;
}

function html(markup) {
  const t = document.createElement("template");
  t.innerHTML = markup.trim();
  return t.content.firstElementChild;
}

function asLabel(asn, names) {
  return names[asn] ? `AS${asn} · ${names[asn]}` : `AS${asn}`;
}

function truncate(text, n) {
  if (!text) return "";
  return text.length > n ? `${text.slice(0, n - 1)}…` : text;
}

function showTip(event, markup) {
  tooltip.innerHTML = markup;
  tooltip.hidden = false;
  const pad = 14;
  const { innerWidth: w, innerHeight: h } = window;
  const rect = tooltip.getBoundingClientRect();
  let x = event.clientX + pad;
  let y = event.clientY + pad;
  if (x + rect.width > w - 8) x = event.clientX - rect.width - pad;
  if (y + rect.height > h - 8) y = event.clientY - rect.height - pad;
  tooltip.style.left = `${Math.max(8, x)}px`;
  tooltip.style.top = `${Math.max(8, y)}px`;
}

function hideTip() {
  tooltip.hidden = true;
}

function trimToFocus(path, focusAsn) {
  const i = focusAsn ? path.indexOf(focusAsn) : -1;
  return i > 0 ? path.slice(i) : path;
}

// ---------------------------------------------------------------------------
// Data

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const button = $("button", form);
  button.disabled = true;
  button.textContent = "Analyzing…";
  try {
    const res = await fetch("/api/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(data),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    state = { report: body, region: "focus", pinned: null };
    render();
  } catch (err) {
    app.replaceChildren(html(`<section class="card error"><h2>Couldn't analyze that</h2><p>${esc(err.message)}</p></section>`));
  } finally {
    button.disabled = false;
    button.textContent = "Analyze";
  }
});

// ---------------------------------------------------------------------------
// Rendering

function render() {
  const r = state.report;
  const parts = [verdictCard(r), focusPathCard(r)];
  const row = html(`<div class="grid-2"></div>`);
  row.append(handoffCard(r), interconnectCard(r));
  parts.push(row, graphCard(r));
  if (r.mtr) parts.push(traceCard(r));
  parts.push(vantageCard(r));
  if (r.warnings.length) {
    parts.push(html(`<section class="card warnings"><h2>Warnings</h2><ul>${r.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></section>`));
  }
  app.replaceChildren(...parts.filter(Boolean));
}

const LEVEL_ICON = { trombone: "▲", suspect: "◆", clean: "●", unknown: "○" };

function verdictCard(r) {
  const v = r.verdict;
  const where = [
    r.sourceLocation && `from ${esc(r.sourceLocation.label)}`,
    r.destLocation && `to ${esc(r.destLocation.label)}`,
  ].filter(Boolean).join(" ");
  return html(`
    <section class="card verdict ${v.level}">
      <span class="level">${LEVEL_ICON[v.level]} ${v.level.toUpperCase()}</span>
      <p class="summary">${esc(v.summary)}</p>
      ${v.reasons.length ? `<ul>${v.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
      <p class="meta mono">${esc(r.prefix)}${r.origin ? ` · origin ${esc(asLabel(r.origin, r.names))}` : ""} · ${r.vantages.length} RIS vantage points ${where ? `· ${where}` : ""}</p>
    </section>`);
}

function focusPathCard(r) {
  if (!r.focusAsn) return null;
  const v = r.focusPaths[0];
  if (!v) {
    return html(`<section class="card"><h2>Path from AS${r.focusAsn}</h2><p class="sub">No RIS path passes through AS${r.focusAsn}.</p></section>`);
  }
  const path = trimToFocus(v.path, r.focusAsn);
  const prepends = new Map();
  for (const asn of v.rawPath) prepends.set(asn, (prepends.get(asn) ?? 0) + 1);
  const [ea, eb] = r.suspectEdge ?? [];
  const chips = path
    .map((asn, i) => {
      const suspect = asn === ea || asn === eb;
      const times = prepends.get(asn) > 1 ? `<span class="x2">×${prepends.get(asn)}</span>` : "";
      const arrow = i < path.length - 1 ? `<span class="arrow">→</span>` : "";
      return `<span class="as ${suspect ? "suspect" : ""}">AS${asn} ${times}<small>${esc(truncate(r.names[asn], 26))}</small></span>${arrow}`;
    })
    .join("");
  const seenBy = v.peerAsn === r.focusAsn
    ? `AS${r.focusAsn}'s own best path, as exported to ${esc(v.collector)}${v.peerLocation ? ` from ${esc(v.peerLocation.label)}` : ""}.`
    : `Seen from AS${v.peerAsn}, which routes through AS${r.focusAsn}.`;
  const suspectNote = ea ? ` Outlined: the hand-off checked in PeeringDB.` : "";
  return html(`
    <section class="card">
      <h2>Path from AS${r.focusAsn}</h2>
      <p class="sub">${seenBy} Raw: <code>${esc(v.rawPath.join(" "))}</code>.${suspectNote}</p>
      <div class="pathstrip">${chips}</div>
    </section>`);
}

// Fixed colour slots per hand-off AS, ranked by global count, so a colour follows the AS across rows.
function handoffColours(r) {
  const totals = new Map();
  for (const list of Object.values(r.regionalUpstreams)) for (const u of list) totals.set(u.asn, (totals.get(u.asn) ?? 0) + u.count);
  const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([asn]) => asn);
  const colours = new Map(ranked.slice(0, SERIES_SLOTS).map((asn, i) => [asn, `var(--series-${i + 1})`]));
  return { colours, ranked };
}

function handoffCard(r) {
  const regions = Object.keys(r.regionalUpstreams);
  const card = html(`<section class="card"><h2>Who hands traffic to the origin's network</h2>
    <p class="sub">The last AS before ${esc(r.originName || `AS${r.origin}`)}'s network, by where the RIS peer sits.</p></section>`);
  if (regions.length === 0) {
    card.append(html(`<p class="muted">No vantage points with a known location.</p>`));
    return card;
  }
  const { colours, ranked } = handoffColours(r);
  const handoffMine = r.focusHandoff;
  const ordered = regions.sort((a, b) => (a === r.focusRegion ? -1 : b === r.focusRegion ? 1 : sum(r.regionalUpstreams[b]) - sum(r.regionalUpstreams[a])));
  for (const region of ordered) {
    const list = r.regionalUpstreams[region];
    const total = sum(list);
    const named = list.filter((u) => colours.has(u.asn));
    const other = list.filter((u) => !colours.has(u.asn));
    const row = html(`<div class="stack-row"><span class="lbl ${region === r.focusRegion ? "me" : ""}">${CONTINENTS[region] ?? region}</span><div class="stack"></div><span class="n">${total}</span></div>`);
    const stack = $(".stack", row);
    const segments = [...named.map((u) => ({ ...u, colour: colours.get(u.asn) }))];
    if (other.length) segments.push({ asn: null, count: sum(other), colour: "var(--series-other)", others: other });
    for (const seg of segments) {
      const el = document.createElement("span");
      el.style.flex = `${seg.count} 0 0`;
      el.style.background = seg.colour;
      if (seg.asn !== null && seg.asn === handoffMine && region === r.focusRegion) el.classList.add("mine");
      el.addEventListener("mousemove", (e) => {
        const pct = Math.round((seg.count / total) * 100);
        const body = seg.asn === null
          ? `<b>Other</b> ${seg.count} (${pct}%)<br>${seg.others.map((u) => esc(asLabel(u.asn, r.names))).join("<br>")}`
          : `<b>${esc(asLabel(seg.asn, r.names))}</b><br>${seg.count} of ${total} ${esc(CONTINENTS[region] ?? region)} vantage points (${pct}%)`;
        showTip(e, body + (el.classList.contains("mine") ? `<br>← the path AS${r.focusAsn} uses` : ""));
      });
      el.addEventListener("mouseleave", hideTip);
      stack.append(el);
    }
    card.append(row);
  }
  const legend = ranked
    .slice(0, SERIES_SLOTS)
    .map((asn) => `<span><i style="background:${colours.get(asn)}"></i>${esc(asLabel(asn, r.names))}</span>`)
    .join("");
  card.append(html(`<div class="legend">${legend}${ranked.length > SERIES_SLOTS ? `<span><i style="background:var(--series-other)"></i>Other</span>` : ""}</div>`));
  if (handoffMine !== undefined) {
    card.append(html(`<p class="meta">Outlined in red: AS${handoffMine}, the hand-off on AS${r.focusAsn}'s path.</p>`));
  }
  return card;
}

function sum(list) {
  return list.reduce((n, u) => n + u.count, 0);
}

function interconnectCard(r) {
  const card = html(`<section class="card"><h2>Where they could interconnect</h2></section>`);
  if (!r.suspectEdge) {
    card.append(html(`<p class="sub">No suspect hand-off identified.</p>`));
    return card;
  }
  const [a, b] = r.suspectEdge;
  card.append(html(`<p class="sub">Facilities and exchanges where both ${esc(asLabel(a, r.names))} and ${esc(asLabel(b, r.names))} are present (PeeringDB).</p>`));
  const ic = r.interconnect;
  if (!ic) {
    card.append(html(`<p class="muted">PeeringDB lookup skipped.</p>`));
    return card;
  }
  if (ic.error) {
    card.append(html(`<p class="muted">Lookup failed: ${esc(ic.error)}</p>`));
    return card;
  }
  const near = new Set([r.sourceLocation?.continent, r.destLocation?.continent].filter(Boolean));
  const group = (title, items) => {
    if (items.length === 0) return;
    card.append(html(`<div class="ic-group">${esc(title)} · ${items.length}</div>`));
    const sorted = [...items].sort((x, y) => Number(near.has(y.continent)) - Number(near.has(x.continent)) || (x.country ?? "").localeCompare(y.country ?? ""));
    const list = html(`<ul class="ic-list"></ul>`);
    for (const item of sorted.slice(0, 12)) {
      const where = [item.city, item.country].filter(Boolean).join(", ");
      list.append(html(`<li class="${near.has(item.continent) ? "near" : ""}"><span>${esc(item.name)}</span><span class="where">${esc(where)}</span></li>`));
    }
    if (sorted.length > 12) list.append(html(`<li class="muted">…and ${sorted.length - 12} more</li>`));
    card.append(list);
  };
  group("Facilities", ic.commonFacilities);
  group("Exchanges", ic.commonExchanges);
  if (ic.commonFacilities.length + ic.commonExchanges.length === 0) card.append(html(`<p class="muted">No shared facilities or exchanges listed.</p>`));
  else if (near.size) card.append(html(`<p class="meta">Bold locations are on the same continent as an end of the path: candidates for a local hand-off.</p>`));
  return card;
}

// ---------------------------------------------------------------------------
// AS graph

const NODE_W = 132;
const NODE_H = 38;
const GAP_Y = 12;
const COL_W = 178;
const COL_CAP = 9;

function graphCard(r) {
  const card = html(`<section class="card"><h2>AS graph</h2>
    <p class="sub">Every RIS vantage path for this prefix. Traffic flows left to right into the origin. Edge width is how many vantage points use it. Click an AS to isolate the paths through it.</p>
    ${r.focusPaths.length ? `<div class="legend" style="margin:0 0 10px"><span><i style="background:var(--critical);height:3px;vertical-align:3px"></i>AS${r.focusAsn}'s path (outlined nodes, red edges)</span></div>` : ""}
    <div class="chips" role="group" aria-label="Vantage region"></div><div class="graph-wrap"></div></section>`);
  const chips = $(".chips", card);
  const regionCounts = new Map();
  for (const v of r.vantages) {
    const c = v.peerLocation?.continent;
    if (c) regionCounts.set(c, (regionCounts.get(c) ?? 0) + 1);
  }
  const options = [["all", `All (${r.vantages.length})`]];
  if (r.focusRegion && regionCounts.has(r.focusRegion)) options.unshift(["focus", `${CONTINENTS[r.focusRegion]} (${regionCounts.get(r.focusRegion)})`]);
  for (const [c, n] of [...regionCounts.entries()].sort((a, b) => b[1] - a[1])) if (c !== r.focusRegion) options.push([c, `${CONTINENTS[c]} (${n})`]);
  if (state.region === "focus" && !options.some(([k]) => k === "focus")) state.region = "all";
  for (const [key, label] of options) {
    const b = html(`<button type="button" aria-pressed="${state.region === key}">${esc(label)}</button>`);
    b.addEventListener("click", () => {
      state.region = key;
      state.pinned = null;
      const fresh = graphCard(r);
      card.replaceWith(fresh);
    });
    chips.append(b);
  }
  const region = state.region === "focus" ? r.focusRegion : state.region === "all" ? null : state.region;
  // Always keep the focus network's own paths, whatever the filter.
  const focusSet = new Set(r.focusPaths);
  const vantages = r.vantages.filter((v) => !region || v.peerLocation?.continent === region || focusSet.has(v));
  $(".graph-wrap", card).append(drawGraph(r, vantages));
  return card;
}

function drawGraph(r, vantages) {
  const focusPath = r.focusPaths[0] ? trimToFocus(r.focusPaths[0].path, r.focusAsn) : [];
  const focusAsns = new Set(focusPath);
  const focusEdges = new Set(focusPath.slice(1).map((asn, i) => `${focusPath[i]}>${asn}`));

  // Nodes at their shortest distance from the origin; edges weighted by vantage count.
  const nodes = new Map();
  const edges = new Map();
  for (const v of vantages) {
    const p = v.path;
    p.forEach((asn, i) => {
      const depth = p.length - 1 - i;
      const n = nodes.get(asn) ?? { asn, depth, count: 0 };
      n.depth = Math.min(n.depth, depth);
      n.count++;
      nodes.set(asn, n);
      if (i < p.length - 1) {
        const key = `${asn}>${p[i + 1]}`;
        const e = edges.get(key) ?? { from: asn, to: p[i + 1], count: 0, key };
        e.count++;
        edges.set(key, e);
      }
    });
  }
  const maxDepth = Math.max(0, ...[...nodes.values()].map((n) => n.depth));

  // Columns, capped; the focus path and origin always stay visible.
  const columns = [];
  const hidden = [];
  for (let d = 0; d <= maxDepth; d++) {
    const col = [...nodes.values()].filter((n) => n.depth === d).sort((a, b) => b.count - a.count);
    const keep = col.filter((n, i) => i < COL_CAP || focusAsns.has(n.asn) || d === 0);
    hidden[d] = col.length - keep.length;
    columns[d] = keep;
  }
  const visible = new Set(columns.flat().map((n) => n.asn));

  // Barycentre ordering, working outward from the origin to cut down on crossings.
  const pos = new Map();
  columns[0].forEach((n, i) => pos.set(n.asn, i));
  for (let d = 1; d <= maxDepth; d++) {
    const score = (n) => {
      const ys = [...edges.values()].filter((e) => e.from === n.asn && pos.has(e.to)).map((e) => pos.get(e.to));
      return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : Number.POSITIVE_INFINITY;
    };
    columns[d].sort((a, b) => score(a) - score(b) || b.count - a.count);
    columns[d].forEach((n, i) => pos.set(n.asn, i));
  }

  const tallest = Math.max(...columns.map((c, d) => c.length + (hidden[d] ? 1 : 0)));
  const height = 40 + tallest * (NODE_H + GAP_Y);
  const width = 24 + (maxDepth + 1) * COL_W;
  const xOf = (depth) => 12 + (maxDepth - depth) * COL_W;
  const yOf = (asn, depth) => {
    const col = columns[depth];
    const offset = ((tallest - col.length) * (NODE_H + GAP_Y)) / 2;
    return 30 + offset + pos.get(asn) * (NODE_H + GAP_Y);
  };
  const place = new Map([...visible].map((asn) => {
    const n = nodes.get(asn);
    return [asn, { x: xOf(n.depth), y: yOf(asn, n.depth), n }];
  }));

  const root = svg("svg", { viewBox: `0 0 ${width} ${height}`, width, height, role: "img", "aria-label": "AS graph of vantage paths" });
  for (let d = 0; d <= maxDepth; d++) {
    const label = d === 0 ? "origin" : `${d} hop${d > 1 ? "s" : ""} out`;
    root.append(svg("text", { x: xOf(d) + NODE_W / 2, y: 16, "text-anchor": "middle", class: "g-col" }, [label]));
  }

  const maxCount = Math.max(1, ...[...edges.values()].map((e) => e.count));
  const edgeEls = [];
  const edgeLayer = svg("g");
  for (const e of edges.values()) {
    const a = place.get(e.from);
    const b = place.get(e.to);
    if (!a || !b) continue;
    const x1 = a.x + NODE_W;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x;
    const y2 = b.y + NODE_H / 2;
    const mid = (x1 + x2) / 2;
    const focus = focusEdges.has(e.key);
    const w = focus ? 3 : 1 + 3 * Math.sqrt(e.count / maxCount);
    const path = svg("path", { d: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`, class: `g-edge${focus ? " focus" : ""}`, "stroke-width": w.toFixed(2) });
    path.dataset.key = e.key;
    edgeEls.push(path);
    (focus ? root : edgeLayer).append(path);
  }
  root.prepend(edgeLayer); // focus edges paint above the rest

  const nodeEls = [];
  for (const [asn, { x, y, n }] of place) {
    const focus = focusAsns.has(asn);
    const g = svg("g", { class: `g-node${focus ? " focus" : ""}${asn === r.origin ? " origin" : ""}`, transform: `translate(${x},${y})`, tabindex: 0, style: "cursor:pointer" }, [
      svg("rect", { width: NODE_W, height: NODE_H, rx: 6 }),
      svg("text", { x: 9, y: 16, class: "asn" }, [`AS${asn}`]),
      svg("text", { x: 9, y: 30, class: "nm" }, [truncate(r.names[asn] || "", 20)]),
    ]);
    g.dataset.asn = asn;
    g.addEventListener("mousemove", (e) => {
      const role = asn === r.origin ? "Origin" : focus ? `On AS${r.focusAsn}'s path` : "";
      showTip(e, `<b>AS${asn}</b> ${esc(r.names[asn] || "")}<br>${n.count} vantage path${n.count === 1 ? "" : "s"} · ${n.depth} hop${n.depth === 1 ? "" : "s"} from origin${role ? `<br>${role}` : ""}`);
    });
    g.addEventListener("mouseleave", hideTip);
    g.addEventListener("click", () => {
      state.pinned = state.pinned === asn ? null : asn;
      applyPin();
    });
    nodeEls.push(g);
    root.append(g);
  }

  for (let d = 0; d <= maxDepth; d++) {
    if (!hidden[d]) continue;
    const y = yOf(columns[d].at(-1)?.asn, d) + NODE_H + GAP_Y + 12;
    root.append(svg("text", { x: xOf(d) + 9, y: Number.isFinite(y) ? y : 40, class: "g-col" }, [`+${hidden[d]} smaller`]));
  }


  function applyPin() {
    const pinned = state.pinned;
    if (pinned === null) {
      nodeEls.forEach((g) => g.classList.remove("dim"));
      edgeEls.forEach((p) => p.classList.remove("dim"));
      return;
    }
    const through = vantages.filter((v) => v.path.includes(pinned));
    const keepNodes = new Set(through.flatMap((v) => v.path));
    const keepEdges = new Set(through.flatMap((v) => v.path.slice(1).map((asn, i) => `${v.path[i]}>${asn}`)));
    nodeEls.forEach((g) => g.classList.toggle("dim", !keepNodes.has(Number(g.dataset.asn))));
    edgeEls.forEach((p) => p.classList.toggle("dim", !keepEdges.has(p.dataset.key)));
  }
  applyPin();
  return root;
}

// ---------------------------------------------------------------------------
// Trace

function traceCard(r) {
  const { hops, jumps } = r.mtr;
  const card = html(`<section class="card"><h2>Trace</h2>
    <p class="sub">Bars: best RTT per hop. Line: the floor, the lowest RTT at that hop or beyond, which ignores routers that are slow to answer pings. A rise in the floor is real path latency.</p></section>`);
  if (hops.length === 0) {
    card.append(html(`<p class="muted">No hops parsed.</p>`));
    return card;
  }
  card.append(traceChart(r, hops, jumps));
  const jumpAt = new Map(jumps.map((j) => [j.toHop, j]));
  const rows = hops
    .map((h) => {
      const j = jumpAt.get(h.hop);
      const as = h.asn ? `AS${h.asn}${h.asName ? ` <span class="muted">${esc(truncate(h.asName, 24))}</span>` : ""}` : "";
      return `<tr class="${j ? "jump" : ""}">
        <td class="num">${h.hop}</td>
        <td class="mono">${esc(h.host)}${h.ip && h.ip !== h.host ? ` <span class="muted">${esc(h.ip)}</span>` : ""}</td>
        <td>${as}</td>
        <td class="num">${h.lossPct === undefined ? "" : `${h.lossPct}%`}</td>
        <td class="num">${h.rtt === undefined ? "–" : h.rtt.toFixed(1)}</td>
        <td class="num">${h.floor === undefined ? "" : h.floor.toFixed(1)}</td>
        <td>${h.location ? esc(h.location.label) : ""}${j ? ` <span class="tag">▲ +${j.deltaMs} ms</span>` : ""}</td>
      </tr>`;
    })
    .join("");
  card.append(html(`<div class="scroll"><table>
    <thead><tr><th>#</th><th>Host</th><th>AS</th><th>Loss</th><th>RTT ms</th><th>Floor</th><th>Location</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`));
  return card;
}

function niceMax(v) {
  const step = v > 200 ? 50 : v > 80 ? 25 : 10;
  return Math.ceil(v / step) * step;
}

function traceChart(r, hops, jumps) {
  const W = 1100;
  const H = 300;
  const m = { top: 28, right: 16, bottom: 30, left: 42 };
  const plotW = W - m.left - m.right;
  const plotH = H - m.top - m.bottom;
  const maxRtt = niceMax(Math.max(10, ...hops.map((h) => h.rtt ?? 0)) * 1.08);
  const band = plotW / hops.length;
  const x = (i) => m.left + band * i + band / 2;
  const y = (v) => m.top + plotH - (v / maxRtt) * plotH;
  const barW = Math.max(4, Math.min(18, band * 0.45));

  const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, width: "100%", role: "img", "aria-label": "RTT per hop with persistent-latency floor" });
  const axis = svg("g", { class: "axis" });
  const ticks = 5;
  for (let t = 0; t <= ticks; t++) {
    const v = (maxRtt / ticks) * t;
    axis.append(svg("line", { x1: m.left, x2: W - m.right, y1: y(v), y2: y(v), class: "gridline" }));
    axis.append(svg("text", { x: m.left - 6, y: y(v) + 4, "text-anchor": "end" }, [`${Math.round(v)}`]));
  }
  hops.forEach((h, i) => axis.append(svg("text", { x: x(i), y: H - 10, "text-anchor": "middle" }, [String(h.hop)])));
  axis.append(svg("text", { x: m.left - 6, y: m.top - 12, "text-anchor": "end" }, ["ms"]));
  root.append(axis);

  // Bars with a 4px rounded top anchored to the baseline.
  hops.forEach((h, i) => {
    if (h.rtt === undefined) return;
    const x0 = x(i) - barW / 2;
    const top = Math.min(y(h.rtt), y(0) - 1);
    const rad = Math.min(4, barW / 2, y(0) - top);
    root.append(svg("path", {
      class: "bar",
      d: `M${x0},${y(0)} V${top + rad} Q${x0},${top} ${x0 + rad},${top} H${x0 + barW - rad} Q${x0 + barW},${top} ${x0 + barW},${top + rad} V${y(0)} Z`,
    }));
  });

  // Floor as a step line.
  let d = "";
  // Silent hops have no floor; carry the line across them so the step stays readable.
  hops.forEach((h, i) => {
    if (h.floor === undefined) return;
    const left = m.left + band * i;
    d += `${d ? "L" : "M"}${left},${y(h.floor)} H${left + band} `;
  });
  if (d) root.append(svg("path", { d, class: "floor" }));

  // Jump annotations.
  const index = new Map(hops.map((h, i) => [h.hop, i]));
  for (const [k, j] of jumps.entries()) {
    const i = index.get(j.toHop);
    const prev = hops[index.get(j.afterHop)];
    const cur = hops[i];
    if (i === undefined || !prev || !cur) continue;
    const bx = m.left + band * i;
    root.append(svg("line", { x1: bx, x2: bx, y1: y(prev.floor), y2: y(cur.floor), class: "jump-mark" }));
    // Only name a place inside this jump's own stretch of the trace.
    const nextLanding = jumps[k + 1] ? index.get(jumps[k + 1].toHop) : hops.length;
    const where = hops.slice(i, nextLanding).find((h) => h.location)?.location?.label;
    const labelX = Math.min(bx + 6, W - m.right - 4);
    root.append(svg("text", { x: labelX, y: Math.max(m.top - 6, y(cur.floor) - 8), class: "jump-label", "text-anchor": bx > W - 200 ? "end" : "start" }, [
      `+${j.deltaMs} ms${where ? ` → ${where}` : ""}`,
    ]));
  }

  // Hover targets wider than the marks.
  hops.forEach((h, i) => {
    const hit = svg("rect", { x: m.left + band * i, y: m.top, width: band, height: plotH, class: "hit" });
    hit.addEventListener("mousemove", (e) => {
      const lines = [
        `<b>Hop ${h.hop}</b> ${esc(h.host)}`,
        h.asn ? esc(asLabel(h.asn, r.names)) : null,
        h.rtt === undefined ? "no reply" : `best ${h.rtt.toFixed(1)} ms${h.avg !== undefined && h.avg !== h.rtt ? ` · avg ${h.avg.toFixed(1)}` : ""}`,
        h.floor !== undefined ? `floor ${h.floor.toFixed(1)} ms` : null,
        h.lossPct !== undefined ? `loss ${h.lossPct}%` : null,
        h.location ? `${esc(h.location.label)} <span style="opacity:.7">(${esc(h.location.source)})</span>` : null,
      ].filter(Boolean);
      showTip(e, lines.join("<br>"));
    });
    hit.addEventListener("mouseleave", hideTip);
    root.append(hit);
  });

  const wrap = document.createElement("div");
  wrap.append(root);
  wrap.append(html(`<div class="legend"><span><i style="background:var(--series-1)"></i>Best RTT</span><span><i style="background:var(--text-secondary);height:2px;vertical-align:3px"></i>Floor</span><span><i style="background:var(--critical);width:2px"></i>Persistent jump</span></div>`));
  return wrap;
}

// ---------------------------------------------------------------------------
// Vantage table

function vantageCard(r) {
  const card = html(`<section class="card"><details><summary><h2 style="display:inline">All vantage paths</h2> <span class="muted">(${r.vantages.length})</span></summary></details></section>`);
  const focus = new Set(r.focusPaths);
  const sorted = [...r.vantages].sort((a, b) => Number(focus.has(b)) - Number(focus.has(a)) || (a.peerLocation?.country ?? "~").localeCompare(b.peerLocation?.country ?? "~"));
  const rows = sorted
    .map((v) => `<tr class="${focus.has(v) ? "jump" : ""}">
      <td class="mono">${esc(v.collector)}</td>
      <td class="mono">${esc(v.peerIp)}</td>
      <td>${esc(v.peerLocation?.label ?? "")}</td>
      <td class="mono" title="${esc(v.path.map((a) => asLabel(a, r.names)).join(" → "))}">${esc(v.rawPath.join(" "))}</td>
      <td class="mono muted">${esc(v.communities.map((c) => c.value).join(" "))}</td>
    </tr>`)
    .join("");
  $("details", card).append(html(`<div class="scroll"><table>
    <thead><tr><th>Collector</th><th>Peer</th><th>Peer location</th><th>AS path (raw)</th><th>Communities</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`));
  return card;
}
