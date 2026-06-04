import { defineConfig } from 'vite'
import { resolve } from 'node:path'

/**
 * Builds the admin error-injection UI into `dist/admin/`.
 *
 *   dist/admin/ui.html  ← entry shell (from src/admin/ui-shell.html)
 *   dist/admin/ui.js
 *   dist/admin/ui.css
 *
 * The shell is the only HTML page; Vite rewrites <script>/<link> in
 * it to point at the hashed bundle, which we then rename to plain
 * `ui.{js,css}` via `output.entryFileNames` / `output.assetFileNames`
 * so the server can serve a stable URL.
 *
 * No framework — the UI is native Web Components, vanilla TS.
 */
export default defineConfig({
  root: resolve(__dirname, 'src/admin'),
  base: './',
  build: {
    outDir: resolve(__dirname, 'dist/admin'),
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, 'src/admin/ui-shell.html'),
      output: {
        entryFileNames: 'ui.js',
        chunkFileNames: 'ui-chunk-[hash].js',
        assetFileNames: (info) => {
          if (info.name && info.name.endsWith('.css')) return 'ui.css'
          return 'ui-[name][extname]'
        },
      },
    },
    target: 'es2020',
    // Keep an explicit Vite 6-compatible minifier for Node 18 support.
    minify: 'esbuild',
    sourcemap: false,
  },
})
