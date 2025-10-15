import { NextResponse } from "next/server"
import { promises as fs } from "fs"
import path from "path"
import { db } from "@/lib/db"
import { getUploadsDir, sanitizeFilename } from "@/lib/filename"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type DeleteBody = {
  urls?: string[]
  filenames?: string[]
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as DeleteBody
    let filenames = body.filenames?.map(sanitizeFilename) || []

    if (body.urls?.length) {
      const fromUrls = await db.filenamesFromUrls(body.urls)
      filenames = filenames.concat(fromUrls)
    }

    if (filenames.length === 0) {
      return NextResponse.json({ error: "Provide 'urls' or 'filenames'." }, { status: 400 })
    }

    const uploadDir = getUploadsDir()
    const perItem: Record<string, { deleted: boolean; error?: string }> = {}

    for (const name of filenames) {
      const target = path.join(uploadDir, sanitizeFilename(name))
      try {
        await fs.unlink(target)
        perItem[name] = { deleted: true }
      } catch (e: any) {
        perItem[name] = { deleted: false, error: e?.message }
      }
    }

    const resDb = await db.deleteByFilenames(filenames)

    for (const name of Object.keys(resDb)) {
      if (!perItem[name]) perItem[name] = { deleted: false }
      if (!resDb[name]) {
        perItem[name].error = perItem[name].error ? perItem[name].error + "; not found in DB" : "not found in DB"
      }
    }

    return NextResponse.json({ results: perItem })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 })
  }
}
