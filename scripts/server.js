/**
 * Image backend (Express) — single file, drop-in
 * Fitur:
 * - Serve file statis di /files/{filename} dari UPLOADS_DIR
 * - Upload multiple files (field: "files"), simpan nama asli (overwrite jika sama)
 * - List metadata di /images (URL absolut mengikuti domain via X-Forwarded-* atau PUBLIC_BASE_URL)
 * - DB JSON sederhana di DATA_DIR/db.json
 * - (Opsional) mount json-server di /db jika package tersedia
 *
 * ENV yang didukung:
 * - PORT (default 4000)
 * - UPLOADS_DIR (default /tmp/uploads)
 * - DATA_DIR (default /tmp/data)
 * - PUBLIC_BASE_URL (optional; contoh: https://uploadimage.xyz)
 *
 * Jalankan: node scripts/server.js
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const express = require("express");
const multer = require("multer");

// ====== Konfigurasi dasar ======
const PORT = parseInt(process.env.PORT || "4000", 10);
const UPLOADS_DIR = process.env.UPLOADS_DIR || "/tmp/uploads";
const DATA_DIR = process.env.DATA_DIR || "/tmp/data";
const DB_FILE = path.join(DATA_DIR, "db.json");
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || ""; // ex: https://uploadimage.xyz

// ====== Bootstrap folder/data ======
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(DB_FILE, JSON.stringify({ images: [] }, null, 2));
}

// ====== DB helper sederhana ======
async function readDB() {
  const raw = await fsp.readFile(DB_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw || "{}");
    if (!parsed.images) parsed.images = [];
    return parsed;
  } catch {
    return { images: [] };
  }
}
async function writeDB(db) {
  await fsp.writeFile(DB_FILE, JSON.stringify(db, null, 2));
}

// ====== Express app ======
const app = express();
app.set("trust proxy", 1); // penting jika di belakang Nginx/Reverse Proxy

// CORS ringan (opsional)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Hitung base URL dari header proxy (atau PUBLIC_BASE_URL)
function externalBase(req) {
  if (PUBLIC_BASE_URL) return PUBLIC_BASE_URL.replace(/\/+$/, "");
  const proto = req.headers["x-forwarded-proto"] || req.protocol;
  const host = req.headers["x-forwarded-host"] || req.get("host");
  return `${proto}://${host}`;
}
function buildFileUrl(req, filename) {
  const base = externalBase(req);
  return `${base}/files/${encodeURIComponent(filename)}`;
}

// ====== Static /files (prefix DIPERTAHANKAN) ======
app.use(
  "/files",
  express.static(UPLOADS_DIR, {
    index: false,
    fallthrough: true,
    setHeaders: (res) => {
      // cache panjang untuk asset gambar (opsional)
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'");
    },
  })
);

// ====== Upload (multer) — field name: "files" ======
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    // Simpan nama asli (overwrite jika clash)
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });

app.post("/upload", upload.array("files", 200), async (req, res) => {
  try {
    const files = req.files || [];
    const now = new Date().toISOString();

    const db = await readDB();

    const results = [];
    for (const f of files) {
      const filename = f.originalname;
      const idx = db.images.findIndex((x) => x.filename === filename);
      const record = {
        id: filename,
        filename,
        size: f.size,
        type: f.mimetype,
        createdAt: now,
        updatedAt: now,
      };

      if (idx >= 0) {
        // pertahankan createdAt lama
        record.createdAt = db.images[idx].createdAt || now;
        db.images[idx] = record;
      } else {
        db.images.push(record);
      }

      results.push({
        filename,
        url: buildFileUrl(req, filename), // balas absolut sesuai domain/proxy
        status: idx >= 0 ? "overwritten" : "uploaded",
      });
    }

    await writeDB(db);
    res.json({ uploaded: results, count: results.length });
  } catch (e) {
    console.error("[upload] error:", e);
    res.status(500).json({ error: "Upload failed" });
  }
});

// ====== List images (rebase URL jika perlu) ======
app.get("/images", async (req, res) => {
  try {
    const db = await readDB();
    const base = externalBase(req);
    const list = (db.images || []).map((it) => {
      // Selalu kirim URL absolut yang benar (tidak localhost)
      // Jika sebelumnya ada url lama, abaikan; bangun dari filename
      return {
        ...it,
        url: `${base}/files/${encodeURIComponent(it.filename)}`,
      };
      // Kalau lebih suka relatif, ganti baris di atas dengan:
      // url: `/files/${encodeURIComponent(it.filename)}`
    });
    res.json(list);
  } catch (e) {
    console.error("[images] error:", e);
    res.status(500).json({ error: "Failed to load images" });
  }
});

// ====== Delete by filename atau url (opsional, berguna) ======
app.delete("/images", express.json(), async (req, res) => {
  try {
    const { filenames = [], urls = [] } = req.body || {};
    const targets = new Set(filenames);

    // Ekstrak filename dari urls
    for (const u of urls) {
      try {
        const p = new URL(u).pathname; // /files/NAME
        const m = p.match(/\/files\/(.+)$/);
        if (m) targets.add(decodeURIComponent(m[1]));
      } catch {}
    }

    if (targets.size === 0)
      return res.status(400).json({ error: "Provide filenames or urls" });

    const db = await readDB();
    const kept = [];
    const deleted = [];
    for (const it of db.images) {
      if (targets.has(it.filename)) {
        // hapus file di disk
        try {
          await fsp.unlink(path.join(UPLOADS_DIR, it.filename));
        } catch {}
        deleted.push(it.filename);
      } else {
        kept.push(it);
      }
    }
    db.images = kept;
    await writeDB(db);
    res.json({ deleted, count: deleted.length });
  } catch (e) {
    console.error("[delete] error:", e);
    res.status(500).json({ error: "Delete failed" });
  }
});

// ====== Healthcheck ======
app.get("/health", (_req, res) => res.send("ok"));

// ====== (Opsional) Mount json-server di /db jika tersedia ======
try {
  const jsonServer = require("json-server");
  const router = jsonServer.router(DB_FILE);
  const middlewares = jsonServer.defaults();
  app.use("/db", middlewares, router);
  console.log(`[v0] DB path: ${DB_FILE} (json-server mounted at /db)`);
} catch {
  console.log(`[v0] DB path: ${DB_FILE} (json-server not installed, skipping /db)`);
}

// ====== Start ======
app.listen(PORT, "127.0.0.1", () => {
  console.log(`[v0] Image backend running at http://localhost:${PORT}`);
  console.log(`[v0] Files served from ${UPLOADS_DIR} at /files/{filename}`);
});
