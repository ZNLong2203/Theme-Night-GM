// MapLibre v6 runs its worker as an ES module next to the main bundle. Bundlers rename chunks,
// so we serve the worker (and the shared chunk it imports) from /public and point setWorkerUrl at it.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "maplibre-gl", "dist");
const dest = join(root, "public", "maplibre");
mkdirSync(dest, { recursive: true });
for (const file of ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"]) copyFileSync(join(src, file), join(dest, file));
console.log("maplibre worker copied to public/maplibre");
