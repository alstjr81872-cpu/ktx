import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "빈자리 | 기차표가 나오는 순간",
  description:
    "원하는 기차의 빈자리를 기다리는 가장 편안한 방법. KTX 좌석 탐색과 실시간 알림.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
