import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingIncludes: {
    "/api/contract/[token]": ["./assets/contracts/**/*"],
    "/api/contract/[token]/sign": ["./assets/contracts/**/*"],
    "/api/relaties/adviseur/[id]/contract/send": ["./assets/contracts/**/*"],
  },
};

export default nextConfig;
