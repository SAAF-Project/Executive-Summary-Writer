import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "ESWriter · Internal Audit",
  description: "Write executive summaries and review process grades in your audit PowerPoint.",
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
