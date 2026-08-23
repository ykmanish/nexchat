import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

const nextConfig = {
  reactStrictMode: true,
  /* Two `next dev` processes sharing one build directory delete each other's
     manifests mid-run, which surfaces as ENOENT on routes-manifest.json and a
     blank page. Setting NEXT_DIST_DIR gives a second instance its own folder;
     unset, this is the normal `.next` and nothing changes. */
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Without this Next walks up to the home directory looking for a lockfile.
  outputFileTracingRoot: __dirname,
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'https', hostname: '**' },
    ],
  },
  devIndicators: false,
  async rewrites() {
    return [{ source: '/uploads/:path*', destination: API + '/uploads/:path*' }];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self)' },
        ],
      },
    ];
  },
};

export default nextConfig;
