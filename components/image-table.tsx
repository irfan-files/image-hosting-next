"use client"

import useSWR, { mutate } from "swr"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useToast } from "@/hooks/use-toast"
import React from "react"
import { BACKEND_URL } from "@/lib/config"

type ImageMeta = {
  filename: string
  url: string
  size: number
  mime?: string
  type?: string
  createdAt: string
  updatedAt: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const LIST_URL = `${BACKEND_URL}/images`

export function ImageTable() {
  const { data, isLoading } = useSWR(LIST_URL, fetcher)
  const images: ImageMeta[] = Array.isArray(data) ? data : data?.images || []
  const { toast } = useToast()
  const [selected, setSelected] = React.useState<Record<string, boolean>>({})
  const [filter, setFilter] = React.useState("")
  const [deleteList, setDeleteList] = React.useState("")

  const filtered = images.filter((i: ImageMeta) => {
    if (!filter) return true
    const f = filter.toLowerCase()
    return (
      i.filename.toLowerCase().includes(f) ||
      i.url.toLowerCase().includes(f) ||
      (i.mime || "").toLowerCase().includes(f) ||
      (i.type || "").toLowerCase().includes(f)
    )
  })

  function toggle(name: string) {
    setSelected((s) => ({ ...s, [name]: !s[name] }))
  }

  function selectAll() {
    const map: Record<string, boolean> = {}
    for (const it of filtered) map[it.filename] = true
    setSelected(map)
  }

  function clearSelected() {
    setSelected({})
  }

  async function copySelectedUrls() {
    const urls = filtered.filter((i) => selected[i.filename]).map((i) => i.url)
    if (urls.length === 0) return
    await navigator.clipboard.writeText(urls.join("\n"))
    toast({ title: "Copied URLs", description: `${urls.length} URLs copied to clipboard` })
  }

  function downloadCsv() {
    const header = ["filename", "url", "size", "type", "createdAt", "updatedAt"]
    const rows = images.map((i) => [
      i.filename,
      i.url,
      String(i.size),
      i.type || i.mime || "",
      i.createdAt,
      i.updatedAt,
    ])
    const csv = [header, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = "images.csv"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  async function deleteSelected() {
    const filenames = filtered.filter((i) => selected[i.filename]).map((i) => i.filename)
    if (filenames.length === 0) return
    const res = await fetch(`${BACKEND_URL}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: filenames }),
    })
    const j = await res.json()
    if (!res.ok) {
      toast({ title: "Delete failed", description: j?.error || "Unknown error" })
      return
    }
    const ok = Array.isArray(j.deleted)
      ? j.deleted.filter((r: any) => r.fileDeleted || r.recordDeleted).length
      : j.count || 0
    toast({ title: "Delete done", description: `${ok} deleted` })
    mutate(LIST_URL)
    clearSelected()
  }

  async function deleteByPasted() {
    const lines = deleteList
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length === 0) return
    const payload = { items: lines }
    const res = await fetch(`${BACKEND_URL}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
    const j = await res.json()
    if (!res.ok) {
      toast({ title: "Delete failed", description: j?.error || "Unknown error" })
      return
    }
    const ok = Array.isArray(j.deleted)
      ? j.deleted.filter((r: any) => r.fileDeleted || r.recordDeleted).length
      : j.count || 0
    toast({ title: "Delete done", description: `${ok} deleted` })
    mutate(LIST_URL)
    setDeleteList("")
  }

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-col md:flex-row gap-4 md:items-center justify-between">
        <div className="flex items-center gap-2">
          <Input placeholder="Filter by name/type/url" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <Button variant="secondary" onClick={downloadCsv}>
            Export CSV
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={selectAll}>
            Select all
          </Button>
          <Button variant="outline" onClick={clearSelected}>
            Clear
          </Button>
          <Button onClick={copySelectedUrls}>Copy selected URLs</Button>
          <Button variant="destructive" onClick={deleteSelected}>
            Delete selected
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">Sel</TableHead>
              <TableHead>Preview</TableHead>
              <TableHead>Filename</TableHead>
              <TableHead>URL</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Updated</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7}>Loading...</TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7}>No images</TableCell>
              </TableRow>
            ) : (
              filtered.map((img) => (
                <TableRow key={img.filename}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={!!selected[img.filename]}
                      onChange={() => toggle(img.filename)}
                      aria-label={`select ${img.filename}`}
                    />
                  </TableCell>
                  <TableCell>
                    <img
                      src={img.url || "/placeholder.svg"}
                      alt={img.filename}
                      className="h-12 w-12 object-cover rounded border"
                      crossOrigin="anonymous"
                    />
                  </TableCell>
                  <TableCell>{img.filename}</TableCell>
                  <TableCell className="max-w-[280px] truncate">{img.url}</TableCell>
                  <TableCell>{Math.round(img.size / 1024)} KB</TableCell>
                  <TableCell>{img.type || img.mime}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(img.updatedAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-2">
        <div className="text-sm">Delete by pasted URLs or filenames (one per line)</div>
        <textarea
          className="w-full h-28 rounded-md border p-2 text-sm"
          placeholder="https://your-host/uploads/image-a.jpg
image-b.png"
          value={deleteList}
          onChange={(e) => setDeleteList(e.target.value)}
        />
        <div className="flex gap-2">
          <Button variant="destructive" onClick={deleteByPasted}>
            Delete by list
          </Button>
          <Button variant="secondary" onClick={() => setDeleteList("")}>
            Clear
          </Button>
        </div>
      </div>
    </Card>
  )
}
