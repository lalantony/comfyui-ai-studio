import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Toaster } from "sonner";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: {
    default: "ComfyUI AI Studio",
    template: "%s · ComfyUI AI Studio",
  },
  description: "Workflow-driven creation studio for AI image, video, and music generation, powered by ComfyUI.",
  applicationName: "ComfyUI AI Studio",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans`}>
        {children}
        <Toaster
          theme="dark"
          position="top-right"
          richColors
          closeButton
          toastOptions={{
            classNames: {
              toast: "!bg-panel-elevated !border-white/10 !text-foreground",
            },
          }}
        />
      </body>
    </html>
  );
}
