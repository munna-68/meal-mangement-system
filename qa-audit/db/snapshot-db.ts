/**
 * QA snapshot database.
 *
 * Opens a *copy* of the development database (never the original) on a
 * different port, purely so the audit can read the data the owner is looking
 * at without touching it.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const DATA_DIR =
  process.env.QA_SNAPSHOT_DIR ??
  "/var/folders/3l/3yn5rpfs3yz5_s4krq06zy000000gn/T/opencode/pglite-snapshot";
const PORT = Number(process.env.QA_SNAPSHOT_PORT ?? 5433);

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });
  const pidFile = resolve(DATA_DIR, "postmaster.pid");
  if (existsSync(pidFile)) rmSync(pidFile);

  const db = new PGlite(DATA_DIR);
  await db.waitReady;
  const server = new PGLiteSocketServer({ db, port: PORT, host: "127.0.0.1", maxConnections: 6 });
  await server.start();
  console.log(`[qa-snapshot] listening on postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`);

  const shutdown = async () => {
    await server.stop();
    await db.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[qa-snapshot] failed", error);
  process.exit(1);
});
