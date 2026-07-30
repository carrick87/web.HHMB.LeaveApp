import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      plugins: [react()],
      server: {
        host: true,
        port: 5173,
        allowedHosts: ['localhost', '127.0.0.1']
      },
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.REACT_APP_GOOGLE_DRIVE_API_KEY': JSON.stringify(env.REACT_APP_GOOGLE_DRIVE_API_KEY),
        'process.env.REACT_APP_GOOGLE_DRIVE_FOLDER_ID': JSON.stringify(env.REACT_APP_GOOGLE_DRIVE_FOLDER_ID)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
