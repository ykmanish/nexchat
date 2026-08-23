import localFont from 'next/font/local';
import { Outfit } from 'next/font/google';
import './globals.css';
import { Providers } from '@/components/providers/Providers';

/* Satre carries the interface — every label, message and list row. */
const satre = localFont({
  src: './fonts/satre.ttf',
  variable: '--font-satre',
  display: 'swap',
  fallback: ['system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
});

/* Outfit is the closest free match to Product Sans — the same geometric
   skeleton and single-storey 'a'. Reserved for headings and numerals. */
const outfit = Outfit({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

export const metadata = {
  title: {
    default: 'NexChat',
    template: '%s · NexChat',
  },
  description:
    'A fast, end-to-end encrypted messenger. Your conversations stay between you and the people in them.',
  applicationName: 'NexChat',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, title: 'NexChat', statusBarStyle: 'default' },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FFFFFF' },
    { media: '(prefers-color-scheme: dark)', color: '#0B141A' },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${satre.variable} ${outfit.variable}`}
    >
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
