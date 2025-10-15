const { spawn } = require("node:child_process")

const NEXT_PORT = Number(process.env.PORT || 3000)
const API_PORT = Number(process.env.API_PORT || 4000)
const isProd = process.env.NODE_ENV === "production"

function runNext() {
  const args = isProd ? ["start", "-p", String(NEXT_PORT)] : ["dev", "-p", String(NEXT_PORT)]
  const child = spawn("npx", ["next", ...args], {
    stdio: "inherit",
    env: { ...process.env, PORT: String(NEXT_PORT) },
  })
  child.on("exit", (code) => {
    console.log("[v0] Next process exited:", code)
    process.exit(code ?? 0)
  })
  return child
}

function runBackend() {
  const child = spawn("node", ["scripts/server.js"], {
    stdio: "inherit",
    env: { ...process.env, PORT: String(API_PORT) },
  })
  child.on("exit", (code) => {
    console.log("[v0] Backend process exited:", code)
    process.exit(code ?? 0)
  })
  return child
}

function main() {
  console.log(`[v0] Starting backend http://localhost:${API_PORT} and frontend http://localhost:${NEXT_PORT}`)
  const nextProc = runNext()

  setTimeout(() => {
    runBackend()
  }, 300)

  const shutdown = (signal) => {
    console.log(`[v0] Received ${signal}, shutting down...`)
    try {
      nextProc.kill("SIGTERM")
    } catch {}
    process.exit(0)
  }
  process.on("SIGINT", shutdown)
  process.on("SIGTERM", shutdown)
}

main()
