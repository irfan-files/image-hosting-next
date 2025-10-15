import { NextResponse } from "next/server"
import { getSafeFilePath, sanitizeFilename } from "@/lib/filename"
import { promises as fs } from "fs"
import path from "path"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

function guessMime(ext: string) {
  const e = ext.toLowerCase()
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg"
  if (e === ".png") return "image/png"
  if (e === ".gif") return "image/gif"
  if (e === ".webp") return "image/webp"
  if (e === ".svg") return "image/svg+xml"
  if (e === ".bmp") return "image/bmp"
  if (e === ".avif") return "image/avif"
  return "application/octet-stream"
}

export async function GET(_req: Request, ctx: { params: { filename: string } }) {
  try {
    const filename = sanitizeFilename(ctx.params.filename)
    const filePath = getSafeFilePath(filename)

    // [v0] debug: verify path exists
    // console.log("[v0] serving file:", filePath)

    const data = await fs.readFile(filePath)
    const ext = path.extname(filename)
    const mime = guessMime(ext)

    return new NextResponse(data, {
      headers: {
        "Content-Type": mime,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    })
  } catch (e: any) {
    // console.error("[v0] file serve error:", e?.message)
    return NextResponse.json({ error: "File not found" }, { status: 404 })
  }
}
