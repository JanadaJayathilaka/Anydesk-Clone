import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    react(),
    {
      name: 'lan-ip-provider',
      configureServer(server) {
        server.middlewares.use('/api/my-ip', (req, res) => {
          let ip = req.socket.remoteAddress || '127.0.0.1';
          if (ip.startsWith('::ffff:')) {
            ip = ip.replace('::ffff:', '');
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ip }));
        });
      }
    }
  ],
  server: {
    port: 5173,
    host: true,
    strictPort: true,
    watch: {
      ignored: ['**/release/**', '**/installer-dist/**', '**/dist/**']
    }
  }
})
