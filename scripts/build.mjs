/**
 * Build the Vendetta plugin and assemble the GitHub Pages site Kettu installs
 * from:
 *
 *   site/manifest.json   (polymanifest: name, description, authors, main, hash)
 *   site/index.js        (the bundle)
 *
 * Kettu's Vendetta loader fetches `<installUrl>manifest.json` and
 * `<installUrl><main>`, then evaluates the JS as `vendetta => { return <js> }`
 * and uses `result.default`. So the bundle must be a single EXPRESSION that
 * evaluates to `{ default: { onLoad, onUnload, settings } }`.
 *
 * We achieve that with esbuild `format:iife` + `globalName` (→ `var GoofCrypt =
 * (()=>{...})();`) wrapped by a banner/footer into
 * `(()=>{ var GoofCrypt = (()=>{...})(); return GoofCrypt })()`.
 * `vendetta` is referenced as a free global (the loader's closure arg).
 */
import { build } from "esbuild";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const SITE = "site";
await mkdir(SITE, { recursive: true });
const indexOut = resolve(SITE, "index.js");

await build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    format: "iife",
    globalName: "GoofCrypt",
    banner: { js: "(()=>{" },
    footer: { js: ";return GoofCrypt})()" },
    outfile: indexOut,
    target: ["es2017"], // Hermes-safe: lowers optional chaining / nullish / spread
    platform: "browser",
    legalComments: "none",
    minify: false,
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    logLevel: "info",
});

const js = await readFile(indexOut, "utf8");
// Content hash drives Kettu's update detection (re-fetch only when JS changes).
const hash = createHash("sha256").update(js).digest("hex").slice(0, 16);

const manifest = {
    name: "GoofCrypt",
    description: "GoofCord-compatible message encryption (StegCloak interop) for Discord mobile.",
    authors: [{ name: "zach" }],
    main: "index.js",
    hash,
    vendetta: { icon: "ic_lock_24px" },
};
await writeFile(resolve(SITE, "manifest.json"), JSON.stringify(manifest, null, 2));

console.log(`Built GoofCrypt (hash ${hash}) -> ${indexOut}`);
