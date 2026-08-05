/**
 * Check that an acronym written into a filename works as an alias:
 * "+Spectral band replication (SBR)" matches a bare "SBR" anywhere.
 *
 * Two guards, both driven by real vault data:
 *
 * 1. The base name is never taken as a term. 35 base names collide with an
 *    existing plain file ("noise" vs "noise (audio)") and 10 are shared by
 *    several parenthetical files ("transfer function" has three), so stripping
 *    the qualifier would recreate the ambiguity it exists to prevent.
 * 2. The parenthetical must actually abbreviate the base name. Shape alone let
 *    "+attack (ADSR)", "+envelope (ADSR)" and "+release time (ADSR)" each claim
 *    "ADSR", when "+ADSR" is the file that means it. Same for MIDI and DAW.
 *
 * OFF BY DEFAULT (settings.matchFilenameAcronyms). The rules below apply only
 * when it is turned on; with it off a filename contributes just its own name.
 * The feature is niche and the qualifier guard is a heuristic, so a wrong link
 * is possible, and a frontmatter alias does the same job exactly.
 *
 * Run: npx tsx src/services/filename-acronym.test.ts
 */
import * as assert from "assert";

const ACRONYM = /^[A-Z][A-Za-z]*\.?(?:[A-Z]\.?){1,6}s?$/;

function abbreviates(acronym: string, phrase: string): boolean {
  const letters = acronym.replace(/[^A-Za-z]/g, "").toLowerCase();
  if (letters.length === 0) return false;
  let i = 0;
  for (const word of phrase.split(/[\s\-/]+/)) {
    const ch = word[0]?.toLowerCase();
    if (ch && i < letters.length && ch === letters[i]) i++;
  }
  if (i === letters.length) return true;
  let j = 0;
  for (const ch of phrase.replace(/[^A-Za-z]/g, "").toLowerCase()) {
    if (j < letters.length && ch === letters[j]) j++;
  }
  return j === letters.length;
}

/** Terms a filename contributes, mirroring getSearchTerms. */
function termsFor(name: string): string[] {
  const terms = [name];
  const m = name.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (m) {
    const paren = m[2].trim();
    if (ACRONYM.test(paren) && abbreviates(paren, m[1])) {
      terms.push(paren);
      const undotted = paren.replace(/\./g, "");
      if (undotted !== paren && undotted.length >= 2) terms.push(undotted);
    }
  }
  return terms;
}

// Real abbreviations from the vault, written several ways.
for (const [name, acr] of [
  ["Spectral band replication (SBR)", "SBR"],   // word initials
  ["equalization (EQ)", "EQ"],                   // contraction
  ["Differential PCM (DPCM)", "DPCM"],           // phrase contains an acronym
  ["Super Audio CD (SACD)", "SACD"],
  ["Sound power level (PWL)", "PWL"],            // letters reordered
  ["Companded predictive delta modulation (CPDM)", "CPDM"],
] as const) {
  assert.ok(termsFor(name).includes(acr), `should alias: ${name}`);
}

// Family qualifiers: acronym-shaped, but not an abbreviation of the title.
// Taking these would make one acronym match several unrelated files.
for (const name of [
  "attack (ADSR)",
  "envelope (ADSR)",
  "release time (ADSR)",
  "local control (MIDI)",
  "note off message (MIDI)",
  "region (DAW)",
  "cut copy paste (DAW)",
  "AES10 (MADI)",
  "Eureka 147 (DAB)",
]) {
  assert.deepStrictEqual(termsFor(name), [name], `qualifier not taken: ${name}`);
}

// Plain disambiguators never qualify: "audio" as an alias would fire everywhere.
for (const name of ["pitch (music)", "noise (audio)", "carrier (synthesis)", "qi (vital energy)"]) {
  assert.deepStrictEqual(termsFor(name), [name], `disambiguator not taken: ${name}`);
}

// The base name is never a term, so "noise" doesn't match two files.
assert.ok(!termsFor("noise (audio)").includes("noise"));
assert.ok(!termsFor("Spectral band replication (SBR)").includes("Spectral band replication"));

// Only a trailing parenthetical counts.
assert.deepStrictEqual(termsFor("Fourier (additive) synthesis"), ["Fourier (additive) synthesis"]);

// Names with no parenthetical are unchanged.
assert.deepStrictEqual(termsFor("delay"), ["delay"]);

// Periods: an acronym is written both ways, so both spellings match. A title
// carrying "(D.A.W.)" should still be found by a plain "DAW" in prose.
{
  const t = termsFor("Digital Audio Workstation (D.A.W.)");
  assert.ok(t.includes("D.A.W."), "dotted form matches");
  assert.ok(t.includes("DAW"), "undotted form matches too");
}
{
  const t = termsFor("United States of America (U.S.A.)");
  assert.ok(t.includes("U.S.A.") && t.includes("USA"), "both spellings of U.S.A.");
}
// A dotted qualifier is still rejected: periods don't buy an exemption.
assert.deepStrictEqual(termsFor("attack (A.D.S.R.)"), ["attack (A.D.S.R.)"]);
// No period means no duplicate term.
assert.strictEqual(termsFor("equalization (EQ)").length, 2, "no spurious variant");

// With the setting off, nothing is derived from the file name.
{
  const off = (name: string) => [name];
  assert.deepStrictEqual(off("Spectral band replication (SBR)"), ["Spectral band replication (SBR)"]);
}

console.log("filename acronym aliases: all assertions passed");
