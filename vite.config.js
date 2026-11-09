import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

// Vite evaluates this config once per environment (page and Worker), so keep the ID in the
// process environment: both builds must get the same value or the page reloads forever.
process.env.FRAME_BUILD_ID ||= new Date().toISOString();

// Cheap Android photo frames run an old Android System WebView (Chrome ~106 on the PF1007L,
// sometimes older). Keep the browser bundle inside that feature set.
// cssTarget chrome61 stops the minifier from emitting 4/8-digit hex colours, which several
// frames reject even though Chrome 106 "should" support them.
export default defineConfig({
  plugins: [cloudflare()],
  // Shared by the page and the worker. When they differ the frame reloads itself after a deploy.
  define: { __BUILD_ID__: JSON.stringify(process.env.FRAME_BUILD_ID) },
  build: {
    target: 'chrome106',
    cssTarget: 'chrome61',
  },
  server: { host: true },
});
