import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// Réglages pour Tauri : port fixe, pas d'effacement d'écran (les logs Rust restent
// visibles), alias `@` → src. Le côté Rust n'est jamais surveillé : ses artefacts de
// build sont réécrits sans cesse et Windows finit par refuser (EBUSY), ce qui tue
// le serveur de dev au milieu d'un rebuild.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // La page 3D (three.js) est chargée à la demande : son chunk dépasse volontairement 500 Ko.
  build: { chunkSizeWarningLimit: 700 },
  server: {
    port: 5299,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
