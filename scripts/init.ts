// Node.js script: ensure ./public/uploads and ./data/images.json exist
import { promises as fs } from "fs"
import path from "path"

async function main() {
  const uploads = path.join(process.cwd(), "public", "uploads")
  const dataDir = path.join(process.cwd(), "data")
  const dbFile = path.join(dataDir, "images.json")

  await fs.mkdir(uploads, { recursive: true })
  await fs.mkdir(dataDir, { recursive: true })

  try {
    await fs.access(dbFile)
    console.log("[v0] DB file exists:", dbFile)
  } catch {
    const initial = { images: {} }
    await fs.writeFile(dbFile, JSON.stringify(initial, null, 2), "utf8")
    console.log("[v0] Created DB file:", dbFile)
  }

  console.log("[v0] Setup complete. You can start using the app.")
}

main().catch((e) => {
  console.error("[v0] Setup failed:", e)
  process.exit(1)
})
