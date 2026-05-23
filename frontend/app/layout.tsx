import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "顧客心理分析",
  description: "Real-time Sales Support Dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
