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
  /* Make the on-screen keyboard shrink the layout viewport, not just the
     visual one. Without this the browser keeps `100dvh` at full height and
     scrolls the page instead, which slides the chat header off the top and
     hides the composer behind the keyboard. */
  interactiveWidget: 'resizes-content',
  /* No `themeColor` here on purpose. Next owns any tag it renders and resets
     its content on re-render, which overwrites whatever we set at runtime.
     Media-scoped entries are wrong for this app anyway — they follow the OS
     colour scheme, so a phone in light mode showed a white status bar above a
     dark app. The tag is created and kept in step with the real theme by
     AppearanceBridge instead, and seeded pre-paint by the script below. */
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${satre.variable} ${outfit.variable}`}
    >
      <head>
        {/* Seeds the status-bar colour before first paint, so there is no
            white flash above a dark app while React hydrates. Mirrors the
            --header token for each theme. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "(function(){try{var t=localStorage.getItem('theme');" +
              "var d=t==='dark'||((!t||t==='system')&&matchMedia('(prefers-color-scheme:dark)').matches);" +
              "var m=document.createElement('meta');m.name='theme-color';" +
              "m.content=d?'#101614':'#f7f8fa';document.head.appendChild(m);}catch(e){}})()",
          }}
        />
      </head>
      <body className="font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
