import { randomUUID } from "crypto"

export type ImageMeta = {
  id: string
  filename: string
  url: string
  size: number
  mime: string
  createdAt: string
  updatedAt: string
}

let RESOLVED_DATA_DIR: string | null = null
let RESOLVED_DB_FILE: string | null = null

async function ensureDataRoot() {
  if (RESOLVED_DATA_DIR) return
  const pathMod = await import("path")
  const fsPromises = await import("fs/promises")
  const candidates = [
    process.env.DATA_DIR?.trim(),
    pathMod.join("/tmp", "data"),
    pathMod.join(process.cwd(), "data"),
  ].filter(Boolean) as string[]
  for (const dir of candidates) {
    try {
      await fsPromises.mkdir(dir, { recursive: true })
      RESOLVED_DATA_DIR = dir
      RESOLVED_DB_FILE = pathMod.join(dir, "images.json")
      return
    } catch {
      // try next
    }
  }
  // final fallback
  const last = candidates[candidates.length - 1]
  RESOLVED_DATA_DIR = last
  RESOLVED_DB_FILE = pathMod.join(last, "images.json")
}

type DbShape = {
  images: Record<string, ImageMeta> // key by filename for easy overwrite/update
}

async function ensureDataFile() {
  await ensureDataRoot()
  const fsPromises = await import("fs/promises")
  try {
    await fsPromises.access(RESOLVED_DB_FILE!)
  } catch {
    const initial: DbShape = { images: {} }
    await fsPromises.writeFile(RESOLVED_DB_FILE!, JSON.stringify(initial, null, 2), "utf8")
  }
}

async function readDb(): Promise<DbShape> {
  await ensureDataFile()
  const fsPromises = await import("fs/promises")
  const raw = await fsPromises.readFile(RESOLVED_DB_FILE!, "utf8")
  return JSON.parse(raw) as DbShape
}

async function writeDb(next: DbShape): Promise<void> {
  await ensureDataFile()
  const fsPromises = await import("fs/promises")
  await fsPromises.writeFile(RESOLVED_DB_FILE!, JSON.stringify(next, null, 2), "utf8")
}

let writeQueue: Promise<void> = Promise.resolve()

export const db = {
  async getAll(): Promise<ImageMeta[]> {
    const state = await readDb()
    return Object.values(state.images).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  },

  async upsert(meta: Omit<ImageMeta, "id" | "createdAt" | "updatedAt"> & Partial<ImageMeta>) {
    writeQueue = writeQueue.then(async () => {
      const state = await readDb()
      const existing = state.images[meta.filename]
      const now = new Date().toISOString()
      const next: ImageMeta = {
        id: existing?.id ?? randomUUID(),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        filename: meta.filename,
        url: meta.url!,
        size: meta.size!,
        mime: meta.mime!,
      }
      state.images[meta.filename] = next
      await writeDb(state)
    })
    return writeQueue
  },

  async deleteByFilenames(filenames: string[]) {
    const results: Record<string, boolean> = {}
    writeQueue = writeQueue.then(async () => {
      const state = await readDb()
      for (const name of filenames) {
        if (state.images[name]) {
          delete state.images[name]
          results[name] = true
        } else {
          results[name] = false
        }
      }
      await writeDb(state)
    })
    await writeQueue
    return results
  },

  async filenamesFromUrls(urls: string[]) {
    const list = await this.getAll()
    const urlToFile = new Map(list.map((m) => [m.url, m.filename]))
    return urls.map((u) => urlToFile.get(u)).filter(Boolean) as string[]
  },
}
