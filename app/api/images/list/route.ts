import { NextResponse } from "next/server"
import { db } from "@/lib/db"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const format = searchParams.get("format") || "json"
    const images = await db.getAll()

    if (format === "csv") {
      const header = "filename,url,size,mime,createdAt,updatedAt"
      const rows = images.map((m) => [m.filename, m.url, m.size, m.mime, m.createdAt, m.updatedAt].join(","))
      const csv = [header, ...rows].join("\n")
      return new NextResponse(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="images.csv"`,
        },
      })
    }

    return NextResponse.json({ images })
  } catch (e: any) {
    // console.error("[v0] list error:", e?.message)
    return NextResponse.json({ error: e?.message || "Failed to list images" }, { status: 500 })
  }
}
