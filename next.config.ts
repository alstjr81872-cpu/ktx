import type { NextConfig } from "next";

const config: NextConfig = {
  // Python is installed separately. Never trace the virtualenv or runtime identity
  // into a Next.js deployment bundle.
  outputFileTracingExcludes: { "/*": ["./.venv/**/*", "./.local/**/*"] },
  outputFileTracingIncludes: {
    "/api/monitor*": ["./scripts/korail-worker.py"],
  },
};
export default config;
