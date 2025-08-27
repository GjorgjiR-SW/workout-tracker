import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages project site base path:
export default defineConfig({
  base: '/workout-tracker/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: 'Workout Tracker',
        short_name: 'Workouts',
        start_url: '/workout-tracker/',
        scope: '/workout-tracker/',
        display: 'standalone',
        theme_color: '#000000',
        background_color: '#ffffff',
        description: 'Plan workouts, log sets, and track progress offline.',
        icons: [
          { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      }
    })
  ]
});
