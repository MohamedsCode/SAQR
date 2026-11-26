import type { Graph, ScanResult } from "@shared/contract";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { api, downloadJson } from "../api";
import { PageHeader, primaryButton, selectClass } from "../components/ui";
import { clean, hostOf } from "../lib/display";
import { useCases } from "../lib/useCases";

// Columns appear one after another, slowly enough to follow: reported site, shared clues, linked sites.
const STEP_MS = 1400;
const NODE_MS = 900;
const EDGE_MS = 700;
const ROW_CLUE = 30; // clue labels sit beside their diamond
const ROW_SITE = 66; // site names sit under their dot, so sites need taller rows
const MIN_HEIGHT = 520;
const PAD = { top: 80, bottom: 70, left: 110, right: 110 };

function edgeLabel(type: string, t: (k: string) => string): string {
  return t(`networks.edge_${type}`);
}

/** Keep domains, brands and indicators shared by at least two domains; drop ubiquitous indicators. */
function prune(graph: Graph) {
  const nodes = graph.nodes.map((n) => n.data);
  const edges = graph.edges.map((e) => e.data);
  const degree = new Map<string, number>();
  for (const e of edges) degree.set(String(e.target), (degree.get(String(e.target)) ?? 0) + 1);
  const keep = new Set(
    nodes
      .filter((n) => n.type === "domain" || (n.type !== "brand" && !n.ubiquitous && (degree.get(String(n.id)) ?? 0) >= 2))
      .map((n) => String(n.id)),
  );
  return {
    nodes: nodes.filter((n) => keep.has(String(n.id))),
    edges: edges.filter((e) => keep.has(String(e.source)) && keep.has(String(e.target))),
  };
}

type Pruned = ReturnType<typeof prune>;

/**
 * Columns by distance from the reported site: 0 = the site, 1 = clues it shares, 2 = sites sharing them, and so on.
 * Each column is ordered by where its neighbours sit in the previous column, so lines cross as little as possible.
 */
function columnsOf(pruned: Pruned, rootId: string | null): string[][] {
  const ids = pruned.nodes.map((n) => String(n.id));
  const neighbours = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const e of pruned.edges) {
    neighbours.get(String(e.source))?.push(String(e.target));
    neighbours.get(String(e.target))?.push(String(e.source));
  }
  const firstDomain = pruned.nodes.find((n) => n.type === "domain");
  const root = rootId && neighbours.has(rootId) ? rootId : firstDomain ? String(firstDomain.id) : null;
  const depth = new Map<string, number>();
  if (root) {
    depth.set(root, 0);
    const queue = [root];
    while (queue.length) {
      const id = queue.shift()!;
      for (const next of neighbours.get(id) ?? []) {
        if (!depth.has(next)) {
          depth.set(next, depth.get(id)! + 1);
          queue.push(next);
        }
      }
    }
  }
  const last = Math.max(0, ...depth.values());
  const columns: string[][] = [];
  for (const id of ids) {
    const d = depth.get(id) ?? last + 1; // not connected to the reported site: a column of its own at the end
    (columns[d] ??= []).push(id);
  }
  const type = new Map(pruned.nodes.map((n) => [String(n.id), String(n.type)]));
  const row = new Map<string, number>();
  columns.forEach((column, d) => {
    const centre = (id: string) => {
      const rows = (neighbours.get(id) ?? []).filter((n) => depth.get(n) === d - 1).map((n) => row.get(n) ?? 0);
      return rows.length ? rows.reduce((a, b) => a + b, 0) / rows.length : 0;
    };
    column.sort((a, b) => centre(a) - centre(b) || (type.get(a) ?? "").localeCompare(type.get(b) ?? ""));
    column.forEach((id, i) => row.set(id, i));
  });
  return columns.filter(Boolean);
}

/** Spread the columns across the panel's width and each column's dots down its height. */
function positions(columns: string[][], width: number, height: number) {
  const span = Math.max(1, width - PAD.left - PAD.right);
  const xs = columns.map((_, d) => (columns.length === 1 ? width / 2 : PAD.left + (d * span) / (columns.length - 1)));
  const placed = new Map<string, { x: number; y: number }>();
  const usable = height - PAD.top - PAD.bottom;
  columns.forEach((column, d) => {
    column.forEach((id, i) => placed.set(id, { x: xs[d], y: PAD.top + ((i + 0.5) * usable) / column.length }));
  });
  return { placed, xs };
}

export default function NetworksPage() {
  const { id: routeSeed } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { scans } = useCases();
  const container = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [error, setError] = useState(false);
  const [grown, setGrown] = useState(false);
  const [columnXs, setColumnXs] = useState<number[]>([]);

  const flagged = useMemo(() => scans.filter((s) => s.verdict !== "safe").sort((a, b) => b.score - a.score), [scans]);
  const [seed, setSeed] = useState<string | null>(routeSeed ?? null);

  // The case list refreshes every few seconds; host names are read from a ref so a refresh never rebuilds the graph.
  const hostById = useRef(new Map<string, string>());
  hostById.current = new Map(scans.map((s) => [s.id, hostOf(s)]));

  useEffect(() => {
    if (routeSeed) setSeed(routeSeed);
  }, [routeSeed]);

  // Without a chosen case, start from the highest-scoring case that belongs to a campaign.
  useEffect(() => {
    if (seed) return;
    api
      .graph()
      .then((g) => {
        const inCampaign = new Set(g.clusters.flatMap((c) => c.domains));
        const best = flagged.find((s) => inCampaign.has(s.registered_domain)) ?? flagged[0];
        if (best) setSeed(best.id);
      })
      .catch(() => setError(true));
  }, [seed, flagged]);

  useEffect(() => {
    if (!seed) return;
    setGrown(false);
    api.graph(seed).then(setGraph).catch(() => setError(true));
  }, [seed]);

  const pruned = useMemo(() => (graph ? prune(graph) : null), [graph]);
  const domainCount = pruned?.nodes.filter((n) => n.type === "domain").length ?? 0;
  const seedNode = useMemo(() => {
    const node = pruned?.nodes.find((n) => n.scan_id === seed);
    return node ? String(node.id) : null;
  }, [pruned, seed]);
  const columns = useMemo(() => (pruned ? columnsOf(pruned, seedNode) : []), [pruned, seedNode]);
  const height = useMemo(() => {
    const sites = new Set(pruned?.nodes.filter((n) => n.type === "domain").map((n) => String(n.id)));
    const tallest = Math.max(0, ...columns.map((c) => c.length * (c.some((id) => sites.has(id)) ? ROW_SITE : ROW_CLUE)));
    return Math.max(MIN_HEIGHT, PAD.top + PAD.bottom + tallest);
  }, [pruned, columns]);

  useEffect(() => {
    const box = container.current;
    if (!pruned || !box || !columns.length) return;
    const elements: ElementDefinition[] = [
      ...pruned.nodes.map((n) => ({
        data: {
          ...n,
          id: String(n.id),
          display:
            n.type === "domain"
              ? hostById.current.get(String(n.scan_id)) ?? String(n.label)
              : clean(String(n.label)) ?? edgeLabel(String(n.type), t),
        },
        classes: [String(n.type), String(n.verdict ?? ""), String(n.id) === seedNode ? "seed" : ""].join(" "),
      })),
      ...pruned.edges.map((e) => ({
        data: { ...e, id: String(e.id), source: String(e.source), target: String(e.target), label: edgeLabel(String(e.type), t) },
      })),
    ];
    const cy = cytoscape({
      container: box,
      elements,
      userZoomingEnabled: false,
      userPanningEnabled: false,
      boxSelectionEnabled: false,
      autoungrabify: true,
      style: [
        {
          selector: "node",
          style: {
            label: "data(display)",
            color: "rgba(255,255,255,0.9)",
            "font-family": "IBM Plex Sans, Segoe UI, sans-serif",
            "font-size": 12,
            "text-halign": "right",
            "text-valign": "center",
            "text-margin-x": 12,
            "text-wrap": "ellipsis",
            "text-max-width": "210px",
            "text-outline-color": "#0a1714",
            "text-outline-width": 3,
            opacity: 0,
          },
        },
        {
          selector: "node.domain",
          style: {
            width: 26,
            height: 26,
            "background-color": "#d97706",
            "border-width": 2,
            "border-color": "#0a1714",
            "font-size": 13,
            "font-weight": 600,
            "text-halign": "center",
            "text-valign": "bottom",
            "text-margin-x": 0,
            "text-margin-y": 8,
            "text-max-width": "190px",
            "underlay-color": "#d97706",
            "underlay-opacity": 0.18,
            "underlay-padding": 7,
            "underlay-shape": "ellipse",
          },
        },
        { selector: "node.fraud", style: { "background-color": "#e5484d", "underlay-color": "#e5484d" } },
        {
          selector: "node.seed",
          style: {
            width: 40,
            height: 40,
            "border-color": "#c9a04a",
            "border-width": 4,
            "font-size": 15,
            color: "#ffffff",
            "underlay-color": "#c9a04a",
            "underlay-opacity": 0.25,
            "underlay-padding": 12,
          },
        },
        {
          selector: "node[type != 'domain']",
          style: { shape: "diamond", width: 13, height: 13, "background-color": "#c9a04a", color: "rgba(255,255,255,0.62)", "font-size": 11, "font-weight": 400 },
        },
        { selector: "edge", style: { width: 1.5, "line-color": "rgba(201,160,74,0.55)", "curve-style": "straight", opacity: 0 } },
      ],
      layout: { name: "preset", fit: false },
    });
    cyRef.current = cy;
    cy.zoom(1);
    cy.pan({ x: 0, y: 0 });

    let final = positions(columns, box.clientWidth, box.clientHeight).placed;
    setColumnXs(positions(columns, box.clientWidth, box.clientHeight).xs);
    const column = new Map(columns.flatMap((ids, d) => ids.map((id) => [id, d] as const)));
    cy.nodes().forEach((n) => {
      const to = final.get(n.id())!;
      n.position({ x: to.x - 40, y: to.y });
    });

    // Column by column: the dots slide in, then the lines back to the previous column draw.
    const timers: number[] = [];
    let done = false;
    columns.forEach((ids, d) => {
      timers.push(
        window.setTimeout(() => {
          for (const id of ids) {
            cy.getElementById(id).animate({ position: final.get(id)!, style: { opacity: 1 } }, { duration: NODE_MS, easing: "ease-out-cubic" });
          }
        }, d * STEP_MS),
      );
      timers.push(
        window.setTimeout(() => {
          cy.edges().forEach((e) => {
            const reach = Math.max(column.get(e.source().id()) ?? 0, column.get(e.target().id()) ?? 0);
            if (reach === d) e.animate({ style: { opacity: 0.8 } }, { duration: EDGE_MS });
          });
        }, d * STEP_MS + NODE_MS * 0.6),
      );
    });
    timers.push(
      window.setTimeout(() => {
        done = true;
        setGrown(true);
      }, (columns.length - 1) * STEP_MS + NODE_MS + EDGE_MS),
    );

    // Once drawn, hovering a dot shows only its own links.
    cy.on("mouseover", "node", (event) => {
      if (!done) return;
      const near = event.target.closedNeighborhood();
      cy.elements().not(near).style("opacity", 0.12);
      near.style("opacity", 1);
    });
    cy.on("mouseout", "node", () => {
      if (!done) return;
      cy.nodes().style("opacity", 1);
      cy.edges().style("opacity", 0.8);
    });
    cy.on("tap", "node.domain", (event) => {
      const scanId = event.target.data("scan_id");
      if (scanId) navigate(`/cases/${scanId}`);
    });

    // Keep the columns spread across the panel when the window changes size.
    const resize = new ResizeObserver(() => {
      cy.resize();
      const next = positions(columns, box.clientWidth, box.clientHeight);
      setColumnXs(next.xs);
      final = next.placed;
      if (done) cy.nodes().forEach((n) => void n.position(final.get(n.id())!));
    });
    resize.observe(box);
    return () => {
      resize.disconnect();
      timers.forEach(clearTimeout);
      cy.destroy();
      cyRef.current = null;
    };
  }, [pruned, columns, seedNode, navigate, t]);

  async function exportPackage() {
    if (!pruned) return;
    const ids = pruned.nodes.filter((n) => n.type === "domain").map((n) => String(n.scan_id));
    const cases: ScanResult[] = (await Promise.all(ids.map((id) => api.scanById(id).catch(() => null)))).filter(Boolean) as ScanResult[];
    const contacts = new Map<string, string[]>();
    for (const c of cases) {
      for (const who of [c.evidence.rdap?.abuse_email, c.evidence.hosting?.org].filter(Boolean) as string[]) {
        contacts.set(who, [...(contacts.get(who) ?? []), hostOf(c)]);
      }
    }
    downloadJson(`saqr-takedown-package-${seed}.json`, {
      generated_at: new Date().toISOString(),
      seed_case: seed,
      sites: cases.map((c) => ({ case_id: c.id, host: hostOf(c), score: c.score, verdict: c.verdict, evidence_pdf: `/api/scans/${c.id}/evidence.pdf` })),
      shared_indicators: pruned.nodes.filter((n) => n.type !== "domain" && n.type !== "brand").map((n) => ({ type: n.type, value: n.label })),
      takedown_contacts: Object.fromEntries(contacts),
      cases,
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        page="networks"
        aside={
          <select value={seed ?? ""} onChange={(e) => navigate(`/networks/${e.target.value}`)} className={selectClass}>
            {flagged.map((s) => (
              <option key={s.id} value={s.id}>
                {hostOf(s)} · {s.score}
              </option>
            ))}
          </select>
        }
      />
      {error && <p className="text-fraud">{t("networks.error")}</p>}
      <section className="relative overflow-hidden rounded-[28px] bg-ink shadow-[0_30px_60px_-30px_rgb(10_23_20/0.7)]">
        <div className="eye-rings pointer-events-none absolute -end-56 -top-64 size-[700px]" />
        <div ref={container} className="relative w-full" style={{ height }} dir="ltr" />
        <div className="pointer-events-none absolute inset-x-0 top-6" dir="ltr">
          {columnXs.map((x, d) => (
            <span
              key={d}
              style={{ left: x }}
              className="absolute -translate-x-1/2 whitespace-nowrap text-[11px] font-semibold uppercase tracking-[0.14em] text-brass"
            >
              {t(d === 0 ? "networks.col_seed" : d % 2 ? "networks.col_clues" : "networks.col_sites")}
            </span>
          ))}
        </div>
        <div className="pointer-events-none absolute inset-x-6 bottom-5 flex flex-wrap items-center justify-between gap-4 text-[12px] text-white/60">
          <span className="flex flex-wrap gap-4">
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[#e5484d]" />{t("verdict.fraud")}</span>
            <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[#d97706]" />{t("verdict.suspicious")}</span>
            <span className="flex items-center gap-1.5"><span className="size-2 rotate-45 bg-brass" />{t("networks.indicator")}</span>
          </span>
          <span>{t("networks.hint")}</span>
        </div>
      </section>
      {grown && domainCount > 0 && (
        <section className="card flex flex-wrap items-center justify-between gap-4 px-7 py-5">
          <p className="font-display flex flex-wrap items-center gap-3 text-[26px] font-semibold">
            <span className="animate-fade-up">{t("networks.caption_report")}</span>
            <span className="animate-fade-up text-gold" style={{ animationDelay: "300ms" }}>→</span>
            <span className="animate-fade-up text-fraud" style={{ animationDelay: "500ms" }}>{t("networks.caption_sites", { count: domainCount })}</span>
            <span className="animate-fade-up text-gold" style={{ animationDelay: "800ms" }}>→</span>
            <span className="animate-fade-up text-safe" style={{ animationDelay: "1000ms" }}>{t("networks.caption_takedown")}</span>
          </p>
          <button type="button" onClick={exportPackage} className={primaryButton}>
            {t("networks.export")}
          </button>
        </section>
      )}
    </div>
  );
}
