/**
 * Check that the debug report's domain-file diagnostics separate the competing
 * explanations for a duplicated picker row:
 *   1. two files genuinely sharing one name
 *   2. two names that render identically but are different strings
 *      (trailing space, NBSP, NFD vs NFC, case)
 * Mirrors the grouping + escaping in buildDebugReport (which needs an App).
 *
 * Run: npx tsx src/services/debug-report.test.ts
 */
import * as assert from "assert";

function escapeName(name: string): string {
  const esc = (cp: number) => `\\u${cp.toString(16).padStart(4, "0")}`;
  return [...name]
    .map((ch) => {
      const cp = ch.codePointAt(0)!;
      if (cp < 0x20 || cp === 0x7f) return esc(cp);
      if (ch !== " " && /\s/.test(ch)) return esc(cp);
      if ((cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || cp === 0xfeff) return esc(cp);
      if (/\p{Mn}/u.test(ch)) return esc(cp);
      return ch;
    })
    .join("")
    .replace(/^ | $/g, "\u2423");
}

function diagnose(basenames: string[], prefix: string) {
  const byName = new Map<string, number>();
  for (const b of basenames) {
    if (!b.startsWith(prefix)) continue;
    const name = b.slice(prefix.length);
    byName.set(name, (byName.get(name) ?? 0) + 1);
  }
  const sharedName = [...byName.entries()].filter(([, n]) => n > 1).map(([k]) => k);

  const byLoose = new Map<string, string[]>();
  for (const name of byName.keys()) {
    const loose = name.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
    const g = byLoose.get(loose);
    if (g) g.push(name);
    else byLoose.set(loose, [name]);
  }
  const lookalike = [...byLoose.values()].filter((v) => v.length > 1);
  return { sharedName, lookalike };
}

const P = "≈"; // ≈

// Theory 1: two real files, same name. One row, flagged as a shared name.
{
  const r = diagnose([`${P}AI`, `${P}AI`, `${P}biology`], P);
  assert.deepStrictEqual(r.sharedName, ["AI"]);
  assert.strictEqual(r.lookalike.length, 0, "same name is not a lookalike case");
}

// Theory 2a: trailing space. Two distinct names that render alike.
{
  const r = diagnose([`${P}AI`, `${P}AI `, `${P}biology`], P);
  assert.deepStrictEqual(r.sharedName, [], "distinct strings do not share a name");
  assert.strictEqual(r.lookalike.length, 1);
  assert.deepStrictEqual(r.lookalike[0].sort(), ["AI", "AI "].sort());
}

// Theory 2b: NFD vs NFC. "café" decomposed vs composed.
{
  const nfc = "café";
  const nfd = "café";
  assert.notStrictEqual(nfc, nfd, "precondition: the two forms differ as strings");
  const r = diagnose([P + nfc, P + nfd], P);
  assert.strictEqual(r.lookalike.length, 1, "NFC/NFD pair flagged as lookalike");
}

// Theory 2c: non-breaking space vs normal space.
{
  const r = diagnose([`${P}computer science`, `${P}computer science`], P);
  assert.strictEqual(r.lookalike.length, 1, "NBSP variant flagged");
}

// Clean vault: neither problem reported.
{
  const r = diagnose([`${P}AI`, `${P}biology`, `${P}law`], P);
  assert.deepStrictEqual(r.sharedName, []);
  assert.strictEqual(r.lookalike.length, 0);
}

// Escaping makes the invisible visible in a pasted report.
assert.strictEqual(escapeName("AI "), "AI␣", "trailing space marked");
assert.strictEqual(escapeName("computer science"), "computer\\u00a0science", "NBSP escaped");
assert.strictEqual(escapeName("café"), "cafe\\u0301", "combining accent escaped");
assert.strictEqual(escapeName("AI"), "AI", "plain ASCII untouched");
// Visible non-ASCII is content, not a hidden difference: escaping it turned
// "\u00a9Gesang der J\u00fcnglinge" into unreadable noise in a real report.
assert.strictEqual(escapeName("\u00a9Orph\u00e9e"), "\u00a9Orph\u00e9e", "prefix and precomposed accent stay readable");
assert.strictEqual(escapeName("\u2248AI"), "\u2248AI", "domain prefix stays readable");
assert.strictEqual(escapeName("Gesang der J\u00fcnglinge"), "Gesang der J\u00fcnglinge", "umlaut stays readable");
// Zero-width characters are invisible, so they must still be surfaced.
assert.strictEqual(escapeName("A\u200bI"), "A\\u200bI", "zero-width space escaped");

console.log("debug-report domain diagnostics: all assertions passed");
