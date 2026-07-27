const PRIVATE_HOST = /^(?:localhost|127\.|0\.0\.0\.0$|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[?::1\]?$)/i;

export async function GET(request: Request) {
  const raw = new URL(request.url, 'https://joyflow.invalid').searchParams.get('u');
  if (!raw) return new Response('missing u', { status: 400 });

  try {
    const target = new URL(raw);
    if (!['https:', 'http:'].includes(target.protocol) || PRIVATE_HOST.test(target.hostname)) {
      return new Response('unsupported asset URL', { status: 400 });
    }
    const headers = new Headers({ 'user-agent': request.headers.get('user-agent') || 'Mozilla/5.0' });
    const range = request.headers.get('range');
    if (range) headers.set('range', range);
    const upstream = await fetch(target, { method: request.method, headers, redirect: 'follow' });
    const responseHeaders = new Headers(upstream.headers);
    responseHeaders.set('access-control-allow-origin', '*');
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  } catch {
    return new Response('bad asset URL', { status: 400 });
  }
}

export const HEAD = GET;
export const OPTIONS = GET;

export const config = { maxDuration: 300 };
