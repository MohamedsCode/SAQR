"""Campaign graph: links scans to shared indicators and clusters domains into campaigns."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable

from shared.contract import Graph, GraphCluster, GraphElement, ScanResult

# Indicators shared by unrelated sites; linking through them would merge everything.
UBIQUITOUS = {
    "issuer:let's encrypt",
    "issuer:google trust services",
    "issuer:cloudflare",
    "org:cloudflare, inc.",
    "org:amazon.com, inc.",
    "org:google llc",
}
MAX_SHARE = 0.5  # an indicator seen on more than half the domains is treated as ubiquitous


def _indicators(scan: ScanResult) -> Iterable[tuple[str, str, str]]:
    """Yield (node_id, node_type, label) for every indicator in a scan."""
    ev = scan.evidence
    if ev.hosting and ev.hosting.ip:
        yield f"ip:{ev.hosting.ip}", "ip", ev.hosting.ip
    if ev.hosting and ev.hosting.asn:
        yield f"asn:{ev.hosting.asn}", "asn", f"AS{ev.hosting.asn} {ev.hosting.org or ''}".strip()
    if ev.rdap and ev.rdap.registrar:
        yield f"registrar:{ev.rdap.registrar.lower()}", "registrar", ev.rdap.registrar
    nameservers = set(ev.dns.ns if ev.dns else []) | set(ev.rdap.nameservers if ev.rdap else [])
    for ns in sorted(nameservers):
        yield f"ns:{ns.lower()}", "nameserver", ns
    if ev.tls and ev.tls.issuer:
        yield f"issuer:{ev.tls.issuer.lower()}", "certificate", ev.tls.issuer
    if ev.favicon_phash:
        yield f"favicon:{ev.favicon_phash}", "favicon", ev.favicon_phash
    for phone in ev.phones_found:
        yield f"phone:{phone}", "phone", phone
    for email in ev.emails_found:
        yield f"email:{email.lower()}", "email", email


def build_graph(scans: list[ScanResult], seed: str | None = None) -> Graph:
    flagged = [s for s in scans if s.verdict != "safe"]
    domain_ids = {s.id: f"domain:{s.registered_domain}" for s in flagged}

    nodes: dict[str, dict] = {}
    edges: dict[str, dict] = {}
    holders: dict[str, set[str]] = defaultdict(set)

    for scan in flagged:
        dom = domain_ids[scan.id]
        nodes[dom] = {
            "id": dom, "type": "domain", "label": scan.registered_domain,
            "scan_id": scan.id, "verdict": scan.verdict, "score": scan.score,
        }
        if scan.impersonated_brand:
            brand = f"brand:{scan.impersonated_brand}"
            nodes.setdefault(brand, {"id": brand, "type": "brand", "label": scan.impersonated_brand})
            edges[f"{dom}->{brand}"] = {"id": f"{dom}->{brand}", "source": dom, "target": brand, "type": "impersonates"}
        for node_id, node_type, label in _indicators(scan):
            nodes.setdefault(node_id, {"id": node_id, "type": node_type, "label": label})
            edges[f"{dom}->{node_id}"] = {"id": f"{dom}->{node_id}", "source": dom, "target": node_id, "type": node_type}
            holders[node_id].add(dom)

    limit = max(2, int(len(flagged) * MAX_SHARE))
    linking = {
        node_id: doms for node_id, doms in holders.items()
        if len(doms) > 1 and node_id not in UBIQUITOUS and len(doms) <= limit
    }
    for node_id in holders:
        nodes[node_id]["ubiquitous"] = node_id in UBIQUITOUS or len(holders[node_id]) > limit

    parent = {dom: dom for dom in domain_ids.values()}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for doms in linking.values():
        first, *rest = sorted(doms)
        for other in rest:
            parent[find(other)] = find(first)

    groups: dict[str, list[str]] = defaultdict(list)
    for dom in parent:
        groups[find(dom)].append(dom)
    clusters = sorted(
        (sorted(members) for members in groups.values() if len(members) > 1),
        key=lambda members: (-len(members), members[0]),
    )
    cluster_of = {dom: f"campaign-{i + 1}" for i, members in enumerate(clusters) for dom in members}
    for dom, cluster_id in cluster_of.items():
        nodes[dom]["cluster"] = cluster_id

    keep_domains = set(parent)
    if seed and seed in domain_ids:
        seed_dom = domain_ids[seed]
        keep_domains = {d for d in parent if find(d) == find(seed_dom)}
    keep_edges = [e for e in edges.values() if e["source"] in keep_domains]
    keep_nodes = keep_domains | {e["target"] for e in keep_edges}

    return Graph(
        nodes=[GraphElement(data=nodes[n]) for n in sorted(keep_nodes)],
        edges=[GraphElement(data=e) for e in keep_edges],
        clusters=[
            GraphCluster(
                id=cluster_of[members[0]],
                domains=[nodes[d]["label"] for d in members],
                size=len(members),
            )
            for members in clusters
            if members[0] in keep_domains
        ],
    )
