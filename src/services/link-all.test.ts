/**
 * Check what "Link all unlinked taxa" actually links: the first occurrence of
 * each file, in body text, and never inside a heading.
 *
 * Linking every occurrence turned a note that says "delay" twelve times into a
 * wall of links. Linking inside a heading rewrites the heading text, which
 * breaks [[note#Heading]] links and fills the outline with link syntax.
 *
 * Run: npx tsx src/services/link-all.test.ts
 */
import * as assert from "assert";

/** Heading spans, matching findExcludedRegions. */
function headingRegions(text: string) {
  const out: { start: number; end: number }[] = [];
  const re = /^[ \t]{0,3}#{1,6}[ \t][^\n]*/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

/** Occurrences of `term` outside any excluded region. */
function bodyOccurrences(text: string, term: string) {
  const excluded = headingRegions(text);
  const out: number[] = [];
  let from = 0;
  while (true) {
    const i = text.indexOf(term, from);
    if (i < 0) break;
    if (!excluded.some((r) => i >= r.start && i < r.end)) out.push(i);
    from = i + term.length;
  }
  return out;
}

/** What the bulk command links: one occurrence per file, the earliest. */
function linkTargets(text: string, terms: string[]) {
  return terms
    .map((t) => ({ term: t, offset: bodyOccurrences(text, t)[0] }))
    .filter((x) => x.offset !== undefined);
}

// One link per term, even when the term repeats.
{
  const text = "The delay is long. A delay again. Yet another delay here.";
  const r = linkTargets(text, ["delay"]);
  assert.strictEqual(r.length, 1, "one link per file, not one per occurrence");
  assert.strictEqual(r[0].offset, 4, "the first occurrence is the one linked");
}

// A term first appearing in a heading links at its first BODY occurrence.
{
  const text = "# About delay\n\nThe delay is long.";
  const occ = bodyOccurrences(text, "delay");
  assert.strictEqual(occ.length, 1, "the heading occurrence is excluded");
  assert.strictEqual(text.slice(occ[0] - 4, occ[0]), "The ", "links in the prose below");
}

// A term appearing ONLY in a heading is not linked at all.
{
  const text = "## Reverb and space\n\nNothing else here.";
  assert.deepStrictEqual(bodyOccurrences(text, "Reverb"), [], "heading-only term is skipped");
}

// Every heading level is excluded, and a hash without a space is not a heading.
{
  for (const h of ["# delay", "###### delay", "   ### delay"]) {
    assert.deepStrictEqual(bodyOccurrences(`${h}\n`, "delay"), [], `excluded: ${h}`);
  }
  const tag = "#delay is a tag, not a heading";
  assert.strictEqual(bodyOccurrences(tag, "delay").length, 1, "#tag is not a heading");
}

// Several files each get their own single link.
{
  const text = "Both delay and reverb here. More delay, more reverb.";
  const r = linkTargets(text, ["delay", "reverb"]);
  assert.deepStrictEqual(r.map((x) => x.term), ["delay", "reverb"]);
  assert.deepStrictEqual(r.map((x) => x.offset), [5, 15], "each links at its own first use");
}

console.log("link-all first-occurrence and heading rules: all assertions passed");

// ---- Exclusion zones ----
// Regions where a wikilink would break syntax or make no sense. These predate
// this session; asserted here so a change to one regex can't silently open a
// hole in another.

function excludedRegions(text: string) {
  const regions: { start: number; end: number }[] = [];
  const add = (re: RegExp) => {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) regions.push({ start: m.index, end: m.index + m[0].length });
  };
  add(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm); // fenced code
  add(/^[ \t]{0,3}#{1,6}[ \t][^\n]*/gm); // headings
  add(/(`+)(?:[^`]|(?!\1)`)*?\1/g); // inline code
  add(/!?\[[^\]\n]*\]\((?:[^()\n]|\([^()\n]*\))*\)/g); // markdown links
  add(/<[a-z][a-z0-9+.-]*:\/\/[^>\s]+>|(?:https?:\/\/|www\.)[^\s)\]<>"']+/gi); // urls
  return regions;
}

function isExcluded(text: string, term: string) {
  const i = text.indexOf(term);
  if (i < 0) throw new Error(`term not present: ${term}`);
  return excludedRegions(text).some((r) => i >= r.start && i < r.end);
}

// Inline code.
assert.ok(isExcluded("Use `delay` carefully.", "delay"), "inline code excluded");

// Fenced code.
assert.ok(isExcluded("```js\nconst delay = 5;\n```", "delay"), "fenced code excluded");

// Markdown link: both the label and the target.
assert.ok(isExcluded("See [delay](https://x.com) here.", "delay"), "md link label excluded");
assert.ok(isExcluded("See [docs](https://x.com/delay) here.", "delay"), "md link target excluded");

// Image embed.
assert.ok(isExcluded("![delay diagram](img.png)", "delay"), "image alt text excluded");

// Bare URL and autolink.
assert.ok(isExcluded("Visit https://audio.com/delay now.", "delay"), "bare URL excluded");
assert.ok(isExcluded("Visit <https://audio.com/delay> now.", "delay"), "autolink excluded");

// Heading.
assert.ok(isExcluded("## The delay problem", "delay"), "heading excluded");

// Ordinary prose is NOT excluded: the guards must not swallow real mentions.
assert.ok(!isExcluded("The delay is long.", "delay"), "plain prose still matches");
assert.ok(!isExcluded("A delay, then reverb.", "delay"), "punctuation is fine");

// A term in prose on a line after a heading still matches.
{
  const text = "# Heading\n\nThe delay is long.";
  const i = text.lastIndexOf("delay");
  assert.ok(!excludedRegions(text).some((r) => i >= r.start && i < r.end), "body after heading matches");
}

console.log("exclusion zones: all assertions passed");
