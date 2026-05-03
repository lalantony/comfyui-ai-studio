import Image from "next/image";
import { cn } from "@/lib/utils";

interface AppLogoProps {
  className?: string;
  size?: number;
}

/**
 * Brand mark for ComfyUI AI Studio. Renders the master logo PNG via
 * Next.js `<Image>` so it's served as WebP with the correct DPR variant.
 *
 * Source: `public/brand/logo-128.png` (re-generate via
 * `python scripts/generate-brand-assets.py`).
 */
export function AppLogo({ className, size = 28 }: AppLogoProps) {
  return (
    <Image
      src="/brand/logo-128.png"
      alt="ComfyUI AI Studio"
      width={size}
      height={size}
      className={cn("shrink-0 select-none", className)}
      draggable={false}
      priority
    />
  );
}
