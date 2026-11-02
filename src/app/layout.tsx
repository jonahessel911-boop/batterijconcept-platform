import { Poppins, Geist } from "next/font/google";
import type { Metadata } from "next";
import "./globals.css";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

/** Zelfde vibe als batterijconcept.nl — geometrisch, strak, modern */
const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Batterijconcept CRM",
  description: "Leads, offertes, projecten en facturen — Batterijconcept.nl",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover" as const,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="nl" className={cn("h-full", poppins.variable, "font-sans", geist.variable)}>
      <body className="min-h-full flex flex-col font-body antialiased bg-wash text-ink">
        {children}
      </body>
    </html>
  );
}
