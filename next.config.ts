import type { NextConfig } from "next";

// Recorded featured runs (data/featured, not committed) ship with the routes that read them, so the demo
// plans and replays never depend on the store being up.
const FEATURED = ["./data/featured/**/*"];

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/": FEATURED,
    "/plan/\\[id\\]": FEATURED,
    "/api/featured": FEATURED,
    "/api/plans/\\[id\\]": FEATURED,
    "/api/runs/\\[id\\]": FEATURED,
    "/api/revise": FEATURED,
  },
};

export default nextConfig;
