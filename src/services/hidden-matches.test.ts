/**
 * Check the gate's suppression reporting: a term withheld by context gating is
 * recorded (so Hidden connections can show it), a term that surfaces is not, and
 * a file can do both at once.
 *
 * Mirrors the gate branch in findFileMatchPositions, which needs an App.
 *
 * Run: npx tsx src/services/hidden-matches.test.ts
 */
import * as assert from "assert";

/** The gate decision + suppression recording, extracted from the matcher. */
function scanFile(
  noteText: string,
  terms: string[],
  gate: { terms: string[]; gatedAliases: string[] } | undefined,
  collectHidden: boolean
) {
  const occurrences = (t: string) =>
    (noteText.toLowerCase().match(new RegExp(`\\b${t.toLowerCase()}\\b`, "g")) ?? []).length;

  const gatedSet = gate ? new Set(gate.gatedAliases.map((t) => t.toLowerCase())) : null;
  const isGated = (t: string) => gatedSet !== null && gatedSet.has(t.toLowerCase());
  const noteHasContext = () => (gate?.terms ?? []).some((t) => occurrences(t) > 0);

  const surfaced: string[] = [];
  const suppressed = collectHidden && gate ? { terms: [] as string[], occurrences: 0 } : undefined;

  for (const term of terms) {
    if (term.length < 2) continue;
    if (isGated(term) && !noteHasContext()) {
      if (suppressed) {
        const hits = occurrences(term);
        if (hits > 0) {
          suppressed.terms.push(term);
          suppressed.occurrences += hits;
        }
      }
      continue;
    }
    if (occurrences(term) > 0) surfaced.push(term);
  }
  return { surfaced, suppressed };
}

const GATE = { terms: ["reverb", "feedback"], gatedAliases: ["delay"] };

// Off-topic note: the gated term is withheld AND recorded with its count.
{
  const r = scanFile("Sorry for the delay, the delay was unavoidable.", ["delay"], GATE, true);
  assert.deepStrictEqual(r.surfaced, [], "gated term does not surface without context");
  assert.deepStrictEqual(r.suppressed?.terms, ["delay"], "suppression recorded");
  assert.strictEqual(r.suppressed?.occurrences, 2, "both occurrences counted");
}

// On-topic note: context present, so the term surfaces and nothing is recorded.
{
  const r = scanFile("The delay feeds the reverb tail.", ["delay"], GATE, true);
  assert.deepStrictEqual(r.surfaced, ["delay"], "context present, term surfaces");
  assert.strictEqual(r.suppressed?.terms.length, 0, "nothing suppressed");
}

// A file can surface one term while another is withheld.
{
  const r = scanFile("Discussing delay compensation in the plugin.", ["delay", "compensation"], GATE, true);
  assert.deepStrictEqual(r.surfaced, ["compensation"], "ungated term still surfaces");
  assert.deepStrictEqual(r.suppressed?.terms, ["delay"], "gated term still recorded");
}

// A gated term that does not appear in the note is not reported as hidden:
// Hidden connections lists withheld MATCHES, not every gated term in the vault.
{
  const r = scanFile("A note about mixing consoles.", ["delay"], GATE, true);
  assert.strictEqual(r.suppressed?.terms.length, 0, "absent term is not a hidden match");
}

// Ungated file: no collection allocated, so ungated files cost nothing.
{
  const r = scanFile("Sorry for the delay.", ["delay"], undefined, true);
  assert.deepStrictEqual(r.surfaced, ["delay"]);
  assert.strictEqual(r.suppressed, undefined, "no suppression object for an ungated file");
}

// Section off: nothing collected even for a gated file.
{
  const r = scanFile("Sorry for the delay.", ["delay"], GATE, false);
  assert.strictEqual(r.suppressed, undefined, "collection skipped when the section is off");
}

console.log("hidden-match suppression reporting: all assertions passed");
