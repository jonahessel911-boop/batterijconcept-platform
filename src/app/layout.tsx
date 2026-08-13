import { Outfit, DM_Sans } from "next/font/google";
import type { Metadata } from "next";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
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
    <html lang="nl" className={`${outfit.variable} ${dmSans.variable} h-full`}>
      <body className="min-h-full flex flex-col font-body antialiased bg-wash text-ink">
        {children}
      </body>
    </html>
  );
}
