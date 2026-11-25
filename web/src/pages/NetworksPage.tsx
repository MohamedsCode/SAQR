import type { Graph, ScanResult } from "@shared/contract";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router-dom";
import { api, downloadJson } from "../api";
import { PageHeader, primaryButton, selectClass } from "../components/ui";
import { clean, hostOf } from "../lib/display";
import { useCases } from "../lib/useCases";

const STEP_MS = 650;

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

  const flagged = useMemo(() => scans.filter((s) => s.verdict !== "safe").sort((a, b) => b.score - a.score), [scans]);
  const [seed, setSeed] = useState<string | null>(routeSeed ?? null);

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
  const seedNode = useMemo(() => { const node = pruned?.nodes.find((n) => n.scan_id === seed); return node ? String(node.id) : null; }, [pruned, seed]);

  useEffect(() => {
    if (!pruned || !container.current) return;
    const hostById = new Map<string, string>(scans.map((s) => [s.id, hostOf(s)]));
    const elements: ElementDefinition[] = [
      ...pruned.nodes.map((n) => ({
        data: {
          ...n,
          id: String(n.id),
          display:
            n.type === "domain"
              ? hostById.get(String(n.scan_id)) ?? String(n.label)
              : n.type === "brand"
                ? String(n.label).toUpperCase()
                : clean(String(n.label)) ?? edgeLabel(String(n.type), t),
        },
        classes: [String(n.type), String(n.verdict ?? ""), String(n.id) === seedNode ? "seed" : ""].join(" "),
      })),
      ...pruned.edges.map((e) => ({
        data: { ...e, id: String(e.id), source: String(e.source), target: String(e.target), label: edgeLabel(String(e.type), t) },
      })),
    ];
    const cy = cytoscape({
      container: container.current,
      elements,
      wheelSensitivity: 0.2,
      minZoom: 0.3,
      maxZoom: 2,
      style: [
        {
          selector: "node",
          style: {
            label: "data(display)",
            color: "rgba(255,255,255,0.88)",
            "font-family": "IBM Plex Sans, Segoe UI, sans-serif",
            "font-size": 12,
            "text-valign": "bottom",
            "text-margin-y": 8,
            "text-outline-color": "#0a1714",
            "text-outline-width": 3,
            opacity: 0,
          },
        },
        {
          selector: "node.domain",
          style: {
            width: 34,
            height: 34,
            "background-color": "#d97706",
            "border-width": 2,
            "border-color": "#0a1714",
            "font-size": 13,
            "font-weight": 600,
            "underlay-color": "#d97706",
            "underlay-opacity": 0.18,
            "underlay-padding": 9,
            "underlay-shape": "ellipse",
          },
        },
        {
          selector: "node.fraud",
          style: { "background-color": "#e5484d", "underlay-color": "#e5484d", "underlay-opacity": 0.2, "underlay-padding": 11, "underlay-shape": "ellipse" },
        },
        {
          selector: "node.seed",
          style: { width: 48, height: 48, "border-color": "#c9a04a", "border-width": 4, "font-size": 15, color: "#ffffff", "underlay-color": "#c9a04a", "underlay-opacity": 0.22, "underlay-padding": 16 },
        },
        {
          selector: "node[type != 'domain']",
          style: { shape: "diamond", width: 14, height: 14, "background-color": "#c9a04a", color: "rgba(255,255,255,0.55)", "font-size": 11, "font-weight": 400 },
        },
        {
          selector: "edge",
          style: {
            width: 1.5,
            "line-color": "rgba(201,160,74,0.5)",
            "curve-style": "bezier",
            opacity: 0,
          },
        },
      ],
      layout: { name: "cose", animate: false, nodeRepulsion: () => 120000, idealEdgeLength: () => 150, nodeOverlap: 40, gravity: 0.15, randomize: true, padding: 60 },
    });
    cy.fit(undefined, 70);
    cyRef.current = cy;
    cy.on("tap", "node.domain", (event) => {
      const scanId = event.target.data("scan_id");
      if (scanId) navigate(`/cases/${scanId}`);
    });

    // Grow outward from the seed: nodes pop in ring by ring, edges draw once both ends are visible.
    const root = seedNode ? cy.getElementById(seedNode) : cy.nodes(".domain").first();
    const origin = root.position();
    const final = new Map(cy.nodes().map((n) => [n.id(), { ...n.position() }]));
    cy.nodes().forEach((n) => {
      n.position({ ...origin });
    });
    const depth = new Map<string, number>();
    cy.elements().bfs({
      roots: root,
      visit: (v, _e, _u, _i, d) => {
        depth.set(v.id(), d);
      },
    });
    const timers: number[] = [];
    const maxDepth = Math.max(0, ...depth.values());
    cy.nodes().forEach((n) => {
      const d = depth.get(n.id()) ?? maxDepth + 1;
      timers.push(
        window.setTimeout(() => {
          n.animate({ position: final.get(n.id())!, style: { opacity: 1 } }, { duration: 700, easing: "ease-out-cubic" });
          n.connectedEdges().forEach((e) => {
            const other = e.source().id() === n.id() ? e.target() : e.source();
            if ((depth.get(other.id()) ?? maxDepth + 1) <= d) {
              e.delay(450).animate({ style: { opacity: 0.9 } }, { duration: 500 });
            }
          });
        }, d * STEP_MS),
      );
    });
    timers.push(window.setTimeout(() => setGrown(true), (maxDepth + 1) * STEP_MS + 600));
    return () => {
      timers.forEach(clearTimeout);
      cy.destroy();
      cyRef.current = null;
    };
  }, [pruned, seedNode, scans, navigate, t]);

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
        <div ref={container} className="relative h-[560px] w-full" dir="ltr" />
        <div className="pointer-events-none absolute start-6 top-5 flex flex-wrap gap-4 text-[12px] text-white/60">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[#e5484d]" />{t("verdict.fraud")}</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full bg-[#d97706]" />{t("verdict.suspicious")}</span>
          <span className="flex items-center gap-1.5"><span className="size-2 rotate-45 bg-brass" />{t("networks.indicator")}</span>
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
