/**
 * Image backend (Express) — drop-in
 * - /files/{filename} -> serve dari UPLOADS_DIR
 * - /upload (field: "files") -> simpan nama asli (overwrite jika sama)
 * - /images -> daftar meta + URL ABSOLUT sesuai PUBLIC_BASE_URL
 * - /files-list -> scan folder upload langsung (tanpa DB)
 * - DB JSON di DATA_DIR/db.json ; optional json-server di /db
 *
 * ENV:
 * - PORT (default 4000)
 * - UPLOADS_DIR (default /tmp/uploads)
 * - DATA_DIR (default /tmp/data)
 * - PUBLIC_BASE_URL (default https://uploadimage.xyz)  <-- kunci!
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { statSync } = require("fs");
const fsp2 = require("fs/promises");
const path2 = require("path");

// ====== Konfigurasi dasar ======
const PORT = parseInt(process.env.PORT || "4000", 10);
const UPLOADS_DIR = process.env.UPLOADS_DIR || "/tmp/uploads";
const DATA_DIR = process.env.DATA_DIR || "/tmp/data";
const DB_FILE = path.join(DATA_DIR, "db.json");
// Default dipaksa ke domain kamu, bisa dioverride via ENV
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL || "https://uploadimage.xyz").replace(/\/+$/, "");

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
app.set("trust proxy", 1);

// CORS ringan (opsional)
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Base URL selalu memakai PUBLIC_BASE_URL (bukan host request)
function externalBase() {
  return PUBLIC_BASE_URL;
}
function buildFileUrl(filenameOrRelPath) {
  // dukung relPath (subfolder) maupun filename
  const rel = String(filenameOrRelPath).replace(/^\/+/, "");
  return `${externalBase()}/files/${encodeURI(rel)}`.replace(/#/g, "%23");
}

// ====== Static /files (prefix DIPERTAHANKAN) ======
app.use(
  "/files",
  express.static(UPLOADS_DIR, {
    index: false,
    fallthrough: true,
    setHeaders: (res) => {
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'");
    },
  })
);

// ====== Upload (multer) — field name: "files" ======
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, file.originalname), // simpan nama asli
});
const upload = multer({ storage });

// Upload: simpan meta di DB (tanpa host), balas URL absolut berbasis PUBLIC_BASE_URL
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
        record.createdAt = db.images[idx].createdAt || now;
        db.images[idx] = record;
      } else {
        db.images.push(record);
      }
      results.push({
        filename,
        url: buildFileUrl(filename), // ABSOLUT ke domain kamu
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

// List images: selalu bangun URL dari filename (abaikan url lama di DB)
app.get("/images", async (_req, res) => {
  try {
    const db = await readDB();
    const list = (db.images || []).map((it) => ({
      ...it,
      url: buildFileUrl(it.filename),
    }));
    res.json(list);
  } catch (e) {
    console.error("[images] error:", e);
    res.status(500).json({ error: "Failed to load images" });
  }
});

// ====== Scan folder langsung (tanpa DB) ======
async function walkDir(root, recursive) {
  const out = [];
  const stack = [""];
  while (stack.length) {
    const rel = stack.pop();
    const dir = path2.join(root, rel);
    const entries = await fsp2.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const relPath = rel ? path2.join(rel, ent.name) : ent.name;
      const full = path2.join(root, relPath);
      if (ent.isDirectory()) {
        if (recursive) stack.push(relPath);
        continue;
      }
      if (ent.name.startsWith(".")) continue; // skip hidden
      try {
        const st = statSync(full);
        out.push({
          relPath: relPath.replace(/\\/g, "/"),
          size: st.size,
          mtime: st.mtime.toISOString(),
          ctime: st.ctime.toISOString(),
        });
      } catch {}
    }
  }
  return out;
}

app.get("/files-list", async (req, res) => {
  try {
    const q = req.query || {};
    const recursive = String(q.recursive || "").toLowerCase() === "true";
    const format = (q.format || "").toLowerCase(); // "txt"
    const sortBy = (q.sort || "name").toLowerCase(); // name|mtime|size
    const order = (q.order || "asc").toLowerCase(); // asc|desc
    const limit = Math.max(0, parseInt(q.limit || "0", 10));
    const offset = Math.max(0, parseInt(q.offset || "0", 10));

    let exts = null;
    if (q.ext) {
      exts = String(q.ext).split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    }

    const files = await walkDir(UPLOADS_DIR, recursive);

    const items = files
      .filter(f => {
        if (!exts) return true;
        const ext = path2.extname(f.relPath).slice(1).toLowerCase();
        return exts.includes(ext);
      })
      .map(f => {
        const filename = path2.basename(f.relPath);
        const url = buildFileUrl(f.relPath); // ABSOLUT ke domain kamu
        const ext = path2.extname(filename).slice(1).toLowerCase();
        const mime =
          ext === "jpg" || ext === "jpeg" ? "image/jpeg" :
          ext === "png" ? "image/png" :
          ext === "webp" ? "image/webp" :
          ext === "gif" ? "image/gif" :
          ext === "svg" ? "image/svg+xml" :
          "application/octet-stream";
        return { id: filename, filename, path: f.relPath, url, size: f.size, type: mime, mtime: f.mtime, ctime: f.ctime };
      });

    // sorting
    items.sort((a, b) => {
      let vA, vB;
      if (sortBy === "size") { vA = a.size; vB = b.size; }
      else if (sortBy === "mtime") { vA = a.mtime; vB = b.mtime; }
      else { vA = a.filename.toLowerCase(); vB = b.filename.toLowerCase(); }
      if (vA < vB) return -1;
      if (vA > vB) return 1;
      return 0;
    });
    if (order === "desc") items.reverse();

    const total = items.length;
    const sliced = limit ? items.slice(offset, offset + limit) : (offset ? items.slice(offset) : items);

    if (format === "txt") {
      res.type("text/plain").send(sliced.map(it => it.url).join("\n"));
      return;
    }

    res.json({ base: externalBase(), prefix: "/files", total, count: sliced.length, offset, limit: limit || null, items: sliced });
  } catch (e) {
    console.error("[files-list] error:", e);
    res.status(500).json({ error: "Failed to list files" });
  }
});

// ====== Delete by filename/url ======
app.delete("/images", express.json(), async (req, res) => {
  try {
    const { filenames = [], urls = [] } = req.body || {};
    const targets = new Set(filenames);
    for (const u of urls) {
      try {
        const p = new URL(u).pathname; // /files/NAME
        const m = p.match(/\/files\/(.+)$/);
        if (m) targets.add(decodeURIComponent(m[1]));
      } catch {}
    }
    if (targets.size === 0) return res.status(400).json({ error: "Provide filenames or urls" });

    const db = await readDB();
    const kept = [];
    const deleted = [];
    for (const it of db.images) {
      if (targets.has(it.filename)) {
        try { await fsp.unlink(path.join(UPLOADS_DIR, it.filename)); } catch {}
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

// ====== (Opsional) json-server untuk db.json ======
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
  console.log(`[v0] PUBLIC_BASE_URL: ${PUBLIC_BASE_URL}`);
});
