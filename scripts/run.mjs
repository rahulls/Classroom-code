// Starts Next.js / Prisma Studio on the configured non-standard port, bound to 127.0.0.1.
// Fails fast if the port is taken and never falls back to another port.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) {
    console.error("Missing .env. Run `npm run setup` first.");
    process.exit(1);
  }
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    // NODE_ENV is set by Next.js itself (dev → development, build/start → production)
    if (m && m[1] !== "NODE_ENV" && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

function assertPortFree(port) {
  return new Promise((resolve) => {
    const probe = net.connect({ host: "127.0.0.1", port }, () => {
      probe.destroy();
      fail();
    });
    probe.on("error", () => {
      const srv = net.createServer();
      srv.once("error", fail);
      srv.listen(port, "127.0.0.1", () => srv.close(resolve));
    });
    function fail() {
      console.error(`Port ${port} is already in use. Free it or change the port in .env; no fallback port is used.`);
      process.exit(1);
    }
  });
}

loadEnv();
const mode = process.argv[2];
const commands = {
  dev: { port: process.env.WEB_PORT, bin: require.resolve("next/dist/bin/next"), args: (p) => ["dev", "--turbopack", "-H", "127.0.0.1", "-p", p] },
  start: { port: process.env.WEB_PORT, bin: require.resolve("next/dist/bin/next"), args: (p) => ["start", "-H", "127.0.0.1", "-p", p] },
  studio: { port: process.env.STUDIO_PORT, bin: path.join(root, "node_modules/prisma/build/index.js"), args: (p) => ["studio", "--port", p, "--browser", "none"] },
};
const cmd = commands[mode];
if (!cmd || !cmd.port) {
  console.error(`Unknown mode "${mode}" or port not set in .env`);
  process.exit(1);
}

await assertPortFree(Number(cmd.port));
console.log(`→ ${mode} on http://localhost:${cmd.port}`);
const child = spawn(process.execPath, [cmd.bin, ...cmd.args(cmd.port)], { stdio: "inherit", cwd: root, env: process.env });
child.on("exit", (code) => process.exit(code ?? 0));
