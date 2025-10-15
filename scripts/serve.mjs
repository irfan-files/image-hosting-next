import express from "express"
import next from "next"
import multer from "multer"
import fs from "fs"
import path from "path"
import os from "os"
import { fileURLToPath } from "url"
import jsonServer from 'json-server';


// Resolve __dirname in ESM
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const dev = process.env.NODE_ENV !== "production"
const PORT = Number(process.env.PORT || 3001)

// Default writable dirs without envs
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
  return p
}
const cwd = process.cwd()
const defaultUploads = ensureDir(path.join(cwd, "uploads"))
const defaultData = ensureDir(path.join(cwd, "data"))
const UPLOADS_DIR = ensureDir(process.env.UPLOADS_DIR || (os.tmpdir ? ensureDir(path.join(os.tmpdir(), "uploads")) : defaultUploads))
const DATA_DIR = ensureDir(process.env.DATA_DIR || (os.tmpdir ? ensureDir(path.join(os.tmpdir(), "data")) : defaultData))
const DB_FILE = path.join(DATA_DIR, "db.json")

// Initialize db.json structure
function readDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify({ images: [] }, null, 2))
    }
    const raw = fs.readFileSync(DB_FILE, "utf-8")
    return JSON.parse(raw || '{"images":[]}')
  } catch (e) {
    console.error("[v0] Failed to read DB:", e)
    return { images: [] }
  }
}
function writeDB(db) {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2))
  } catch (e) {
    console.error("[v0] Failed to write DB:", e)
  }
}

// Multer storage: keep original filename, no hashing
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => cb(null, file.originalname),
})
const upload = multer({ storage })

// Utility helpers
function filenameFromInput(input) {
  // Accept full URL or plain filename
  try {
    const u = new URL(input)
    return path.basename(u.pathname)
  } catch {
    return path.basename(input)
  }
}
function safeJoinUploads(name) {
  const full = path.resolve(UPLOADS_DIR, name)
  if (!full.startsWith(path.resolve(UPLOADS_DIR))) {
    throw new Error("Invalid path")
  }
  return full
}
function buildImageUrl(req, filename) {
  // Same-origin URL for Excel and UI
  return `${req.protocol}://${req.get("host")}/files/${encodeURIComponent(filename)}`
}

// Express app
async function start() {
  const app = next({ dev })
  const handle = app.getRequestHandler()
  await app.prepare()

  const server = express()
  server.use(express.json({ limit: "25mb" }))
  server.use(express.urlencoded({ extended: true }))

  // GET list images (from DB; auto-heal by scanning uploads if empty)
  server.get("/images", async (req, res) => {
    try {
      const db = readDB()
      let list = db.images || []
      // Heal: if DB empty but files exist, import them
      const files = fs.readdirSync(UPLOADS_DIR).filter(f => !fs.statSync(path.join(UPLOADS_DIR, f)).isDirectory())
      if (list.length === 0 && files.length > 0) {
        list = files.map((f) => ({
          filename: f,
          url: buildImageUrl(req, f),
          size: fs.statSync(path.join(UPLOADS_DIR, f)).size,
          createdAt: new Date().toISOString(),
        }))
        writeDB({ images: list })
      } else {
        // Refresh URLs to current host
        list = list.map((it) => ({ ...it, url: buildImageUrl(req, it.filename) }))
      }
      res.json({ images: list })
    } catch (e) {
      console.error("[v0] /images error:", e)
      res.status(500).json({ error: "Failed to list images" })
    }
  })

  // CSV export
  server.get("/images.csv", (req, res) => {
    try {
      const db = readDB()
      const rows = (db.images || []).map((it) => ({
        filename: it.filename,
        url: buildImageUrl(req, it.filename),
        size: it.size || 0,
        createdAt: it.createdAt || "",
      }))
      const header = "filename,url,size,createdAt"
      const body = rows.map((r) => [r.filename, r.url, r.size, r.createdAt].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n")
      const csv = `${header}\n${body}\n`
      res.setHeader("Content-Type", "text/csv; charset=utf-8")
      res.send(csv)
    } catch (e) {
      console.error("[v0] /images.csv error:", e)
      res.status(500).send("Failed to export CSV")
    }
  })

  // Serve files
  server.get("/files/:name", (req, res) => {
    try {
      const filename = filenameFromInput(req.params.name)
      const full = safeJoinUploads(filename)
      if (!fs.existsSync(full)) return res.status(404).send("Not found")
      res.sendFile(full)
    } catch (e) {
      console.error("[v0] /files error:", e)
      res.status(400).send("Bad request")
    }
  })

  // Upload multiple files
  server.post("/upload", upload.array("files", 100), (req, res) => {
    try {
      const files = req.files || []
      const db = readDB()
      const byName = new Map((db.images || []).map((it) => [it.filename, it]))
      const results = []

      for (const f of files) {
        const filename = f.originalname
        const size = f.size || 0
        const existing = byName.get(filename)
        const record = {
          filename,
          url: buildImageUrl(req, filename),
          size,
          createdAt: existing?.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        byName.set(filename, record)
        results.push({ filename, url: record.url, status: existing ? "overwritten" : "uploaded" })
      }
      const images = Array.from(byName.values())
      writeDB({ images })
      res.json({ uploaded: results, count: results.length })
    } catch (e) {
      console.error("[v0] /upload error:", e)
      res.status(500).json({ error: "Failed to upload files" })
    }
  })

  // Bulk delete by URLs or filenames
  server.post("/delete", (req, res) => {
    try {
      const items = Array.isArray(req.body?.items)
        ? req.body.items
        : String(req.body?.items || "")
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)

      if (!items.length) return res.status(400).json({ error: "No items provided" })

      const filenames = items.map(filenameFromInput)
      const db = readDB()
      const toKeep = []
      const deleted = []

      for (const img of db.images || []) {
        if (filenames.includes(img.filename)) {
          try {
            const full = safeJoinUploads(img.filename)
            if (fs.existsSync(full)) fs.unlinkSync(full)
            deleted.push(img.filename)
          } catch (e) {
            console.error("[v0] delete unlink error:", e)
          }
        } else {
          toKeep.push(img)
        }
      }
      writeDB({ images: toKeep })
      res.json({ deleted, kept: toKeep.length })
    } catch (e) {
      console.error("[v0] /delete error:", e)
      res.status(500).json({ error: "Failed to delete" })
    }
  })

  // Everything else -> Next
  server.all("*", (req, res) => handle(req, res))

  server.listen(PORT, () => {
    console.log(`[v0] Server ready on http://localhost:${PORT} (Next + API)`)
    console.log(`[v0] Uploads dir: ${UPLOADS_DIR}`)
    console.log(`[v0] Data file: ${DB_FILE}`)
  })
}

start().catch((e) => {
  console.error("[v0] Failed to start server:", e)
  process.exit(1)
})
