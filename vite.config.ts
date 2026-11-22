import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {defineConfig, loadEnv} from 'vite';

const currentDir = path.dirname(fileURLToPath(import.meta.url));

function stripQuotes(val: string | undefined): string {
  return (val || '').trim().replace(/^["']|["']$/g, '');
}

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, currentDir, '');
  const supabaseUrl = stripQuotes(
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
      env.NEXT_PUBLIC_SUPABASE_URL ||
      process.env.VITE_SUPABASE_URL ||
      env.VITE_SUPABASE_URL,
  );
  const supabaseAnonKey = stripQuotes(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      process.env.VITE_SUPABASE_ANON_KEY ||
      env.VITE_SUPABASE_ANON_KEY,
  );
  const geminiApiKey = stripQuotes(
    process.env.GEMINI_API_KEY ||
      env.GEMINI_API_KEY ||
      process.env.VITE_GEMINI_API_KEY ||
      env.VITE_GEMINI_API_KEY,
  );

  return {
    envPrefix: ['VITE_', 'NEXT_PUBLIC_'],
    define: {
      'process.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': JSON.stringify(
        supabaseAnonKey,
      ),
      'process.env.GEMINI_API_KEY': JSON.stringify(geminiApiKey),
    },
    plugins: [
      react(),
      tailwindcss(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(currentDir, 'dist');
          const srcAssets = path.resolve(currentDir, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': currentDir,
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
