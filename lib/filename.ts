import path from "path"
import { promises as fs } from "fs"

let resolvedUploadsDir: string | null = null

export function sanitizeFilename(name: string): string {
  // remove path segments and unsafe chars, keep simple letters, numbers, dashes, underscores, dots
  const base = name.split("/").pop()!.split("\\").pop()!
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_")
  // prevent hidden files and empty names
  const finalName = cleaned.replace(/^_+/, "").trim() || "file"
  return finalName
}

export function getUploadsDir() {
  // Prefer explicit env; fallback to resolved value or /tmp/uploads
  if (resolvedUploadsDir) return resolvedUploadsDir
  return process.env.UPLOADS_DIR || path.join("/tmp", "uploads")
}

export async function ensureUploadsDir() {
  // Try env -> /tmp/uploads -> ./uploads
  const candidates = [
    process.env.UPLOADS_DIR?.trim(),
    path.join("/tmp", "uploads"),
    path.join(process.cwd(), "uploads"),
  ].filter(Boolean) as string[]

  for (const dir of candidates) {
    try {
      await fs.mkdir(dir, { recursive: true })
      resolvedUploadsDir = dir
      return
    } catch {
      // try next
    }
  }

  // final fallback: last candidate
  resolvedUploadsDir = candidates[candidates.length - 1]
}

export function getSafeFilePath(filename: string) {
  const safe = sanitizeFilename(filename)
  return path.join(getUploadsDir(), safe)
}

export function toPublicUrl(filename: string) {
  // Serve via API so storage location is abstracted and links are stable for Excel usage.
  const safe = sanitizeFilename(filename)
  return `/api/images/file/${safe}`
}
