import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ossuary',
  description: 'Descend. Die. Leave your bones for the next one.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
