/**
 * Isolated QA database — a brand new, empty PGlite, on its own port and its own
 * data directory. Nothing here has ever touched the owner's development data.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const DATA_DIR = resolve(process.cwd(), "qa-audit/.pglite-qa");
const PORT = Number(process.env.QA_DB_PORT ?? 5434);
const RESET = process.env.QA_DB_RESET === "1";

async function main() {
  if (RESET && existsSync(DATA_DIR)) rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  const pidFile = resolve(DATA_DIR, "postmaster.pid");
  if (existsSync(pidFile)) rmSync(pidFile);

  const db = new PGlite(DATA_DIR);
  await db.waitReady;
  const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1", maxConnections: 10 });
  await server.start();
  console.log(`[qa-db] listening on postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`);
  console.log(`[qa-db] data directory: ${DATA_DIR}`);

  const shutdown = async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[qa-db] failed", error);
  process.exit(1);
});
