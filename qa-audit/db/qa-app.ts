/**
 * Starts the ISOLATED copy of the app against the isolated QA database.
 *
 * The repository copy lives outside the working tree; the original repo, its
 * .pglite directory and its running dev server are untouched.
 */
import { spawn, type SpawnOptions } from "node:child_process";
import { resolve } from "node:path";

const APP_DIR =
  process.env.QA_APP_DIR ??
  "/var/folders/3l/3yn5rpfs3yz5_s4krq06zy000000gn/T/opencode/appcopy";
const PORT = process.env.QA_APP_PORT ?? "3001";
const REPO = process.cwd();

const env: NodeJS.ProcessEnv = {
  ...process.env,
  DATABASE_URL: process.env.QA_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:5434/postgres",
  SESSION_SECRET: "qa-isolated-audit-session-secret-0123456789abcdef",
  ADMIN_PIN: "",
  NODE_ENV: "development",
};

const args = [
  "next",
  "dev",
  "--port",
  PORT,
  "--hostname",
  "127.0.0.1",
  ...(process.env.QA_APP_WEBPACK === "1" ? ["--webpack"] : []),
];
const child = spawn("npx", args, {
  cwd: APP_DIR,
  env,
  stdio: ["ignore", "pipe", "pipe"],
} as SpawnOptions);

child.stdout?.on("data", (d: Buffer) => process.stdout.write(`[app] ${d.toString()}`));
child.stderr?.on("data", (d: Buffer) => process.stderr.write(`[app] ${d.toString()}`));
child.on("exit", (code: number | null) => {
  console.log(`[app] exited ${code}`);
  process.exit(code ?? 0);
});
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
void resolve;
void REPO;
