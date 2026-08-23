import esbuild from "esbuild";
import process from "process";

const prod = process.argv[2] === "production";

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
  ],
  format: "cjs",
  target: "es2018",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
});

/**
 * Copy the built plugin into a vault, if FOLIATE_VAULT names one.
 *
 * The vault copy is a real directory, not a symlink, so a build alone left it
 * untouched: a fix could be committed, tested and green while the plugin
 * actually running was days old. That is invisible from inside Obsidian, which
 * is the worst property a staleness bug can have.
 *
 * Opt-in by env var rather than a hardcoded path, so a clone on another machine
 * builds without needing this vault to exist.
 */
async function deploy() {
  const vault = process.env.FOLIATE_VAULT;
  if (!vault) return;
  const dest = `${vault}/.obsidian/plugins/obsidian-foliate`;
  const { copyFile, mkdir } = await import("node:fs/promises");
  await mkdir(dest, { recursive: true });
  // data.json is the user's settings and index state: never copied over.
  for (const f of ["main.js", "styles.css", "manifest.json"]) {
    await copyFile(f, `${dest}/${f}`);
  }
  console.log(`deployed to ${dest}`);
}

if (prod) {
  await context.rebuild();
  await deploy();
  process.exit(0);
} else {
  // Deploy on every rebuild in watch mode too, so the running plugin is never
  // older than the last save.
  await context.watch();
  await deploy();
}
