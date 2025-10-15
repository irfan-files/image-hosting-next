const { spawn } = require("child_process")


const MODE = process.argv[2] || (process.env.NODE_ENV === "production" ? "start" : "dev")
const NEXT_PORT = "3001"
const BACKEND_CMD = "node"
const BACKEND_ARGS = ["scripts/server.js"]
const NEXT_BIN = "next" // uses local node_modules/.bin/next

const baseEnv = {
  ...process.env,
  // ensure frontend points to backend on 4000 by default
  NEXT_PUBLIC_BACKEND_URL: process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:4000",
}

function run(name, cmd, args, opts = {}) {
  console.log(`[v0] starting ${name}: ${cmd} ${args.join(" ")}`)
  const child = spawn(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...baseEnv, ...(opts.env || {}) },
    ...opts,
  })
  child.on("error", (err) => {
    console.error(`[v0] ${name} failed to start:`, err?.message)
  })
  child.on("exit", (code, signal) => {
    console.log(`[v0] ${name} exited code=${code} signal=${signal}`)
    // if one exits, shut down the other to avoid orphans
    process.exit(code ?? 0)
  })
  return child
}

let backendProc, nextProc

function start() {
  // Backend (Express/json-server) — expected to listen on 4000
  backendProc = run("backend", BACKEND_CMD, BACKEND_ARGS)

  if (MODE === "start") {
    const build = run("next-build", NEXT_BIN, ["build"], { env: { ...baseEnv, NODE_ENV: "production" } })
    build.on("exit", (code) => {
      if (code !== 0) {
        console.error("[v0] next build failed")
        process.exit(code ?? 1)
      }
      const nextArgs = ["start", "-p", NEXT_PORT]
      nextProc = run("next", NEXT_BIN, nextArgs, { env: { ...baseEnv, NODE_ENV: "production" } })
    })
  } else {
    // Next on port 3001 in dev mode
    const nextArgs = ["dev", "-p", NEXT_PORT]
    nextProc = run("next", NEXT_BIN, nextArgs, { env: baseEnv })
  }
}

function shutdown() {
  console.log("[v0] shutting down...")
  try {
    if (nextProc && !nextProc.killed) nextProc.kill("SIGINT")
  } catch {}
  try {
    if (backendProc && !backendProc.killed) backendProc.kill("SIGINT")
  } catch {}
  setTimeout(() => process.exit(0), 500).unref()
}

process.on("SIGINT", shutdown)
process.on("SIGTERM", shutdown)
process.on("uncaughtException", (e) => {
  console.error("[v0] uncaughtException:", e)
  shutdown()
})
process.on("unhandledRejection", (e) => {
  console.error("[v0] unhandledRejection:", e)
  shutdown()
})

start()
