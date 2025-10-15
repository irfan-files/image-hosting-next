import { mkdir } from "fs/promises"

export const uploadsDir =
  process.env.UPLOADS_DIR && process.env.UPLOADS_DIR.trim().length > 0 ? process.env.UPLOADS_DIR : "/tmp/uploads"

export const dataDir =
  process.env.DATA_DIR && process.env.DATA_DIR.trim().length > 0 ? process.env.DATA_DIR : "/tmp/data"

let initialized = false
export async function ensureDirs() {
  if (initialized) return
  await mkdir(uploadsDir, { recursive: true })
  await mkdir(dataDir, { recursive: true })
  initialized = true
}
