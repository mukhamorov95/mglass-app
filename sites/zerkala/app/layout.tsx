import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import { Footer, Header, MobileActionBar } from "@/components/layout";
import { Tracking } from "@/components/Tracking";
import { JsonLd } from "@/components/ui";
import { organizationSchema, websiteSchema } from "@/lib/seo";
import { SITE, assertLaunchReady } from "@/lib/site";
import "./globals.css";

assertLaunchReady();

const manrope = Manrope({ subsets: ["latin", "cyrillic"], variable: "--font-manrope", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  applicationName: SITE.name,
  formatDetection: { telephone: false },
  verification: SITE.yandexVerification ? { yandex: SITE.yandexVerification } : undefined,
};

export const viewport: Viewport = {
  themeColor: "#f7f6f2",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru" className={manrope.variable}>
      <body className="min-h-screen font-sans antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-ink focus:px-4 focus:py-2 focus:text-white">
          К содержимому
        </a>
        <Header />
        <main id="main">{children}</main>
        <Footer />
        <MobileActionBar />
        <JsonLd data={[organizationSchema(), websiteSchema()]} />
        <Tracking metrikaId={SITE.metrikaId} />
      </body>
    </html>
  );
}
