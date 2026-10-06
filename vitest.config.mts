import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const path = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      // Mirrors tsconfig "paths": "@/*" -> "./src/*".
      { find: /^@\//, replacement: `${path("./src")}/` },
      // "server-only" throws outside a React Server Components bundle; server modules are plain Node here.
      { find: /^server-only$/, replacement: path("./tests/stubs/server-only.ts") },
    ],
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
