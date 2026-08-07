/**
 * Check the taxa undo stack: each change records the state before it, and Undo
 * steps back one at a time.
 *
 * The prefix picker writes on click and the row fields save on change, so a
 * mistap is persisted with no way back. Undo is scoped to the settings tab's
 * lifetime and walks back through this sitting's edits, rather than restoring
 * one snapshot that could silently revert something deliberate.
 *
 * Run: npx tsx src/settings-undo.test.ts
 */
import * as assert from "assert";

interface Taxon { prefix: string; label: string; folder: string }

class UndoStack {
  taxa: Taxon[];
  private stack: Taxon[][] = [];

  constructor(initial: Taxon[]) {
    this.taxa = initial;
  }

  push() {
    this.stack.push(this.taxa.map((m) => ({ ...m })));
    if (this.stack.length > 50) this.stack.shift();
  }

  get depth() {
    return this.stack.length;
  }

  undo(): boolean {
    const previous = this.stack.pop();
    if (!previous) return false;
    this.taxa = previous;
    return true;
  }
}

const start = (): Taxon[] => [
  { prefix: "@", label: "People", folder: "people" },
  { prefix: "+", label: "Concepts", folder: "concept" },
];

// Nothing to undo before anything changes.
{
  const u = new UndoStack(start());
  assert.strictEqual(u.depth, 0, "button starts disabled");
  assert.strictEqual(u.undo(), false, "undo on an empty stack is a no-op");
}

// The motivating case: a mistapped prefix is one click from fixed.
{
  const u = new UndoStack(start());
  u.push();
  u.taxa[0].prefix = "≈";
  assert.strictEqual(u.taxa[0].prefix, "≈");
  u.undo();
  assert.strictEqual(u.taxa[0].prefix, "@", "prefix restored");
}

// The snapshot is a copy: mutating a row after recording must not corrupt it.
{
  const u = new UndoStack(start());
  u.push();
  u.taxa[0].label = "Humans";
  u.taxa[0].folder = "somewhere-else";
  u.undo();
  assert.strictEqual(u.taxa[0].label, "People", "label restored");
  assert.strictEqual(u.taxa[0].folder, "people", "folder restored");
}

// Several edits step back one at a time, newest first.
{
  const u = new UndoStack(start());
  u.push();
  u.taxa[0].label = "One";
  u.push();
  u.taxa[0].label = "Two";
  u.push();
  u.taxa[0].label = "Three";

  assert.strictEqual(u.depth, 3);
  u.undo();
  assert.strictEqual(u.taxa[0].label, "Two", "undoes the most recent change only");
  u.undo();
  assert.strictEqual(u.taxa[0].label, "One");
  u.undo();
  assert.strictEqual(u.taxa[0].label, "People", "back to where the session started");
  assert.strictEqual(u.depth, 0, "stack exhausted");
}

// Adding a taxon is undoable.
{
  const u = new UndoStack(start());
  u.push();
  u.taxa.push({ prefix: "", label: "", folder: "" });
  assert.strictEqual(u.taxa.length, 3);
  u.undo();
  assert.strictEqual(u.taxa.length, 2, "added row removed");
}

// Deleting a taxon is undoable, which matters most: the row is gone from the UI.
{
  const u = new UndoStack(start());
  u.push();
  u.taxa.splice(0, 1);
  assert.strictEqual(u.taxa.length, 1);
  u.undo();
  assert.deepStrictEqual(u.taxa.map((t) => t.prefix), ["@", "+"], "deleted taxon restored");
}

// Restore-defaults is one step, not many.
{
  const u = new UndoStack(start());
  u.push();
  u.taxa = [{ prefix: "@", label: "People", folder: "people" }];
  u.undo();
  assert.strictEqual(u.taxa.length, 2, "whole restore undone in one step");
}

// The stack is bounded, and trimming keeps the most recent states.
{
  const u = new UndoStack(start());
  for (let i = 0; i < 60; i++) {
    u.push();
    u.taxa[0].label = `Label ${i}`;
  }
  assert.strictEqual(u.depth, 50, "capped at 50");
  u.undo();
  assert.strictEqual(u.taxa[0].label, "Label 58", "most recent state still available");
}

console.log("taxa undo stack: all assertions passed");
