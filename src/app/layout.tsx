import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ragnarok — Personal AI Command Center",
  description: "Ragnarok is a local-first, self-hosted personal AI assistant. Multi-model, multi-tool, agent-capable, privacy-respecting.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">{children}</body>
    </html>
  );
}
