/**
 * Local development database.
 *
 * Runs an embedded Postgres (PGlite) and exposes it over the normal Postgres
 * wire protocol, so the app talks to it with the ordinary `pg` driver and the
 * exact same code path it uses against Neon in production.
 *
 *   npm run db:dev
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const DATA_DIR = resolve(process.cwd(), ".pglite");
const PORT = Number(process.env.PGLITE_PORT ?? 5432);
const HOST = "127.0.0.1";

async function main() {
  mkdirSync(DATA_DIR, { recursive: true });

  // Remove a stale postmaster.pid left behind by a previous crash or forced
  // kill.  PGlite treats its presence as a running-instance lock and aborts
  // with "RuntimeError: Aborted()" — but in this single-process dev setup
  // there is never a real concurrent instance, so it is always safe to delete.
  const pidFile = resolve(DATA_DIR, "postmaster.pid");
  if (existsSync(pidFile)) {
    console.warn("[dev-db] Removing stale postmaster.pid from a previous unclean shutdown.");
    rmSync(pidFile);
  }

  const db = new PGlite(DATA_DIR);
  await db.waitReady;

  const server = new PGLiteSocketServer({
    db,
    port: PORT,
    host: HOST,
    maxConnections: 10,
  });

  await server.start();

  console.log(
    `[dev-db] Postgres listening on postgresql://postgres:postgres@${HOST}:${PORT}/postgres`,
  );
  console.log(`[dev-db] data directory: ${DATA_DIR}`);

  const shutdown = async () => {
    console.log("\n[dev-db] shutting down");
    await server.stop();
    await db.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  console.error("[dev-db] failed to start", error);
  process.exit(1);
});
