// Runs the signaling server:  node tools/signal/src/main.ts [port] [host] [-- command args…]
// Default port 5185 on all interfaces. With a command after `--`, the server runs alongside it (the command gets
// FSO_SIGNAL_PORT in its environment) and both stop together: `pnpm battle:online` starts the lobby and the battle app.
// Environment (for hosting, see docs/netcode.md "Hosting"):
//   PORT, HOST                     listen address (the arguments win)
//   ALLOWED_ORIGINS                comma-separated page origins allowed to connect, e.g. https://fso.example.org
//   TRUST_PROXY=1                  client address from X-Forwarded-For (only behind your own reverse proxy)
//   LOBBY_TOKEN                    a shared secret every connection must carry as ?token= (unset = open lobby)
//   MAX_ROOMS, MAX_CONNECTIONS, MAX_CONNECTIONS_PER_ADDRESS
import { spawn } from "node:child_process";
import { startSignalServer, type SignalLimits } from "./server.ts";

const argv = process.argv.slice(2);
const dash = argv.indexOf("--");
const [portArg, hostArg] = dash >= 0 ? argv.slice(0, dash) : argv;
const command = dash >= 0 ? argv.slice(dash + 1) : [];
const env = process.env;

const port = Number(portArg ?? env.PORT ?? 5185);
const host = hostArg ?? env.HOST;
const limits: Partial<SignalLimits> = {};
const numeric = (name: string, key: keyof SignalLimits) => {
  const value = Number(env[name]);
  if (env[name] !== undefined && Number.isFinite(value) && value > 0) limits[key] = value;
};
numeric("MAX_ROOMS", "maxRooms");
numeric("MAX_CONNECTIONS", "maxConnections");
numeric("MAX_CONNECTIONS_PER_ADDRESS", "maxConnectionsPerAddress");
const allowedOrigins = (env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const server = await startSignalServer({
  port,
  host,
  allowedOrigins,
  trustProxy: env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true",
  token: env.LOBBY_TOKEN?.trim() || undefined,
  limits,
  log: (line) => console.log(`${new Date().toISOString()} ${line}`),
});
console.log(`lobby: ws://${host ?? "localhost"}:${server.port}`);

let child: ReturnType<typeof spawn> | null = null;
const stop = (code: number) => void server.close().then(() => process.exit(code));
if (command.length > 0) {
  child = spawn(command[0]!, command.slice(1), {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...env, FSO_SIGNAL_PORT: String(server.port) },
  });
  child.on("exit", (code, signal) => stop(code ?? (signal ? 1 : 0)));
  child.on("error", (error) => {
    console.error(`could not run ${command.join(" ")}: ${error.message}`);
    stop(1);
  });
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (child && child.exitCode === null) child.kill(signal); // its exit stops us
    else stop(0);
  });
}
