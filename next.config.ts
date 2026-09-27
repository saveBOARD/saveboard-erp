import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (local dev database) ships WASM files that must not be bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Room for Excel uploads (Settings > Import customers); Katana exports are well under this.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
};

export default nextConfig;
