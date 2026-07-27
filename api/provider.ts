import { proxyTo } from '../server/proxy.js';

const PROVIDERS: Record<string, { base: string; googleApiKey?: boolean }> = {
  agnes: { base: 'https://apihub.agnes-ai.com/' },
  ark: { base: 'https://ark.cn-beijing.volces.com/' },
  google: { base: 'https://generativelanguage.googleapis.com/', googleApiKey: true },
  joy: { base: 'https://5r0lrpa77tvw.joyapp.jd.com/' },
  openai: { base: 'https://api.openai.com/' },
  siliconflow: { base: 'https://api.siliconflow.cn/' },
};

function handler(request: Request) {
  const url = new URL(request.url, 'https://joyflow.invalid');
  const providerName = url.searchParams.get('provider') || '';
  const upstreamPath = url.searchParams.get('path') || '/';
  const provider = PROVIDERS[providerName];
  if (!provider) {
    return Response.json({ error: { message: '不支持的模型供应商' } }, { status: 400 });
  }
  return proxyTo(request, provider.base, '/api/provider', {
    googleApiKey: provider.googleApiKey,
    upstreamPath,
    omitQueryParams: ['provider', 'path'],
  });
}

export const GET = handler;
export const HEAD = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const OPTIONS = handler;

export const config = { maxDuration: 300 };
