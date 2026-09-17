import { spawn } from "node:child_process";
import net from "node:net";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const children: ReturnType<typeof spawn>[] = [];

function run(command: string, args: string[]) {
  const child = spawn(npmCommand, ["run", command, ...args], {
    stdio: "inherit",
    env: process.env,
  });
  children.push(child);
  return child;
}

function isDatabaseReady() {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port: 5432 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function waitForDatabase() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await isDatabaseReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Local database did not start on 127.0.0.1:5432");
}

async function main() {
  const database = run("db:dev", []);

  database.once("exit", (code) => {
    if (code !== 0) process.exitCode = code ?? 1;
  });

  await waitForDatabase();
  const migration = run("db:migrate", []);

  await new Promise<void>((resolve, reject) => {
    migration.once("exit", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`Database migration failed with exit code ${code}`));
    });
  });

  run("dev:next", []);
}

function shutdown(signal: NodeJS.Signals) {
  for (const child of children) {
    if (!child.killed) child.kill(signal);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

main().catch((error) => {
  console.error("[dev] failed", error);
  shutdown("SIGTERM");
  process.exit(1);
});
