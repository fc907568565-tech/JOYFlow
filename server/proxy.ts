const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'content-length',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

export const proxyTo = async (
  request: Request,
  upstreamBase: string,
  routePrefix: string,
  options: { googleApiKey?: boolean; upstreamPath?: string; omitQueryParams?: string[] } = {},
) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS',
        'access-control-allow-headers': '*',
      },
    });
  }

  const incomingUrl = new URL(request.url, 'https://joyflow.invalid');
  const pathname = options.upstreamPath ?? (
    incomingUrl.pathname.startsWith(routePrefix)
      ? incomingUrl.pathname.slice(routePrefix.length)
      : incomingUrl.pathname
  );
  for (const param of options.omitQueryParams || []) incomingUrl.searchParams.delete(param);
  const upstreamUrl = new URL(`${pathname.startsWith('/') ? pathname : `/${pathname}`}${incomingUrl.search}`, upstreamBase);

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase()) && !/^x-forwarded-/i.test(key)) {
      headers.set(key, value);
    }
  });

  if (options.googleApiKey) {
    const authorization = headers.get('authorization') || '';
    const apiKey = authorization.replace(/^Bearer\s+/i, '').trim();
    headers.delete('authorization');
    if (apiKey) headers.set('x-goog-api-key', apiKey);
  }

  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
    redirect: 'manual',
  };
  if (!['GET', 'HEAD'].includes(request.method)) {
    init.body = request.body;
    init.duplex = 'half';
  }

  try {
    const upstream = await fetch(upstreamUrl, init);
    const responseHeaders = new Headers(upstream.headers);
    HOP_BY_HOP_HEADERS.forEach((header) => responseHeaders.delete(header));
    responseHeaders.set('access-control-allow-origin', '*');
    responseHeaders.set('cache-control', 'no-store');
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown upstream error';
    return Response.json({ error: { message: `上游服务不可用：${message}` } }, { status: 502 });
  }
};
