import type { Metadata } from "next";
import "./mblz-globals.css";
import "./desktop.css";

export const metadata: Metadata = { title: "LawyerMind" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
