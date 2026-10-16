import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const appVersion = new Date().toISOString();

// https://vite.dev/config/
export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  plugins: [react()],
  build: {
    rollupOptions: {
      plugins: [{
        name: 'write-app-version',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'version.json',
            source: JSON.stringify({ version: appVersion }),
          });
        },
      }],
    },
  },
})
