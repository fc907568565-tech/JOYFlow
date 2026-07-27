import type { ChromaKeyOptions } from '../types';

export const hexToRgb = (hex: string) => {
  const r = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return r
    ? { r: parseInt(r[1], 16), g: parseInt(r[2], 16), b: parseInt(r[3], 16) }
    : { r: 0, g: 255, b: 0 };
};

export function applyChromaKey(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opts: ChromaKeyOptions
) {
  const { color, threshold, similarity, despill } = opts;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const target = hexToRgb(color);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const diff = Math.sqrt(
      (r - target.r) ** 2 + (g - target.g) ** 2 + (b - target.b) ** 2
    );
    if (diff < threshold) {
      data[i + 3] = 0;
    } else if (diff < threshold + threshold * similarity) {
      const f = (diff - threshold) / (threshold * similarity);
      data[i + 3] = 255 * f;
    }
    if (data[i + 3] > 0) {
      if (target.g > target.r && target.g > target.b) {
        const avg = (r + b) / 2;
        if (g > avg) data[i + 1] = g - (g - avg) * despill;
      } else if (target.r > target.g && target.r > target.b) {
        const avg = (g + b) / 2;
        if (r > avg) data[i] = r - (r - avg) * despill;
      }
    }
  }
  ctx.putImageData(imageData, 0, 0);
}