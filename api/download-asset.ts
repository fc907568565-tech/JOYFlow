import { GET as remoteAsset } from './remote-asset.js';

export async function GET(request: Request) {
  const response = await remoteAsset(request);
  if (!response.ok) return response;
  const headers = new Headers(response.headers);
  headers.set('content-disposition', `attachment; filename="joy-image-${Date.now()}.bin"`);
  return new Response(response.body, { status: response.status, headers });
}

export const config = { maxDuration: 300 };
