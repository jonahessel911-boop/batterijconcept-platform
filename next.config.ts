import type { NextConfig } from "next";
import packageJson from "./package.json";

const rawSha =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA ||
  process.env.NEXT_PUBLIC_APP_COMMIT ||
  "";
const commit = rawSha.slice(0, 7);

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
    ...(commit ? { NEXT_PUBLIC_APP_COMMIT: commit } : {}),
  },
  // Voice-uploads: body limiet voor proxy (geen FormData door Next meer, wel veiligheidsmarge)
  experimental: {
    proxyClientMaxBodySize: "30mb",
    serverActions: {
      bodySizeLimit: "30mb",
    },
  },
  outputFileTracingIncludes: {
    "/api/contract/[token]": ["./assets/contracts/**/*"],
    "/api/contract/[token]/sign": ["./assets/contracts/**/*"],
    "/api/relaties/adviseur/[id]/contract/send": ["./assets/contracts/**/*"],
  },
};

export default nextConfig;
