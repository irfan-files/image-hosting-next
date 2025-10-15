import { NextResponse } from "next/server"
import { promises as fs } from "fs"
import { db } from "@/lib/db"
import { ensureUploadsDir, getSafeFilePath, sanitizeFilename, toPublicUrl } from "@/lib/filename"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || ""
    if (!contentType.includes("multipart/form-data")) {
      return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 })
    }
    await ensureUploadsDir()

    const form = await req.formData()
    const overwrite = (form.get("overwrite") || "false").toString() === "true"

    // collect possible file fields
    const allEntries = Array.from(form.entries())
    const files: File[] = []
    for (const [k, v] of allEntries) {
      if (k === "files" || k === "file") {
        const maybe = v as any
        if (maybe && typeof maybe.arrayBuffer === "function") {
          files.push(maybe as File)
        }
      }
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 })
    }

    const results: Array<{
      filename: string
      url?: string
      status: "uploaded" | "skipped" | "overwritten"
      error?: string
    }> = []

    for (const file of files) {
      const originalName = sanitizeFilename(file.name || "file")
      const destPath = getSafeFilePath(originalName)

      try {
        const exists = await fs
          .access(destPath)
          .then(() => true)
          .catch(() => false)

        if (exists && !overwrite) {
          results.push({
            filename: originalName,
            status: "skipped",
            error: "File exists. Set overwrite=true to replace.",
          })
          continue
        }

        const buf = Buffer.from(await file.arrayBuffer())
        await fs.writeFile(destPath, buf)

        const url = toPublicUrl(originalName)

        await db.upsert({
          filename: originalName,
          url,
          size: buf.byteLength,
          mime: file.type || "application/octet-stream",
        })

        results.push({ filename: originalName, url, status: exists ? "overwritten" : "uploaded" })
      } catch (e: any) {
        results.push({ filename: originalName, status: "skipped", error: e?.message || "Unknown error" })
      }
    }

    return NextResponse.json({ results })
  } catch (e: any) {
    // console.error("[v0] upload error:", e?.message)
    return NextResponse.json({ error: e?.message || "Upload failed" }, { status: 500 })
  }
}
