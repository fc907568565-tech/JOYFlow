export interface SolidBackgroundReport {
  pass: boolean;
  matchesExpected: boolean;
  detectedColor: string;
  expectedColor: string;
  confidence: number;
  inlierRatio: number;
  edgeVariation: number;
  expectedDistance: number;
  reason: string;
}

interface RgbColor {
  r: number;
  g: number;
  b: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const parseHex = (value: string): RgbColor => {
  const normalized = value.replace('#', '').trim();
  const expanded = normalized.length === 3
    ? normalized.split('').map((part) => `${part}${part}`).join('')
    : normalized;
  const parsed = /^[0-9a-f]{6}$/i.test(expanded) ? Number.parseInt(expanded, 16) : 0xff00ff;
  return { r: (parsed >> 16) & 255, g: (parsed >> 8) & 255, b: parsed & 255 };
};

const toHex = ({ r, g, b }: RgbColor) => `#${[r, g, b]
  .map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, '0'))
  .join('')}`;

const distance = (a: RgbColor, b: RgbColor) => Math.sqrt(
  ((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2) / 3,
);

const median = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const loadImage = (source: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('无法读取待检测图片'));
  image.src = source;
});

export const inspectSolidBackground = async (
  source: string,
  expectedColor: string,
): Promise<SolidBackgroundReport> => {
  const image = await loadImage(source);
  const maxSide = 480;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(24, Math.round(image.naturalWidth * scale));
  const height = Math.max(24, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('当前浏览器不支持背景检测');
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height).data;
  const band = Math.max(3, Math.round(Math.min(width, height) * 0.035));
  const step = Math.max(1, Math.round(Math.min(width, height) / 220));
  const samples: RgbColor[] = [];

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (x >= band && x < width - band && y >= band && y < height - band) continue;
      const offset = (y * width + x) * 4;
      if (pixels[offset + 3] < 180) continue;
      samples.push({ r: pixels[offset], g: pixels[offset + 1], b: pixels[offset + 2] });
    }
  }

  if (samples.length < 24) throw new Error('图片边缘样本不足，无法判断背景是否为纯色');
  const detected = {
    r: median(samples.map((sample) => sample.r)),
    g: median(samples.map((sample) => sample.g)),
    b: median(samples.map((sample) => sample.b)),
  };
  const deviations = samples.map((sample) => distance(sample, detected)).sort((a, b) => a - b);
  const inlierLimit = 24;
  const inlierRatio = deviations.filter((value) => value <= inlierLimit).length / deviations.length;
  const percentile90 = deviations[Math.min(deviations.length - 1, Math.floor(deviations.length * 0.9))];
  const edgeVariation = deviations.reduce((sum, value) => sum + value, 0) / deviations.length;
  const expected = parseHex(expectedColor);
  const expectedDistance = distance(detected, expected);
  const pass = inlierRatio >= 0.86 && percentile90 <= 36 && edgeVariation <= 16;
  const matchesExpected = expectedDistance <= 46;
  const uniformScore = clamp(1 - edgeVariation / 32, 0, 1);
  const confidence = Math.round(clamp((inlierRatio * 0.62 + uniformScore * 0.38) * 100, 0, 100));
  const reason = pass
    ? matchesExpected
      ? '背景边缘均匀，且与预设抠图色一致'
      : '背景边缘均匀，颜色与预设不同，已自动使用实际检测色'
    : inlierRatio < 0.86
      ? '画面边缘包含渐变、阴影、纹理或其他物体'
      : '背景色变化过大，不适合直接色键';

  return {
    pass,
    matchesExpected,
    detectedColor: toHex(detected),
    expectedColor: toHex(expected),
    confidence,
    inlierRatio,
    edgeVariation,
    expectedDistance,
    reason,
  };
};
