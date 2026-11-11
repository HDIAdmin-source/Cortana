import type { ReactNode } from "react";

export const metadata = {
  title: "HDI Cortana",
  description: "Hyperion Defense Industries: Cortana core (Phase 1 placeholder)",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: "2rem", lineHeight: 1.5 }}>
        {children}
      </body>
    </html>
  );
}
