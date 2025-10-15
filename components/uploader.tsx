"use client"

import React from "react"
import useSWR, { mutate } from "swr"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Progress } from "@/components/ui/progress"
import { useToast } from "@/hooks/use-toast"
import { BACKEND_URL } from "@/lib/config"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

const statusColors: Record<string, string> = {
  queued: "bg-muted text-foreground",
  uploading: "bg-blue-600 text-white",
  uploaded: "bg-green-600 text-white",
  overwritten: "bg-sky-600 text-white",
  skipped: "bg-amber-600 text-white",
  error: "bg-red-600 text-white",
}

const LIST_URL = `${BACKEND_URL}/images`

export function Uploader() {
  const [files, setFiles] = React.useState<File[]>([])
  const [concurrency, setConcurrency] = React.useState(8)
  const [overwrite, setOverwrite] = React.useState(false)
  const [inFlight, setInFlight] = React.useState(0)
  const [completed, setCompleted] = React.useState(0)
  const { toast } = useToast()
  const [statusMap, setStatusMap] = React.useState<Record<string, { status: string; error?: string }>>({})

  useSWR(LIST_URL, fetcher) // warm cache

  function onFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files ? Array.from(e.target.files) : []
    setFiles(picked)
    setCompleted(0)
    const next: Record<string, { status: string; error?: string }> = {}
    for (const f of picked) next[f.name] = { status: "queued" }
    setStatusMap(next)
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    const dropped = Array.from(e.dataTransfer.files || [])
    setFiles(dropped)
    setCompleted(0)
    const next: Record<string, { status: string; error?: string }> = {}
    for (const f of dropped) next[f.name] = { status: "queued" }
    setStatusMap(next)
  }

  function prevent(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
  }

  async function uploadOne(file: File) {
    const form = new FormData()
    form.append("files", file)
    form.append("overwrite", overwrite ? "true" : "false")
    const res = await fetch(`${BACKEND_URL}/upload`, { method: "POST", body: form })
    if (!res.ok) {
      const j = await res.json().catch(() => ({}))
      return { filename: file.name, status: "error", error: j?.error || `Failed ${file.name}` }
    }
    const j = await res.json()
    const item = (j.uploaded || [])[0] || {}
    return { filename: file.name, status: item.status || "uploaded", error: item.error }
  }

  async function runWithConcurrency<T extends File>(
    items: T[],
    worker: (x: T) => Promise<{ filename: string; status: string; error?: string }>,
    limit: number,
  ) {
    let idx = 0
    let active = 0
    const results: Array<{ filename: string; status: string; error?: string }> = []
    return new Promise<typeof results>((resolve) => {
      const next = () => {
        if (idx >= items.length && active === 0) return resolve(results)
        while (active < limit && idx < items.length) {
          const current = items[idx++]
          active++
          setInFlight((v) => v + 1)
          setStatusMap((m) => ({ ...m, [current.name]: { status: "uploading" } }))
          worker(current)
            .then((r) => {
              results.push(r)
              setStatusMap((m) => ({ ...m, [r.filename]: { status: r.status, error: r.error } }))
            })
            .catch((err) => {
              const msg = err?.message || "Error"
              results.push({ filename: current.name, status: "error", error: msg })
              setStatusMap((m) => ({ ...m, [current.name]: { status: "error", error: msg } }))
            })
            .finally(() => {
              active--
              setInFlight((v) => Math.max(0, v - 1))
              setCompleted((c) => c + 1)
              next()
            })
        }
      }
      next()
    })
  }

  async function startUpload() {
    if (files.length === 0) return
    setCompleted(0)
    const res = await runWithConcurrency(files, uploadOne, Math.max(1, concurrency))
    const success = res.filter((r) => r.status === "uploaded" || r.status === "overwritten").length
    const skipped = res.filter((r) => r.status === "skipped").length
    const failed = res.filter((r) => r.status === "error").length
    toast({
      title: "Upload finished",
      description: `${success} success, ${skipped} skipped, ${failed} failed`,
    })
    mutate(LIST_URL)
  }

  const percent = files.length ? Math.floor((completed / files.length) * 100) : 0

  return (
    <Card className="p-4 space-y-4">
      <div
        onDrop={onDrop}
        onDragOver={prevent}
        onDragEnter={prevent}
        className="border-2 border-dashed rounded-md p-6 text-center cursor-pointer"
      >
        <div className="text-sm text-muted-foreground mb-2">Drag & drop images here</div>
        <Input type="file" multiple accept="image/*" onChange={onFilePick} />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center">
        <div className="flex items-center gap-2">
          <Label htmlFor="concurrency">Concurrency</Label>
          <Input
            id="concurrency"
            type="number"
            min={1}
            max={64}
            value={concurrency}
            onChange={(e) => setConcurrency(Number.parseInt(e.target.value || "1", 10))}
          />
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="overwrite">Overwrite if exists</Label>
          <Switch id="overwrite" checked={overwrite} onCheckedChange={setOverwrite} />
        </div>
        <div className="text-sm text-muted-foreground">
          Files: {files.length} • In flight: {inFlight}
        </div>
      </div>

      <Button onClick={startUpload} disabled={files.length === 0}>
        Start Upload
      </Button>

      <div className="space-y-2">
        <Progress value={percent} />
        <div className="text-xs text-muted-foreground">
          {completed} / {files.length} completed ({percent}%)
        </div>
      </div>

      {files.length > 0 && (
        <div className="space-y-2">
          <div className="text-sm font-medium">Upload Status</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {files.map((f) => {
              const st = statusMap[f.name]?.status || "queued"
              const color = statusColors[st] || "bg-muted text-foreground"
              return (
                <div key={f.name} className="flex items-center justify-between rounded border p-2">
                  <div className="truncate text-sm">{f.name}</div>
                  <span className={`text-xs rounded px-2 py-0.5 ${color}`}>{st}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Card>
  )
}
