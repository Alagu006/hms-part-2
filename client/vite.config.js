import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [
    basicSsl(),
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectManifest: {
        swSrc: 'src/sw.js',  // your custom SW
        swDest: 'dist/sw.js',     // output at dist root
        globDirectory: 'dist',
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
      manifest: false,
      devOptions: {
        enabled: false,      // ✅ do not register SW in dev
        type: 'module',
      },
    }),
  ],
  css: {
    preprocessorOptions: {
      scss: {
        api: 'modern-compiler', // Use modern Sass API instead of legacy
        silenceDeprecations: ['legacy-js-api'], // Silence legacy API warnings during transition
      },
    },
  },
  server: {
    https: true,
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const clientIp = req.socket.remoteAddress;
            proxyReq.setHeader('X-Forwarded-For', clientIp);
          });
        },
      },
      '/socket.io': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React runtime
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // State + data fetching
          'vendor-state': ['zustand', '@tanstack/react-query'],
          // Charts — heavy, only needed on analytics pages
          'vendor-charts': ['recharts'],
          // QR code — only needed on inventory pages
          'vendor-qr': ['qrcode', 'qrcode.react', '@zxing/library'],
          // Animation
          'vendor-motion': ['framer-motion'],
          // Socket
          'vendor-socket': ['socket.io-client'],
        },
      },
    },
  },
});