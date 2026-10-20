import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'
import { visualizer } from 'rollup-plugin-visualizer'

// https://vitejs.dev/config/
/**
 * Local development: the API is the Cloudflare Worker (`wrangler dev`, port
 * 8787); the pages are served by Vite. Without this proxy every /api/* call
 * from the dev server hit Vite itself and failed with a 404 — and since Phase
 * 13 / 08 the public pages (flags, sessions, registration) use the API too.
 * `npm run dev` starts both (scripts/dev.js).
 */
const API_TARGET = process.env.DEV_API_URL ?? 'http://127.0.0.1:8787';
const apiProxy = { '/api': { target: API_TARGET, changeOrigin: false } };

export default defineConfig({
  server: { proxy: apiProxy },
  preview: { proxy: apiProxy },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'Online Tutoring Platform',
        short_name: 'Tutoring',
        description: 'Student Registration & Zoom Class Access',
        theme_color: '#667eea',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          {
            src: '/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
        // Phase 13 / 08 C6: the service worker used to PRECACHE every chunk on
        // a visitor's first load — ~800 KB gz, including Firebase, the PDF
        // tools and every staff screen — on students' phones, on mobile data,
        // for pages they never open. Staff-only and on-demand chunks are now
        // cached the first time they are actually used (runtime rule below).
        globIgnores: [
          '**/vendor-firebase*.js', '**/app-*.js', '**/analytics-*.js',
          '**/StaffShell-*.js', '**/staffRoutes-*.js', '**/LoginPage-*.js', '**/SuperadminPage-*.js',
          '**/AuthContext-*.js', '**/BillingContext-*.js', '**/DashboardPage-*.js', '**/BillingPage-*.js',
          '**/AuditLogViewer-*.js', '**/UserManager-*.js', '**/ReportsInbox-*.js', '**/NotificationsSettingsCard-*.js',
          '**/HelpFeedbackModal-*.js', '**/HelpFeedbackButton-*.js', '**/compressImage*.js',
          '**/CalendarPanel-*.js', '**/WhatsAppPanel-*.js', '**/FeesTab-*.js', '**/NotesTab-*.js',
          '**/jspdf*.js', '**/html2canvas*.js', '**/index.es-*.js', '**/purify.es-*.js',
          '**/stats.html', '**/stats.json',
        ],
        runtimeCaching: [
          {
            // Hashed chunks never change, so the first fetch is cached for good.
            urlPattern: ({ url }) => url.origin === self.location.origin && url.pathname.startsWith('/assets/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'app-chunks',
              expiration: { maxEntries: 120, maxAgeSeconds: 60 * 60 * 24 * 60 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    }),
    // Phase 13 / 01 D3 — bundle composition report. Only when ANALYZE=1, so a
    // normal build is unchanged: `ANALYZE=1 npm run build:quiet` writes
    // dist/stats.html (treemap) and dist/stats.json (raw data).
    ...(process.env.ANALYZE === '1'
      ? [
          visualizer({ filename: 'dist/stats.html', gzipSize: true, brotliSize: true, template: 'treemap' }),
          visualizer({ filename: 'dist/stats.json', gzipSize: true, template: 'raw-data' }),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@features': path.resolve(__dirname, './src/features'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@services': path.resolve(__dirname, './src/services'),
      '@utils': path.resolve(__dirname, './src/shared/utils'),
      '@hooks': path.resolve(__dirname, './src/shared/hooks'),
      '@components': path.resolve(__dirname, './src/shared/components'),
    }
  },
  build: {
    // 'hidden' emits source maps but omits the //# sourceMappingURL comment, so
    // they are never served to a browser or discoverable from the bundle. CI
    // uploads them to Sentry and then deletes them from dist/ before deploy —
    // readable stack traces in Sentry, nothing public. Phase 01 D8.
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        // A function, not a map: with a map, a module's dependencies are
        // pulled into its chunk, so the small Firebase core (app, util,
        // component) landed inside the Auth+Firestore chunk and anything
        // needing only the app — analytics — loaded all of it.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/[\/]node_modules[\/](react|react-dom|react-router|react-router-dom|scheduler)[\/]/.test(id)) return 'vendor-react';
          if (/[\/]@firebase[\/](auth|firestore)[\/]|[\/]firebase[\/](auth|firestore)[\/]/.test(id)) return 'vendor-firebase';
          if (/[\/]@firebase[\/](app|util|component|logger)[\/]|[\/]firebase[\/]app[\/]|[\/]idb[\/]/.test(id)) return 'vendor-firebase-core';
          if (/[\/]node_modules[\/](react-hook-form|zod)[\/]/.test(id)) return 'vendor-forms';
          // framer-motion is deliberately NOT forced into a chunk (Phase 13 / 08
          // A4): LazyMotion keeps the small `m` core in the boot set and the
          // animation engine (domAnimation) in its own async chunk; a manual
          // chunk would drag the whole engine back into the eager bundle.
          return undefined;
        },
      }
    },
    chunkSizeWarningLimit: 1000,
  }
})
