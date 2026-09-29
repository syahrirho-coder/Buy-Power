import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Buy Power Scanner",
  description:
    "Scan crypto pairs across 1h/4h/1d for price sitting inside the ChartPrime Support & Resistance buy-power zone.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
