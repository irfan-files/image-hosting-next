import { Uploader } from "@/components/uploader"
import { ImageTable } from "@/components/image-table"
import { Card } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Gallery } from "@/components/gallery"

export default function Page() {
  return (
    <main className="max-w-5xl mx-auto p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-pretty">Self-Hosted Image Hosting</h1>
      </header>

      <Card className="p-4">
        <p className="text-sm text-muted-foreground">
          Upload images with parallel concurrency. URLs match their filenames for easy use in Excel or catalogs.
        </p>
      </Card>

      <Tabs defaultValue="table" className="space-y-4">
        <TabsList>
          <TabsTrigger value="table">Table</TabsTrigger>
          <TabsTrigger value="gallery">Gallery</TabsTrigger>
        </TabsList>
        <TabsContent value="table" className="space-y-4">
          <Uploader />
          <ImageTable />
        </TabsContent>
        <TabsContent value="gallery" className="space-y-4">
          <Uploader />
          <Gallery />
        </TabsContent>
      </Tabs>

      <footer className="text-center text-xs text-muted-foreground py-6">
        Images served from /uploads with same filenames
      </footer>
    </main>
  )
}
