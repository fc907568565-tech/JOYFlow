import path from 'path';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import http from 'http';
import https from 'https';
import { patchJoyComposeHtml } from './server/joyPatch';

const JOY_COMPOSE_URL = 'https://5r0lrpa77tvw.joyapp.jd.com/compose.html';

function joyComposeBridge(): Plugin {
  return {
    name: 'joy-compose-bridge',
    configureServer(server) {
      server.middlewares.use('/joy-proxy', (req, res) => {
        const target = new URL(req.url || '/', 'https://5r0lrpa77tvw.joyapp.jd.com/');
        const upstream = https.request(target, {
          method: req.method,
          headers: {
            ...(req.headers.range ? { range: req.headers.range as string } : {}),
            ...(req.headers['content-type'] ? { 'content-type': req.headers['content-type'] as string } : {}),
            ...(req.headers['content-length'] ? { 'content-length': req.headers['content-length'] as string } : {}),
            ...(req.headers.accept ? { accept: req.headers.accept as string } : {}),
            'user-agent': (req.headers['user-agent'] as string) || 'Mozilla/5.0',
          },
        }, (upstreamRes) => {
          res.statusCode = upstreamRes.statusCode || 200;
          for (const [key, value] of Object.entries(upstreamRes.headers)) {
            if (value === undefined || /^access-control-/i.test(key)) continue;
            res.setHeader(key, value as string | string[]);
          }
          res.setHeader('access-control-allow-origin', '*');
          upstreamRes.pipe(res);
        });
        upstream.on('error', (err) => {
          console.error('[joy-proxy] error:', err.message);
          res.statusCode = 502;
          res.end('JOY asset unavailable');
        });
        req.pipe(upstream);
      });

      server.middlewares.use('/joy-compose', (_req, res) => {
        https.get(JOY_COMPOSE_URL, {
          headers: { 'user-agent': 'Mozilla/5.0' },
        }, (upstream) => {
          if ((upstream.statusCode || 500) >= 400) {
            res.statusCode = upstream.statusCode || 502;
            res.end('JOY upstream error');
            upstream.resume();
            return;
          }

          const chunks: Buffer[] = [];
          upstream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
          upstream.on('end', () => {
            const html = patchJoyComposeHtml(Buffer.concat(chunks).toString('utf8'));
            res.statusCode = 200;
            res.setHeader('content-type', 'text/html; charset=utf-8');
            res.setHeader('cache-control', 'no-store');
            res.end(html);
          });
        }).on('error', (err) => {
          console.error('[joy-compose] error:', err.message);
          res.statusCode = 502;
          res.end('JOY bridge unavailable');
        });
      });
    },
  };
}

// 移除 crossorigin 属性，兼容更多部署环境
function removeCrossorigin(): Plugin {
  return {
    name: 'remove-crossorigin',
    transformIndexHtml(html) {
      return html.replace(/ crossorigin/g, '');
    },
  };
}

// 强制下载远端图片，确保 iframe / 跨域资源不会退化成网页预览。
function downloadAssetProxy(): Plugin {
  return {
    name: 'download-asset-proxy',
    configureServer(server) {
      server.middlewares.use('/download-asset', (req, res) => {
        try {
          const raw = new URL(req.url || '', 'http://x').searchParams.get('u');
          if (!raw) {
            res.statusCode = 400;
            res.end('missing u');
            return;
          }
          const target = new URL(raw);
          const client = target.protocol === 'http:' ? http : https;
          const extension = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm', '.mov'].includes(path.extname(target.pathname).toLowerCase())
            ? path.extname(target.pathname).toLowerCase()
            : '.bin';
          const upstream = client.request({
            method: req.method,
            hostname: target.hostname,
            port: target.port || (target.protocol === 'https:' ? 443 : 80),
            path: target.pathname + target.search,
            headers: {
              'user-agent': (req.headers['user-agent'] as string) || 'Mozilla/5.0',
            },
          }, (upRes) => {
            for (const [key, value] of Object.entries(upRes.headers)) {
              if (value === undefined || /^access-control-|^content-disposition$/i.test(key)) continue;
              res.setHeader(key, value as string | string[]);
            }
            res.statusCode = upRes.statusCode || 200;
            res.setHeader('access-control-allow-origin', '*');
            res.setHeader('content-disposition', `attachment; filename="joy-image-${Date.now()}${extension}"`);
            upRes.pipe(res);
          });
          upstream.on('error', (error) => {
            console.error('[download-asset] error:', error.message);
            res.statusCode = 502;
            res.end('download unavailable');
          });
          upstream.end();
        } catch (error: any) {
          res.statusCode = 400;
          res.end('bad url: ' + error?.message);
        }
      });
    },
  };
}

// 通用远端资源代理: /remote-asset?u=<encodedUrl>
// 用于绕过第三方素材/视频/图片站点的 CORS（Agnes / TOS / imgbb 等)
function remoteAssetProxy(): Plugin {
  return {
    name: 'remote-asset-proxy',
    configureServer(server) {
      server.middlewares.use('/remote-asset', (req, res) => {
        try {
          const raw = new URL(req.url || '', 'http://x').searchParams.get('u');
          if (!raw) {
            res.statusCode = 400;
            res.end('missing u');
            return;
          }
          const target = new URL(raw);
          const client = target.protocol === 'http:' ? http : https;
          console.log('[remote-asset] ->', req.method, target.href);
          const upstream = client.request(
            {
              method: req.method,
              hostname: target.hostname,
              port: target.port || (target.protocol ==='https:' ? 443 : 80),
              path: target.pathname + target.search,
              headers: {
                // 转发必要 header，剥离 host/origin/referer 避免签名冲突
                ...(req.headers.range ? { range: req.headers.range as string } : {}),
                'user-agent': (req.headers['user-agent'] as string) || 'Mozilla/5.0',
              },
            },
            (upRes) => {
              console.log('[remote-asset] <-', upRes.statusCode, target.href);
              // 关键：加上 CORS 允许头
              res.setHeader('access-control-allow-origin', '*');
              res.setHeader('access-control-allow-methods', 'GET,HEAD,OPTIONS');
              res.setHeader('access-control-allow-headers', '*');
              // 透传 content-type / content-length / accept-ranges 等
              for (const [k, v] of Object.entries(upRes.headers)) {
                if (v === undefined) continue;
                if (/^access-control-/i.test(k)) continue;
                res.setHeader(k, v as any);
              }
              res.statusCode = upRes.statusCode || 200;
              upRes.pipe(res);
            }
          );
          upstream.on('error', (err) => {
            console.error('[remote-asset] error:', err.message, target.href);
            res.statusCode = 502;
            res.end('upstream error: ' + err.message);
          });
          upstream.end();
        } catch (e: any) {
          res.statusCode = 400;
          res.end('bad url: ' + e?.message);
        }
      });
    },
  };
}

function googleGeminiProxy(apiKey: string): Plugin {
  return {
    name: 'google-gemini-proxy',
    configureServer(server) {
      server.middlewares.use('/google-api', (req, res) => {
        const requestApiKey = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim() || apiKey;
        if (!requestApiKey) {
          res.statusCode = 500;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: { message: 'GEMINI_API_KEY is not configured' } }));
          return;
        }

        const target = new URL(req.url || '/', 'https://generativelanguage.googleapis.com/');
        const upstream = https.request(target, {
          method: req.method,
          headers: {
            'x-goog-api-key': requestApiKey,
            'content-type': (req.headers['content-type'] as string) || 'application/json',
            accept: (req.headers.accept as string) || 'application/json',
          },
        }, (upstreamRes) => {
          res.statusCode = upstreamRes.statusCode || 502;
          for (const [key, value] of Object.entries(upstreamRes.headers)) {
            if (value === undefined || /^access-control-/i.test(key)) continue;
            res.setHeader(key, value as string | string[]);
          }
          res.setHeader('access-control-allow-origin', '*');
          upstreamRes.pipe(res);
        });

        upstream.on('error', (error) => {
          console.error('[google-gemini-proxy] error:', error.message);
          res.statusCode = 502;
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ error: { message: 'Google Gemini API unavailable' } }));
        });
        req.pipe(upstream);
      });
    },
  };
}

export default defineConfig(async ({ mode }) => {
  const [{ default: tailwindcss }, { default: react }] = await Promise.all([
    import('@tailwindcss/vite'),
    import('@vitejs/plugin-react'),
  ]);
  const env = loadEnv(mode, __dirname, '');
  const geminiApiKey = env.GEMINI_API_KEY;
  const jdApiKey = env.JD_API_KEY;
  const isVercelBuild = Boolean(process.env.VERCEL);

  return {
  base: env.VITE_BASE_PATH || (isVercelBuild ? '/' : (mode === 'development' ? '/Lottie-key/' : '/JOYFlow/')),
  plugins: [react(), tailwindcss(), removeCrossorigin(), joyComposeBridge(), downloadAssetProxy(), remoteAssetProxy(), googleGeminiProxy(geminiApiKey)],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  server: {
    port: 3000,
    host: '0.0.0.0',
    watch: {
      ignored: ['**/public/atlas-style/**'],
    },
     proxy: {
      // JD GPT-Image-2 代理，解决 CORS 跨域问题
        '/jd-api': {
          target: 'http://llm-gw.jd.local',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/jd-api/, ''),
          timeout: 600000,
          proxyTimeout: 600000,
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            if (jdApiKey && !proxyReq.getHeader('authorization')) {
              proxyReq.setHeader('authorization', `Bearer ${jdApiKey}`);
            }
            console.log('[vite-proxy][jd-api] ->', req.method, req.url);
          });
          proxy.on('error', (err, req) => {
            console.error('[vite-proxy][jd-api] error:', err.message, '->', req.url);
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            console.log('[vite-proxy][jd-api] <-', proxyRes.statusCode, req.url);
          });
        },
      },
      // 火山引擎 TOS（豆包生成结果视频/图片）代理，解决 <video>/fetch 跨域
      '/tos-proxy': {
        target: 'https://ark-content-generation-cn-beijing.tos-cn-beijing.volces.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/tos-proxy/, ''),
        timeout: 300000,
        proxyTimeout: 300000,
        configure: (proxy) => {
          proxy.on('error', (err, req) => {
            console.error('[vite-proxy][tos-proxy] error:', err.message, '->', req.url);
          });
          proxy.on('proxyReq', (_proxyReq, req) => {
            console.log('[vite-proxy][tos-proxy] ->', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            console.log('[vite-proxy][tos-proxy] <-', proxyRes.statusCode, req.url);
          });
        },
      },
      // 火山引擎 Ark（豆包 Seedream/Seedance）代理，解决 CORS 跨域
      '/ark-api': {
        target: 'https://ark.cn-beijing.volces.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/ark-api/, ''),
        timeout: 300000,
        proxyTimeout: 300000,
        configure: (proxy) => {
          proxy.on('error', (err, req) => {
            console.error('[vite-proxy][ark-api] error:', err.message, '->', req.url);
          });
          proxy.on('proxyReq', (_proxyReq, req) => {
            console.log('[vite-proxy][ark-api] ->', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            console.log('[vite-proxy][ark-api] <-', proxyRes.statusCode, req.url);
          });
        },
      },
    },
  },
  build: {
    modulePreload: false,
  },
  };
});
