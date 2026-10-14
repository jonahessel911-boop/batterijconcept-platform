import type { NextConfig } from "next";
import packageJson from "./package.json";

const commit =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ||
  process.env.NEXT_PUBLIC_APP_COMMIT ||
  "";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: packageJson.version,
    NEXT_PUBLIC_APP_COMMIT: commit,
  },
  outputFileTracingIncludes: {
    "/api/contract/[token]": ["./assets/contracts/**/*"],
    "/api/contract/[token]/sign": ["./assets/contracts/**/*"],
    "/api/relaties/adviseur/[id]/contract/send": ["./assets/contracts/**/*"],
  },
};

export default nextConfig;
