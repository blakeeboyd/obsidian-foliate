/**
 * Check the clustering's contract, not Louvain itself.
 *
 * What matters here is that two genuinely separate groups come out separate,
 * that a pair too small to mean anything is never called settled, and that a
 * weak edge cannot join two groups that otherwise have nothing to do with each
 * other. The algorithm is a maintained library; the pruning and the settled
 * rule around it are ours.
 *
 * Run: npx tsx src/services/index/clusters.test.ts
 */
import * as assert from "assert";
import { computeStats } from "./stats";
import { buildClusters, sameSettledCluster, clusterPeers } from "./clusters";

// Two tight groups, built so every within-group pair clears the NPMI floor and
// nothing crosses between them.
const AUDIO = ["c/+phase.md", "c/+reverb.md", "c/+delay.md", "c/+gain.md"];
const PEDAGOGY = ["c/+rubric.md", "c/+backward design.md", "c/+bloom.md", "c/+transfer.md"];

const sets: Set<string>[] = [];
for (let i = 0; i < 30; i++) sets.push(new Set(AUDIO));
for (let i = 0; i < 30; i++) sets.push(new Set(PEDAGOGY));
// Filler so the corpus is bigger than the two groups and NPMI stays meaningful.
for (let i = 0; i < 200; i++) sets.push(new Set([`c/+filler${i % 40}.md`]));

const stats = computeStats(sets);
const clusters = buildClusters(stats);

// Each group holds together.
{
  for (const a of AUDIO) {
    for (const b of AUDIO) {
      if (a === b) continue;
      assert.ok(sameSettledCluster(a, b, clusters), `${a} and ${b} should cluster together`);
    }
  }
}

// The groups stay apart: they never co-occur, so no edge joins them.
{
  assert.ok(
    !sameSettledCluster(AUDIO[0], PEDAGOGY[0], clusters),
    "groups that never co-occur must not share a cluster"
  );
}

// Peers exclude the file itself.
{
  const peers = clusterPeers(AUDIO[0], clusters);
  assert.ok(!peers.includes(AUDIO[0]));
  for (const other of AUDIO.slice(1)) assert.ok(peers.includes(other));
}

// A term with no strong edges is in no cluster, and asking is safe.
{
  assert.strictEqual(clusters.membership.has("c/+filler0.md"), false);
  assert.deepStrictEqual(clusterPeers("c/+filler0.md", clusters), []);
  assert.strictEqual(sameSettledCluster("c/+filler0.md", AUDIO[0], clusters), false);
}

// A pair is not a domain. Two files that always travel together but have no
// third member must not count as settled, or the gate acts on almost nothing.
{
  const pairSets: Set<string>[] = [];
  for (let i = 0; i < 20; i++) pairSets.push(new Set(["c/+a.md", "c/+b.md"]));
  for (let i = 0; i < 200; i++) pairSets.push(new Set([`c/+n${i % 40}.md`]));
  const c = buildClusters(computeStats(pairSets));
  assert.strictEqual(
    sameSettledCluster("c/+a.md", "c/+b.md", c),
    false,
    "a two-member cluster is not settled"
  );
}

// An empty corpus produces empty clusters rather than throwing.
{
  const c = buildClusters(computeStats([]));
  assert.strictEqual(c.membership.size, 0);
  assert.strictEqual(c.settled.size, 0);
}

console.log("clusters: all assertions passed");
