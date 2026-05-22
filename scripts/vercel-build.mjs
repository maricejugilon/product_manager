import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextCli = require.resolve("next/dist/bin/next");

if (process.env.NODE_OPTIONS) {
  console.log("Clearing NODE_OPTIONS before Next.js build.");
}

delete process.env.NODE_OPTIONS;

const env = { ...process.env };

delete env.NODE_OPTIONS;

const result = spawnSync(process.execPath, [nextCli, "build"], {
  env,
  stdio: "inherit"
});

process.exit(result.status ?? 1);
