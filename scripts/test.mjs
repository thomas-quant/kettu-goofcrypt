/**
 * Build + run the byte-compatibility harness.
 *
 * The real `stegcloak-rs` JS does `import wasmPath from "./*.wasm"` (a bundler-
 * style asset import that plain Node won't resolve), so we esbuild-bundle the
 * harness with the `.wasm` file loader, then execute the bundle under Node.
 */
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const outfile = resolve("tests/dist/harness.mjs");

await build({
    entryPoints: ["tests/harness.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node20",
    outfile,
    loader: { ".wasm": "file" },
    logLevel: "info",
});

// The harness calls process.exit() with the appropriate code.
await import(pathToFileURL(outfile).href);
