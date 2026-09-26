import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FleetFail - Resilient Dispatch Simulator',
  description: 'Synthetic residential battery fleet orchestrator for Base Power x AITX hackathon',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        {children}
      </body>
    </html>
  );
}
