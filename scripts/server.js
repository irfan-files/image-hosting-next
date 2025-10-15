const express = require("express")
const multer = require("multer")
const path = require("path")
const fs = require("fs")
const cors = require("cors")
const jsonServer = require("json-server")



const PORT = Number(process.env.PORT) || 4000

// Directories with safe defaults (no env needed locally)
const DATA_DIR = process.env.DATA_DIR || "/tmp/data"
const UPLOADS_DIR = process.env.UPLOADS_DIR || "/tmp/uploads"
const DB_PATH = path.join(DATA_DIR, "db.json")

// Ensure directories exist
fs.mkdirSync(DATA_DIR, { recursive: true })
fs.mkdirSync(UPLOADS_DIR, { recursive: true })

// Ensure db.json exists
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify({ images: [] }, null, 2), "utf8")
}

const app = express()
app.use(cors({ origin: "*" }))
app.use(express.json({ limit: "50mb" }))
app.use("/files", express.static(UPLOADS_DIR, { fallthrough: true }))

// json-server router as DB
const router = jsonServer.router(DB_PATH)
const db = router.db // lowdb instance
const middlewares = jsonServer.defaults({ logger: false })

// Multer disk storage with original filename (no hashing)
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => cb(null, file.originalname),
})
const upload = multer({
  storage,
  limits: {
    fileSize: 1024 * 1024 * 50, // 50MB
    files: 200, // high parallelism
  },
})

function buildFileUrl(req, filename) {
  const host = req.get("host")
  const proto = req.protocol
  return `${proto}://${host}/files/${encodeURIComponent(filename)}`
}

// Health
app.get("/health", (_req, res) => {
  res.json({ ok: true, uploadsDir: UPLOADS_DIR, db: DB_PATH })
})

// List images
app.get("/images", (_req, res) => {
  try {
    const images = db.get("images").value() || []
    res.json(images)
  } catch (e) {
    console.error("[v0] /images error:", e?.message)
    res.status(500).json({ error: "Failed to read images list" })
  }
})

// Upload images (multi-file, keep original filename)
app.post("/upload", upload.array("files", 200), (req, res) => {
  try {
    const files = req.files || []
    const results = []
    const now = new Date().toISOString()

    files.forEach((f) => {
      const filename = f.originalname
      const url = buildFileUrl(req, filename)
      const record = {
        id: filename,
        filename,
        url,
        size: f.size,
        type: f.mimetype,
        createdAt: now,
        updatedAt: now,
      }

      const exists = db.get("images").find({ filename }).value()
      if (exists) {
        db.get("images")
          .find({ filename })
          .assign({ ...record, createdAt: exists.createdAt, updatedAt: now })
          .write()
      } else {
        db.get("images").push(record).write()
      }
      results.push({ filename, url, status: exists ? "overwritten" : "uploaded" })
    })

    res.json({ uploaded: results, count: results.length })
  } catch (e) {
    console.error("[v0] /upload error:", e?.message)
    res.status(500).json({ error: "Upload failed" })
  }
})

// Delete by filenames or URLs (bulk)
app.post("/delete", (req, res) => {
  try {
    const rawItems = Array.isArray(req.body?.items) ? req.body.items : []
    if (!rawItems.length) {
      return res.status(400).json({ error: "items array required" })
    }

    const toFilename = (item) => {
      try {
        const u = new URL(item)
        return decodeURIComponent(path.basename(u.pathname))
      } catch {
        return String(item || "").trim()
      }
    }

    const filenames = Array.from(new Set(rawItems.map(toFilename).filter(Boolean)))
    const results = []

    filenames.forEach((name) => {
      const filePath = path.join(UPLOADS_DIR, name)
      let fileDeleted = false

      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath)
          fileDeleted = true
        }
      } catch (e) {
        console.error("[v0] delete file error:", name, e?.message)
      }

      const hadRecord = !!db.get("images").find({ filename: name }).value()
      db.get("images").remove({ filename: name }).write()

      results.push({
        filename: name,
        fileDeleted,
        recordDeleted: hadRecord,
      })
    })

    res.json({ deleted: results, count: results.length })
  } catch (e) {
    console.error("[v0] /delete error:", e?.message)
    res.status(500).json({ error: "Delete failed" })
  }
})

// Optional: raw json-server under /db
app.use("/db", middlewares, router)

app.listen(PORT, () => {
  console.log(`[v0] Image backend running at http://localhost:${PORT}`)
  console.log(`[v0] Files served from ${UPLOADS_DIR} at /files/{filename}`)
  console.log(`[v0] DB path: ${DB_PATH} (json-server mounted at /db)`)
})
