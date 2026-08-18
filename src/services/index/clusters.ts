import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import { CorpusStats, pairKey } from "./stats";

/**
 * Latent clusters over the association graph: the plugin's shadow domains.
 *
 * Built from CO-LINKING, held in the index, never written back to the vault.
 * The user's own `≈` domains are hand-made and authoritative; these sit beside
 * them, learned from how concepts actually travel together, and exist only to
 * answer "does this term belong to what this note is about".
 *
 * Co-linking rather than co-mention, and the difference is not a refinement.
 * A mention says two terms share a page; a link says the user asserted the page
 * is about that file. A long source note mentions dozens of concepts from every
 * subject the vault covers, so mentions manufacture edges between unrelated
 * domains, and Louvain has no way to tell those from real ones.
 *
 * Measured on the reference vault, the same code over the same threshold:
 * co-mention gives 19 communities and puts Chinese philosophy, pedagogy and
 * audio in one 178-member blob (`+qing` beside `+Bloom's taxonomy` and
 * `+gain (audio)`). Co-linking gives 88 communities and `+qing` sits with
 * `+tian (Heaven)`, `+junzi (gentleman)` and `+pu (uncarved block)`.
 */

/**
 * Edges below this NPMI never enter the graph.
 *
 * Chosen by measurement, not by feel. The unpruned graph averaged 81.8
 * neighbours per node with a maximum of 1,282, which is a hairball no community
 * detection can read. At 0.3 that becomes 10.6 and 96. Harder thresholds prune
 * further but start dropping concepts out of the graph entirely (1,561 nodes at
 * 0.4 and 1,199 at 0.5, against 1,760 here), which loses more than it gains.
 *
 * Capping each node to its strongest k neighbours was measured too and barely
 * moved anything (10.6 to 9.5 at top-15), because once weak edges are gone few
 * nodes have many strong ones left. It is not implemented.
 */
const MIN_EDGE_NPMI = 0.3;

/**
 * A cluster smaller than this is not treated as settled.
 *
 * Two files that co-occur strongly are a pair, not a domain, and gating on a
 * pair means gating on almost no evidence.
 */
const MIN_SETTLED_SIZE = 3;

/** Co-links a pair needs before it can carry an edge. */
const MIN_CO_LINKS = 2;

/**
 * NPMI over the LINK graph, which needs its own document frequencies.
 *
 * `npmi` in stats.ts reads mention counts throughout; asking it about a link
 * pair would divide a link co-occurrence by mention marginals and give a number
 * that means nothing.
 */
function linkNpmi(
  a: string,
  b: string,
  together: number,
  stats: CorpusStats
): number | null {
  const dfA = stats.linkDf.get(a) ?? 0;
  const dfB = stats.linkDf.get(b) ?? 0;
  if (dfA === 0 || dfB === 0) return null;
  const n = stats.noteCount;
  const pXY = together / n;
  const pX = dfA / n;
  const pY = dfB / n;
  if (pXY <= 0) return null;
  const value = Math.log(pXY / (pX * pY)) / -Math.log(pXY);
  return Number.isFinite(value) ? value : null;
}

export interface ClusterResult {
  /** Taxa path to its cluster id. Absent means the node had no strong edges. */
  membership: Map<string, number>;
  /** Cluster id to its members. */
  members: Map<number, string[]>;
  /** Cluster ids large enough to be trusted by the gate. */
  settled: Set<number>;
}

export const EMPTY_CLUSTERS: ClusterResult = {
  membership: new Map(),
  members: new Map(),
  settled: new Set(),
};

/**
 * Cluster the association graph.
 *
 * Pruning is what makes this possible: the raw graph is one connected hairball,
 * and so is the pruned one (measured: 1,758 of 1,760 nodes in a single
 * component). That is why community detection is required rather than optional.
 * A threshold can only cut a graph into pieces where pieces exist; Louvain
 * finds structure inside a graph that stays connected, which is what a
 * well-linked vault looks like.
 */
export function buildClusters(stats: CorpusStats): ClusterResult {
  const graph = new Graph({ type: "undirected" });

  for (const [key, together] of stats.coLink) {
    // Two co-links is thin, but a link is a deliberate act and two of them are
    // worth more than two accidental co-mentions. The floor is lower here than
    // the mention floor for that reason, not by oversight.
    if (together < MIN_CO_LINKS) continue;
    const sep = key.indexOf("\n");
    if (sep < 0) continue;
    const a = key.slice(0, sep);
    const b = key.slice(sep + 1);

    const score = linkNpmi(a, b, together, stats);
    if (score === null || score < MIN_EDGE_NPMI) continue;

    if (!graph.hasNode(a)) graph.addNode(a);
    if (!graph.hasNode(b)) graph.addNode(b);
    if (!graph.hasEdge(a, b)) graph.addEdge(a, b, { weight: score });
  }

  if (graph.order === 0) return EMPTY_CLUSTERS;

  const assignment = louvain(graph, { getEdgeWeight: "weight" });

  const membership = new Map<string, number>();
  const members = new Map<number, string[]>();
  for (const [node, id] of Object.entries(assignment)) {
    membership.set(node, id);
    const list = members.get(id);
    if (list) list.push(node);
    else members.set(id, [node]);
  }

  const settled = new Set<number>();
  for (const [id, list] of members) {
    if (list.length >= MIN_SETTLED_SIZE) settled.add(id);
  }

  return { membership, members, settled };
}

/**
 * Whether two taxa sit in the same settled cluster.
 *
 * The question the gate asks, kept here so the gate never reads the cluster
 * structures directly. A term in an unsettled cluster, or in none, answers
 * false: not enough evidence, which the ramp treats as "surface freely" rather
 * than as "hide".
 */
export function sameSettledCluster(
  a: string,
  b: string,
  clusters: ClusterResult
): boolean {
  const ca = clusters.membership.get(a);
  if (ca === undefined || !clusters.settled.has(ca)) return false;
  return clusters.membership.get(b) === ca;
}

/** Cluster-mates of a taxa file, excluding itself. Empty when unsettled. */
export function clusterPeers(path: string, clusters: ClusterResult): string[] {
  const id = clusters.membership.get(path);
  if (id === undefined || !clusters.settled.has(id)) return [];
  return (clusters.members.get(id) ?? []).filter((p) => p !== path);
}

/** Re-exported so callers can label a cluster without importing stats. */
export { pairKey };
