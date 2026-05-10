import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./Providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#7133da",
};

export const metadata: Metadata = {
  title: "Hey Zoe",
  description: "HeyZoe Dashboard",
  appleWebApp: {
    capable: true,
    title: "Hey Zoe",
    statusBarStyle: "default",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="he"
      dir="rtl"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* הוספנו כאן suppressHydrationWarning כדי לפתור את השגיאה של תוספי הדפדפן */}
      <body className="min-h-full flex flex-col text-right" suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}