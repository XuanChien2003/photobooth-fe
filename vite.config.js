import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Guests open the album from a QR code on a phone. Its code is a separate chunk that the browser
// only discovered after the main bundle had run (measured live on 4G). On /album/ pages a tiny
// inline script near the top of <head> (before the stylesheets, which would hold it back)
// modulepreloads the album screen's chunks together with the main bundle. The album list itself
// is requested by main.jsx as soon as it runs (a fetch preload of it was measured not to be
// reused by the app's request). Other pages (admin, kiosk) are unchanged.
function albumRoutePreload() {
  return {
    name: 'album-route-preload',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const chunks = Object.values(ctx.bundle || {}).filter((c) => c.type === 'chunk');
        const pages = chunks.find((c) => c.facadeModuleId?.replace(/\\/g, '/').endsWith('/src/pages.jsx'));
        if (!pages) return html;
        const files = new Set();
        const visit = (name) => {
          if (files.has(name)) return;
          files.add(name);
          for (const dep of ctx.bundle[name]?.imports || []) visit(dep);
        };
        visit(pages.fileName);
        const already = new Set([...html.matchAll(/(?:src|href)="\/([^"]+\.js)"/g)].map((m) => m[1]));
        const urls = [...files].filter((f) => !already.has(f)).map((f) => '/' + f);
        const script = `<script>(function(){var m=/^\\/album\\/([^/?#]+)/.exec(location.pathname);if(!m)return;` +
          `function add(rel,href,as,cors){var l=document.createElement("link");l.rel=rel;l.href=href;if(as)l.as=as;l.crossOrigin=cors;document.head.appendChild(l)}` +
          `${JSON.stringify(urls)}.forEach(function(h){add("modulepreload",h,"","")})})()</script>`;
        return html.replace(/(<meta name="viewport"[^>]*>)/, `$1\n    ${script}`);
      },
    },
  };
}
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const proxy = { '/api': env.API_PROXY_TARGET || 'http://localhost:8080' };
  return {
    plugins: [react(), tailwindcss(), albumRoutePreload()],
    server: { host: '0.0.0.0', port: 5173, strictPort: true, proxy },
    preview: { port: 5173, strictPort: true, proxy },
    build: {
      rollupOptions: {
        output: {
          // React + router tách thành một tệp riêng (~300 KB, gần như không đổi): mỗi lần deploy chỉ
          // tải lại phần mã ứng dụng, thư viện còn trong cache của trình duyệt.
          manualChunks(id) {
            if (/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom)\//.test(id)) return 'vendor';
          },
        },
      },
    },
  };
});
