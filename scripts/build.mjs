/**
 * Build the Vendetta plugin and assemble the GitHub Pages site Kettu installs
 * from (site/manifest.json + site/index.js).
 *
 * Kettu evaluates the JS as `vendetta => { return <js> }` and uses
 * `result.default`, so the bundle must be a single EXPRESSION evaluating to
 * `{ default: { onLoad, onUnload, settings } }`, with `vendetta` referenced as
 * a free global.
 *
 * IMPORTANT: Discord's Hermes `eval` parser rejects `class` syntax (verified
 * on-device: SyntaxError "Invalid expression" at `var X = class`). esbuild
 * cannot down-level classes, so we post-process the bundle through swc (es5),
 * which transpiles `class` → functions, then wrap it into the expression form.
 */
import { build } from "esbuild";
import { transform } from "@swc/core";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

const SITE = "site";
await mkdir(SITE, { recursive: true });
const indexOut = resolve(SITE, "index.js");

// noble's argon2idAsync yields via a *microtask* (`nextTick = async () => {}`),
// which never lets React Native render — so derivation freezes the UI. Patch it
// to a real macrotask (setTimeout) so the UI stays responsive during the
// (unavoidably ~slow) 64 MiB derivation.
const nobleMacrotaskYield = {
    name: "noble-macrotask-yield",
    setup(b) {
        b.onLoad({ filter: /@noble[\\/]hashes[\\/](esm[\\/])?utils\.js$/ }, async (args) => {
            const src = await readFile(args.path, "utf8");
            const patched = src.replace(
                /export const nextTick = async \(\) => \{ \};/,
                "export const nextTick = () => new Promise((r) => setTimeout(r, 0));",
            );
            if (patched === src) throw new Error("failed to patch noble nextTick at " + args.path);
            return { contents: patched, loader: "js" };
        });
    },
};

// 1. Bundle everything into `var GoofCrypt = (() => { ... })();` (kept in memory).
const result = await build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    format: "iife",
    globalName: "GoofCrypt",
    write: false,
    outfile: indexOut,
    target: ["es2017"],
    platform: "browser",
    legalComments: "none",
    jsx: "transform",
    jsxFactory: "React.createElement",
    jsxFragment: "React.Fragment",
    plugins: [nobleMacrotaskYield],
    logLevel: "info",
});
const bundled = result.outputFiles[0].text;

// 2. Down-level to ES5 so the bundle contains no `class` syntax (Hermes eval).
const { code: lowered } = await transform(bundled, {
    isModule: false,
    minify: false,
    jsc: {
        target: "es5",
        parser: { syntax: "ecmascript" },
        loose: false,
        // Discord's Hermes `eval` drops the first element of swc's es5
        // `for...of` iterator-protocol lowering. This assumption makes swc emit
        // plain index-based loops instead (verified: 53 iterator loops -> 0),
        // bundle-wide. Safe: we only ever iterate arrays/strings.
        assumptions: { iterableIsArray: true },
    },
});

// Discord's Hermes eval parser rejects class & generator syntax. Verify swc's
// es5 output has none (match real syntax, not the word inside helper strings).
if (/\bclass\s*[A-Za-z0-9_$]*\s*(\{|extends\b)/.test(lowered)) {
    throw new Error("class syntax survived swc lowering — Hermes eval would reject it");
}
if (/function\s*\*/.test(lowered) || /\byield\b/.test(lowered)) {
    throw new Error("generator syntax survived swc lowering — Hermes eval would reject it");
}
// The swc es5 for...of iterator-protocol lowering drops the first element under
// Discord's Hermes. iterableIsArray should have eliminated it; fail if it returns.
if (/_iteratorNormalCompletion/.test(lowered)) {
    throw new Error("iterator-protocol for...of lowering present — Hermes drops the first element; check swc iterableIsArray");
}

// 3. Wrap into ONE expression returning the namespace (helpers + `var GoofCrypt`
//    + return all live inside the IIFE, so it stays a single expression).
const wrapped = `(function(){\n${lowered}\nreturn GoofCrypt;\n})()`;

// Gate: must parse exactly as Kettu evaluates it (`vendetta => { return <js> }`).
try {
    new Function("vendetta", "return " + wrapped);
} catch (e) {
    throw new Error("built bundle is not a valid eval expression: " + e.message);
}

await writeFile(indexOut, wrapped);

const hash = createHash("sha256").update(wrapped).digest("hex").slice(0, 16);

const manifest = {
    name: "GoofCrypt",
    description: "GoofCord-compatible message encryption (StegCloak interop) for Discord mobile.",
    authors: [{ name: "zach" }],
    main: "index.js",
    hash,
    vendetta: { icon: "ic_lock_24px" },
};
await writeFile(resolve(SITE, "manifest.json"), JSON.stringify(manifest, null, 2));

console.log(`Built GoofCrypt (hash ${hash}, ${wrapped.length} bytes, class-free) -> ${indexOut}`);
