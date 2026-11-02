import { defineConfig } from 'vite';

export default defineConfig({
  // /watch is the TV's page, as vercel.json rewrites it in production
  plugins: [{
    name: 'watch-page',
    configureServer(server: { middlewares: { use(f: (req: { url?: string }, res: unknown, next: () => void) => void): void } }) {
      server.middlewares.use((req, _res, next) => { if (req.url?.split('?')[0] === '/watch') req.url = req.url.replace('/watch', '/watch.html'); next(); });
    },
  }],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    // the game, and the bar's TV (/watch), which shares none of the 3D
    rollupOptions: { input: { main: 'index.html', watch: 'watch.html' } },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
} as never);
