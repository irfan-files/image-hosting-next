#!/usr/bin/env node
/**
 * One runner for backend + Next.js (dev/start)
 * Fitur:
 * - Default URL backend ke domain (bukan localhost)
 * - Graceful shutdown: Ctrl+C mematikan keduanya
 * - Jika salah satu proses exit, yang lain ikut di-kill
 *
 * Pakai:
 *   node scripts/one-run.js dev --turbopack
 *   node scripts/one-run.js start
 *
 * ENV yang bisa di-override:
 *   NEXT_PUBLIC_BACKEND_URL, PUBLIC_BASE_URL, PORT (backend), NEXT_PORT (Next.js),
 *   UPLOADS_DIR, DATA_DIR
 */

const { spawn } = require("child_process");
const path = require("path");
const os = require("os");

const args = process.argv.slice(2);
const mode = (args[0] || "dev").toLowerCase(); // dev | start
const extraArgs = args.slice(1);

// ===== Path dasar project
const repoRoot = path.resolve(__dirname, "..");

// ===== Default ENV (bisa dioverride lewat ENV saat run)
const backendPort = process.env.PORT || "4000";
const nextPort = process.env.NEXT_PORT || "3001";

// WARNING: agar FE tidak balik ke localhost, default-kan ke domain.
// (Kalau mau path relatif saat dev, set NEXT_PUBLIC_BACKEND_URL="" sebelum menjalankan.)
const DEFAULT_DOMAIN = "https://uploadimage.xyz";

const baseEnv = {
  ...process.env,
  // FE → domain (bisa override)
  NEXT_PUBLIC_BACKEND_URL:
    process.env.NEXT_PUBLIC_BACKEND_URL ?? DEFAULT_DOMAIN,
  // BE → gunakan domain untuk membangun URL file absolut
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || DEFAULT_DOMAIN,
  // Lokasi penyimpanan (default: folder di dalam project — sesuai setup kamu sekarang)
  UPLOADS_DIR:
    process.env.UPLOADS_DIR ||
    path.join(repoRoot, "uploads"),
  DATA_DIR:
    process.env.DATA_DIR ||
    path.join(repoRoot, "data"),
  // Port
  PORT: backendPort,
};

// ===== Util: spawn & kill tree
function startChild(label, cmd, cmdArgs, env) {
  const isWin = process.platform === "win32";
  const child = spawn(cmd, cmdArgs, {
    cwd: repoRoot,
    stdio: "inherit",
    env,
    detached: !isWin, // supaya bisa kill group di POSIX
    shell: false,
  });
  child._label = label;
  child.on("exit", (code, signal) => {
    console.log(`[${label}] exited with code=${code} signal=${signal}`);
  });
  return child;
}

function killTree(child, signal = "SIGTERM") {
  if (!child || child.killed) return;
  const pid = child.pid;
  if (!pid) return;
  const isWin = process.platform === "win32";
  try {
    if (isWin) {
      // Kill tree pada Windows
      spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
      });
    } else {
      // Kill the whole group
      try {
        process.kill(-pid, signal);
      } catch {
        process.kill(pid, signal);
      }
    }
  } catch {}
}

// ===== Cetak info ENV penting
function printBanner() {
  console.log(
    `[v0] PUBLIC_BASE_URL: ${baseEnv.PUBLIC_BASE_URL}\n` +
      `[v0] NEXT_PUBLIC_BACKEND_URL: ${baseEnv.NEXT_PUBLIC_BACKEND_URL}\n` +
      `[v0] UPLOADS_DIR: ${baseEnv.UPLOADS_DIR}\n` +
      `[v0] DATA_DIR: ${baseEnv.DATA_DIR}\n` +
      `[v0] Ports: backend=${backendPort}, next=${nextPort}\n`
  );
  if (baseEnv.NEXT_PUBLIC_BACKEND_URL === "") {
    console.log(
      "[warn] NEXT_PUBLIC_BACKEND_URL kosong → FE akan fetch path relatif. Pastikan ada reverse proxy (Nginx) yang meneruskan /images, /upload, dll ke backend."
    );
  }
}

printBanner();

// ===== Start backend
console.log("[v0] starting backend: node scripts/server.js");
const backend = startChild("backend", process.execPath, [
  path.join("scripts", "server.js"),
], baseEnv);

// ===== Start Next.js (dev|start)
let nextCmd = "";
let nextArgs = [];
if (mode === "start") {
  nextCmd = os.platform() === "win32" ? "npx.cmd" : "npx";
  nextArgs = ["next", "start", "-p", nextPort, ...extraArgs];
  console.log(`[v0] starting next: next start -p ${nextPort} ${extraArgs.join(" ")}`);
} else {
  nextCmd = os.platform() === "win32" ? "npx.cmd" : "npx";
  // gunakan dev; forward argumen seperti --turbopack kalau ada
  nextArgs = ["next", "dev", "-p", nextPort, ...extraArgs];
  console.log(`[v0] starting next: next dev -p ${nextPort} ${extraArgs.join(" ")}`);
}
const nextProc = startChild("next", nextCmd, nextArgs, baseEnv);

// ===== Graceful shutdown & fail-fast
let shuttingDown = false;
function shutdown(status = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[v0] shutting down...");
  killTree(nextProc, "SIGTERM");
  killTree(backend, "SIGTERM");
  // tunggu sebentar, lalu paksa jika masih hidup
  setTimeout(() => {
    killTree(nextProc, "SIGKILL");
    killTree(backend, "SIGKILL");
    process.exit(status);
  }, 1500);
}

process.on("SIGINT", () => {
  console.log("\n[v0] SIGINT (Ctrl+C) received");
  shutdown(0);
});
process.on("SIGTERM", () => {
  console.log("\n[v0] SIGTERM received");
  shutdown(0);
});

// Jika salah satu proses mati terlebih dulu, matikan yang lain
function wireExit(child) {
  child.on("close", (code) => {
    if (!shuttingDown) {
      console.log(`[v0] ${child._label} closed (code=${code}). Stopping others...`);
      shutdown(code || 0);
    }
  });
}
wireExit(backend);
wireExit(nextProc);
