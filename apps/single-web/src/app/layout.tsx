import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kortix Single',
  description: 'Single-user, single-sandbox Kortix workspace',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
