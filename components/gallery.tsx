"use client"

import React from "react"
import useSWR, { mutate } from "swr"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
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

export function Gallery() {
  const { data, isLoading } = useSWR(LIST_URL, fetcher)
  const images: ImageMeta[] = Array.isArray(data) ? data : data?.images || []
  const { toast } = useToast()
  const [filter, setFilter] = React.useState("")
  const [selected, setSelected] = React.useState<Record<string, boolean>>({})

  const filtered = images.filter((i) => {
    if (!filter) return true
    const f = filter.toLowerCase()
    return (
      i.filename.toLowerCase().includes(f) ||
      i.url.toLowerCase().includes(f) ||
      i.mime?.toLowerCase().includes(f) ||
      i.type?.toLowerCase().includes(f)
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

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-col md:flex-row gap-4 md:items-center justify-between">
        <div className="flex items-center gap-2">
          <Input placeholder="Filter by name/type/url" value={filter} onChange={(e) => setFilter(e.target.value)} />
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

      {isLoading ? (
        <div className="text-sm">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-sm">No images</div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filtered.map((img) => {
            const checked = !!selected[img.filename]
            return (
              <div key={img.filename} className="relative rounded-md border overflow-hidden">
                <label className="absolute top-2 left-2 z-10 bg-background/80 rounded p-1 border">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(img.filename)}
                    aria-label={`select ${img.filename}`}
                  />
                </label>

                <div className="absolute top-2 right-2 z-10">
                  <span className="rounded px-2 py-0.5 text-xs bg-green-600 text-white">Uploaded</span>
                </div>

                <img
                  src={img.url || "/placeholder.svg?height=160&width=160&query=image%20preview"}
                  alt={img.filename}
                  className="w-full h-40 object-cover"
                  crossOrigin="anonymous"
                />
                <div className="p-2 space-y-1">
                  <div className="text-sm font-medium truncate">{img.filename}</div>
                  <div className="text-xs text-muted-foreground truncate">{img.type || img.mime}</div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
