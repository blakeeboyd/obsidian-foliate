/**
 * Over-broad aliases: the noise no gate can remove.
 *
 * "+care" carries the alias "care" beside "Sorge"; "+equipment" carries
 * "equipment" beside "Zeug". The bare word claims every use of ordinary
 * vocabulary for a specific concept, and that claim lives in the data, so no
 * amount of context scoring undoes it. These assertions pin the three
 * conditions, each of which rules out a different innocent case.
 *
 * Run: npx tsx src/services/index/overbroad.test.ts
 */
import * as assert from "assert";
import { computeStats } from "./stats";
import { findOverbroadAliases } from "./overbroad";

const CARE = "c/+care.md";
const DAW = "c/+digital audio workstation.md";
const RARE = "c/+sorge only.md";
const SOLO = "c/+solo.md";

// "care" is everywhere and never linked; the DAW is common and often linked.
const mentions: Set<string>[] = [];
for (let i = 0; i < 120; i++) mentions.push(new Set([CARE]));
for (let i = 0; i < 120; i++) mentions.push(new Set([DAW]));
for (let i = 0; i < 4; i++) mentions.push(new Set([RARE]));
for (let i = 0; i < 120; i++) mentions.push(new Set([SOLO]));
for (let i = 0; i < 400; i++) mentions.push(new Set([`c/+f${i % 80}.md`]));

const links: Set<string>[] = [];
for (let i = 0; i < 40; i++) links.push(new Set([DAW]));
links.push(new Set([CARE]));

const stats = computeStats(mentions, links);

const files = [
  { path: CARE, terms: ["care", "Sorge", "care-structure"] },
  { path: DAW, terms: ["DAW", "digital audio workstation"] },
  { path: RARE, terms: ["sorge", "Sorge proper"] },
  { path: SOLO, terms: ["solo"] },
];

const found = findOverbroadAliases(files, stats);
const flagged = found.map((f) => f.alias);

// The case this exists for.
{
  assert.ok(flagged.includes("care"), "a bare common word nobody links is flagged");
  const care = found.find((f) => f.alias === "care")!;
  assert.deepStrictEqual(
    care.alternatives,
    ["Sorge", "care-structure"],
    "the terms that keep working are named, so removing the alias is safe"
  );
}

// A term the user links deliberately is doing its job, however common.
{
  assert.ok(!flagged.includes("DAW"), "a well-linked term is never flagged");
}

// A rare word is nobody's problem, even unlinked.
{
  assert.ok(!flagged.includes("sorge"), "a rare term is not over-broad");
}

// Removing a file's only term would make it unreachable, which helps nobody.
{
  assert.ok(!flagged.includes("solo"), "a file with no other term is left alone");
}

// Multi-word aliases never misfire by accident, so they are not candidates.
{
  assert.ok(!flagged.includes("care-structure"));
  assert.ok(!flagged.includes("digital audio workstation"));
}

console.log("overbroad: all assertions passed");
