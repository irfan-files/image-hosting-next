import express from "express"
import next from "next"
import multer from "multer"
import path from "path"
import fs from "fs"
import cors from "cors"
import jsonServer from "json-server"

async function main() {
  const dev = process.env.NODE_ENV !== "production"
  const NEXT_PORT = Number(process.env.PORT) || 3000

  // Directories with safe defaults (no env needed locally)
  const DATA_DIR = process.env.DATA_DIR || "/tmp/data"
  const UPLOADS_DIR = process.env.UPLOADS_DIR || "/tmp/uploads"
  const DB_PATH = path.join(DATA_DIR, "db.json")

  // Ensure directories exist
  fs.mkdirSync(DATA_DIR, { recursive: true })
  fs.mkdirSync(UPLOADS_DIR, { recursive: true })
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({ images: [] }, null, 2), "utf8")
  }

  // Prepare Next
  const nextApp = next({ dev })
  const handle = nextApp.getRequestHandler()
  await nextApp.prepare()

  // Express app (same origin for API + static files + Next pages)
  const app = express()
  app.use(cors({ origin: "*" }))
  app.use(express.json({ limit: "50mb" }))

  // Serve uploaded files under same origin
  app.use("/files", express.static(UPLOADS_DIR, { fallthrough: true }))

  // json-server as database
  const router = jsonServer.router(DB_PATH)
  const db = router.db
  const middlewares = jsonServer.defaults({ logger: false })

  // Multer storage: keep original filename (no hashing)
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => cb(null, file.originalname),
  })
  const upload = multer({
    storage,
    limits: {
      fileSize: 1024 * 1024 * 50, // 50MB per file
      files: 200, // support high concurrency
    },
  })

  // Helper to build absolute URL for file preview
  function buildFileUrl(req: express.Request, filename: string) {
    const host = req.get("host")
    const proto = req.protocol
    return `${proto}://${host}/files/${encodeURIComponent(filename)}`
  }

  // Health
  app.get("/health", (_req, res) => {
    res.json({ ok: true, uploadsDir: UPLOADS_DIR, db: DB_PATH, env: dev ? "dev" : "prod" })
  })

  // List images
  app.get("/images", (_req, res) => {
    try {
      const images = db.get("images").value() || []
      res.json(images)
    } catch (e: any) {
      console.error("[v0] /images error:", e?.message)
      res.status(500).json({ error: "Failed to read images list" })
    }
  })

  // Upload images (multi-file, original filenames)
  app.post("/upload", upload.array("files", 200), (req, res) => {
    try {
      const files = (req.files as any[]) || []
      const results: any[] = []
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
    } catch (e: any) {
      console.error("[v0] /upload error:", e?.message)
      res.status(500).json({ error: "Upload failed" })
    }
  })

  // Delete by filenames or URLs (bulk)
  app.post("/delete", (req, res) => {
    try {
      const rawItems: string[] = Array.isArray(req.body?.items) ? req.body.items : []
      if (!rawItems.length) {
        return res.status(400).json({ error: "items array required" })
      }

      const toFilename = (item: string) => {
        try {
          const u = new URL(item)
          return decodeURIComponent(path.basename(u.pathname))
        } catch {
          return item.trim()
        }
      }

      const filenames = Array.from(new Set(rawItems.map(toFilename).filter(Boolean)))
      const results: any[] = []

      filenames.forEach((name) => {
        const filePath = path.join(UPLOADS_DIR, name)
        let fileDeleted = false

        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath)
            fileDeleted = true
          }
        } catch (e: any) {
          console.error("[v0] delete file error:", name, e?.message)
        }

        const hadRecord = !!db.get("images").find({ filename: name }).value()
        db.get("images").remove({ filename: name }).write()

        results.push({ filename: name, fileDeleted, recordDeleted: hadRecord })
      })

      res.json({ deleted: results, count: results.length })
    } catch (e: any) {
      console.error("[v0] /delete error:", e?.message)
      res.status(500).json({ error: "Delete failed" })
    }
  })

  // Optional: expose json-server under /db
  app.use("/db", middlewares, router)

  // Next handles everything else (frontend)
  app.all("*", (req, res) => {
    return handle(req, res)
  })

  app.listen(NEXT_PORT, () => {
    console.log(`[v0] Unified server running at http://localhost:${NEXT_PORT}`)
    console.log(`[v0] Files path: ${UPLOADS_DIR} served at /files/{filename}`)
    console.log(`[v0] DB: ${DB_PATH} (json-server mounted at /db)`)
    console.log(`[v0] API endpoints: GET /images, POST /upload, POST /delete`)
  })
}

main().catch((err) => {
  console.error("[v0] serve-app fatal:", err)
  process.exit(1)
})
