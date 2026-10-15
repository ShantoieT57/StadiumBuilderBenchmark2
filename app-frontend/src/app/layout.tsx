import type { Metadata } from 'next';
import './globals.css';
import { ToastProvider } from '@/contexts/ToastContext';
import { ToastContainer } from '@/components/toast/ToastContainer';
import { APP_NAME } from '@/lib/auth/messages';

export const metadata: Metadata = {
  title: APP_NAME,
  description:
    'Import daily bank transaction files, then review, approve or reject each transaction.',
};

/**
 * Root layout. Owns no landmarks: each screen (sign-in, privacy, the signed-in
 * shell) renders its own <main>.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        <ToastProvider>
          {children}
          <ToastContainer />
        </ToastProvider>
      </body>
    </html>
  );
}
