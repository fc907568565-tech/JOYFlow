import type { SpecialtyCutoutSettings } from './specialtyWorkflow';

export const DEFAULT_SPECIALTY_CUTOUT_SETTINGS: SpecialtyCutoutSettings = {
  threshold: 42,
  feather: 14,
  padding: 12,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
};

const clamp = (value: number, min = 0, max = 255) => Math.min(max, Math.max(min, value));

interface PreparedSource {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

const preparedSourceCache = new Map<string, Promise<PreparedSource>>();

const sourceToBlob = async (source: string): Promise<Blob> => {
  const requestUrl = /^https?:\/\//i.test(source)
    ? `/remote-asset?u=${encodeURIComponent(source)}`
    : source;
  const response = await fetch(requestUrl);
  if (!response.ok) throw new Error('无法读取候选图片');
  return response.blob();
};

const prepareSource = async (source: string, maxProcessSide: number): Promise<PreparedSource> => {
  const cacheKey = `${source}::${maxProcessSide}`;
  const cached = preparedSourceCache.get(cacheKey);
  if (cached) return cached;
  const task = (async () => {
  const blob = await sourceToBlob(source);
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('候选图片解析失败'));
      image.src = objectUrl;
    });
      const scale = Math.min(1, maxProcessSide / Math.max(image.naturalWidth, image.naturalHeight));
      const width = Math.max(1, Math.round(image.naturalWidth * scale));
      const height = Math.max(1, Math.round(image.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('当前浏览器不支持图片处理');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(image, 0, 0, width, height);
      return {
        width,
        height,
        pixels: new Uint8ClampedArray(context.getImageData(0, 0, width, height).data),
      };
  } finally {
      URL.revokeObjectURL(objectUrl);
  }
  })();
  preparedSourceCache.set(cacheKey, task);
  try {
    return await task;
  } catch (error) {
    preparedSourceCache.delete(cacheKey);
    throw error;
  }
};

const estimateBackground = (data: Uint8ClampedArray, width: number, height: number) => {
  const patch = Math.max(3, Math.round(Math.min(width, height) * 0.035));
  const samples: number[] = [];
  const corners = [
    [0, 0],
    [width - patch, 0],
    [0, height - patch],
    [width - patch, height - patch],
  ];
  for (const [startX, startY] of corners) {
    for (let y = startY; y < Math.min(height, startY + patch); y += 2) {
      for (let x = startX; x < Math.min(width, startX + patch); x += 2) {
        const offset = (y * width + x) * 4;
        if (data[offset + 3] < 16) continue;
        samples.push(data[offset], data[offset + 1], data[offset + 2]);
      }
    }
  }
  if (!samples.length) return [255, 255, 255] as const;
  const channels: number[][] = [[], [], []];
  for (let index = 0; index < samples.length; index += 3) {
    channels[0].push(samples[index]);
    channels[1].push(samples[index + 1]);
    channels[2].push(samples[index + 2]);
  }
  channels.forEach((channel) => channel.sort((a, b) => a - b));
  const middle = Math.floor(channels[0].length / 2);
  return [channels[0][middle], channels[1][middle], channels[2][middle]] as const;
};

const applyColorAdjustments = (
  red: number,
  green: number,
  blue: number,
  settings: SpecialtyCutoutSettings
) => {
  const brightness = settings.brightness * 2.2;
  const contrast = 1 + settings.contrast / 100;
  const saturation = 1 + settings.saturation / 100;
  const temperature = settings.temperature * 0.65;
  let r = (red - 128) * contrast + 128 + brightness + temperature;
  let g = (green - 128) * contrast + 128 + brightness;
  let b = (blue - 128) * contrast + 128 + brightness - temperature;
  const luminance = r * 0.299 + g * 0.587 + b * 0.114;
  r = luminance + (r - luminance) * saturation;
  g = luminance + (g - luminance) * saturation;
  b = luminance + (b - luminance) * saturation;
  return [clamp(r), clamp(g), clamp(b)] as const;
};

export const renderSpecialtyCutout = async (
  source: string,
  settings: SpecialtyCutoutSettings,
  outputSize = 700,
  maxProcessSide = 1400
): Promise<string> => {
    const prepared = await prepareSource(source, maxProcessSide);
    const { width, height } = prepared;
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = width;
    sourceCanvas.height = height;
    const context = sourceCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('当前浏览器不支持图片处理');
    const imageData = new ImageData(new Uint8ClampedArray(prepared.pixels), width, height);
    const pixels = imageData.data;
    const background = estimateBackground(pixels, width, height);
    const count = width * height;
    const connected = new Uint8Array(count);
    const queued = new Uint8Array(count);
    const queue = new Int32Array(count);
    let head = 0;
    let tail = 0;
    const featherRange = Math.max(1, settings.feather * 2.5);
    const searchLimit = settings.threshold + featherRange;

    const distanceAt = (pixelIndex: number) => {
      const offset = pixelIndex * 4;
      const dr = pixels[offset] - background[0];
      const dg = pixels[offset + 1] - background[1];
      const db = pixels[offset + 2] - background[2];
      return Math.sqrt((dr * dr + dg * dg + db * db) / 3);
    };
    const enqueue = (pixelIndex: number) => {
      if (queued[pixelIndex] || distanceAt(pixelIndex) > searchLimit) return;
      queued[pixelIndex] = 1;
      queue[tail] = pixelIndex;
      tail += 1;
    };

    for (let x = 0; x < width; x += 1) {
      enqueue(x);
      enqueue((height - 1) * width + x);
    }
    for (let y = 1; y < height - 1; y += 1) {
      enqueue(y * width);
      enqueue(y * width + width - 1);
    }

    while (head < tail) {
      const pixelIndex = queue[head];
      head += 1;
      connected[pixelIndex] = 1;
      const x = pixelIndex % width;
      const y = Math.floor(pixelIndex / width);
      if (x > 0) enqueue(pixelIndex - 1);
      if (x < width - 1) enqueue(pixelIndex + 1);
      if (y > 0) enqueue(pixelIndex - width);
      if (y < height - 1) enqueue(pixelIndex + width);
    }

    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let pixelIndex = 0; pixelIndex < count; pixelIndex += 1) {
      const offset = pixelIndex * 4;
      let alpha = pixels[offset + 3];
      if (connected[pixelIndex]) {
        const distance = distanceAt(pixelIndex);
        const edgeAlpha = distance <= settings.threshold
          ? 0
          : clamp(((distance - settings.threshold) / featherRange) * 255);
        alpha = Math.min(alpha, edgeAlpha);
      }
      pixels[offset + 3] = alpha;
      if (alpha > 8) {
        const adjusted = applyColorAdjustments(
          pixels[offset],
          pixels[offset + 1],
          pixels[offset + 2],
          settings
        );
        pixels[offset] = adjusted[0];
        pixels[offset + 1] = adjusted[1];
        pixels[offset + 2] = adjusted[2];
        const x = pixelIndex % width;
        const y = Math.floor(pixelIndex / width);
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    context.putImageData(imageData, 0, 0);

    if (maxX < minX || maxY < minY) throw new Error('没有识别到可保留的道具主体，请降低背景去除强度');
    const subjectWidth = maxX - minX + 1;
    const subjectHeight = maxY - minY + 1;
    const paddingPixels = outputSize * clamp(settings.padding, 0, 35) / 100;
    const available = Math.max(1, outputSize - paddingPixels * 2);
    const outputScale = Math.min(available / subjectWidth, available / subjectHeight);
    const drawWidth = subjectWidth * outputScale;
    const drawHeight = subjectHeight * outputScale;
    const outputCanvas = document.createElement('canvas');
    outputCanvas.width = outputSize;
    outputCanvas.height = outputSize;
    const outputContext = outputCanvas.getContext('2d');
    if (!outputContext) throw new Error('无法创建透明输出画布');
    outputContext.clearRect(0, 0, outputSize, outputSize);
    outputContext.imageSmoothingEnabled = true;
    outputContext.imageSmoothingQuality = 'high';
    outputContext.drawImage(
      sourceCanvas,
      minX,
      minY,
      subjectWidth,
      subjectHeight,
      (outputSize - drawWidth) / 2,
      (outputSize - drawHeight) / 2,
      drawWidth,
      drawHeight
    );
    return outputCanvas.toDataURL('image/png');
};
