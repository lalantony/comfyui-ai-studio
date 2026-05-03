"use client";

import { Asset } from "@/types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ExternalLink, FileText } from "lucide-react";

interface AssetViewerDialogProps {
  asset: Asset | null;
  onOpenChange: (open: boolean) => void;
}

export function AssetViewerDialog({ asset, onOpenChange }: AssetViewerDialogProps) {
  return (
    <Dialog open={!!asset} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl p-0 overflow-hidden bg-panel border-white/10">
        {asset && (
          <>
            <DialogTitle className="sr-only">{asset.name}</DialogTitle>
            <div className="bg-black/40 flex items-center justify-center min-h-[60vh] max-h-[80vh] overflow-auto">
              {asset.type === "image" ? (
                // Intentional <img>: this is the full-resolution viewer.
                // The gallery thumbnails go through next/image with `fill`
                // mode and small sizes; here we want the original bytes
                // unscaled, and we don't know the intrinsic dimensions
                // statically (they vary per asset).
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={asset.url}
                  alt={asset.name}
                  className="max-w-full max-h-[80vh] object-contain"
                />
              ) : asset.type === "video" ? (
                <video
                  src={asset.url}
                  controls
                  autoPlay
                  className="max-w-full max-h-[80vh]"
                />
              ) : asset.type === "music" ? (
                <div className="flex flex-col items-center gap-4 p-12">
                  <div className="w-20 h-20 rounded-full bg-accent-yellow/15 border border-accent-yellow/30 flex items-center justify-center">
                    <FileText className="w-10 h-10 text-accent-yellow" />
                  </div>
                  <audio src={asset.url} controls autoPlay className="w-96" />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-3 p-12 text-muted-foreground">
                  <FileText className="w-12 h-12" />
                  <a
                    href={asset.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs flex items-center gap-1.5 hover:text-foreground transition-colors"
                  >
                    Open file
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>
            <div className="p-3 border-t border-white/8 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground truncate" title={asset.name}>
                  {asset.name}
                </p>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                  <span className="capitalize">{asset.type}</span>
                  {asset.dimensions && <span>{asset.dimensions}</span>}
                  {asset.duration && <span>{asset.duration}</span>}
                  <span>{asset.createdAt}</span>
                </div>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
