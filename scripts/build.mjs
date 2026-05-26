/**
 * Build the external Kettu (Bunny spec-3) plugin and assemble the GitHub Pages
 * site that Kettu installs from:
 *
 *   site/repo.json
 *   site/builds/<id>/manifest.json
 *   site/builds/<id>/index.js   (the IIFE)
 *
 * The loader wraps index.js as `(bunny, definePlugin) => { <iife>; return plugin?.default ?? plugin }`.
 * We emit `var plugin = { default: <instance> }` (esbuild globalName + default export),
 * referencing `bunny`/`definePlugin` as free globals (the loader's closure args).
 */
import { build } from "esbuild";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";

const ID = "uk.digigrow.goofcrypt";
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const VERSION = pkg.version;

const SITE = "site";
const buildDir = resolve(SITE, "builds", ID);
await mkdir(buildDir, { recursive: true });

const indexOut = resolve(buildDir, "index.js");

await build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    format: "iife",
    globalName: "plugin",
    outfile: indexOut,
    // Conservative target so output runs on Hermes (RN 0.78): esbuild lowers
    // optional chaining / nullish / spread etc. away.
    target: ["es2017"],
    platform: "browser",
    legalComments: "none",
    minify: false,
    // Classic JSX: factory resolves to the file-local `React` (Settings.tsx /
    // index.ts both bind `React` from a Metro lookup).
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    logLevel: "info",
});

const manifest = {
    id: ID,
    version: VERSION,
    type: "plugin",
    spec: 3,
    main: "index.js",
    display: {
        name: "GoofCrypt",
        description: "GoofCord-compatible message encryption (StegCloak interop) for Discord mobile.",
        authors: [{ name: "zach" }],
    },
};
await writeFile(resolve(buildDir, "manifest.json"), JSON.stringify(manifest, null, 2));

const repo = {
    $meta: { name: "GoofCrypt", description: "GoofCord-compatible message encryption for Kettu" },
    [ID]: { version: VERSION, alwaysFetch: true },
};
await writeFile(resolve(SITE, "repo.json"), JSON.stringify(repo, null, 2));

console.log(`Built ${ID}@${VERSION} -> ${dirname(indexOut)}`);
