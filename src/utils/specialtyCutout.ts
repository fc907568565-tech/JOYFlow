import type { SpecialtyCutoutSettings } from './specialtyWorkflow';

export const DEFAULT_SPECIALTY_CUTOUT_SETTINGS: SpecialtyCutoutSettings = {
  threshold: 42,
  feather: 14,
  shadowCleanup: 52,
  edgeCleanup: 46,
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

const parseBackgroundColor = (value?: string) => {
  if (!value) return null;
  const normalized = value.replace('#', '').trim();
  if (!/^[0-9a-f]{3}([0-9a-f]{3})?$/i.test(normalized)) return null;
  const expanded = normalized.length === 3
    ? normalized.split('').map((part) => `${part}${part}`).join('')
    : normalized;
  const color = Number.parseInt(expanded, 16);
  return [(color >> 16) & 255, (color >> 8) & 255, color & 255] as const;
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
  maxProcessSide = 1400,
  backgroundColor?: string,
  adaptiveBackground = false,
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
    const background = parseBackgroundColor(backgroundColor) || estimateBackground(pixels, width, height);
    const count = width * height;
    const connected = new Uint8Array(count);
    const queued = new Uint8Array(count);
    const queue = new Int32Array(count);
    let head = 0;
    let tail = 0;
    const featherRange = Math.max(1, settings.feather * 2.5);
    const searchLimit = settings.threshold + featherRange;
    const backgroundLuminance = background[0] * 0.299 + background[1] * 0.587 + background[2] * 0.114;
    const shadowSearchLimit = searchLimit + settings.shadowCleanup * 0.82;

    const distanceAt = (pixelIndex: number) => {
      const offset = pixelIndex * 4;
      const dr = pixels[offset] - background[0];
      const dg = pixels[offset + 1] - background[1];
      const db = pixels[offset + 2] - background[2];
      return Math.sqrt((dr * dr + dg * dg + db * db) / 3);
    };
    const colorStepAt = (pixelIndex: number, sourceIndex: number) => {
      const offset = pixelIndex * 4;
      const sourceOffset = sourceIndex * 4;
      const dr = pixels[offset] - pixels[sourceOffset];
      const dg = pixels[offset + 1] - pixels[sourceOffset + 1];
      const db = pixels[offset + 2] - pixels[sourceOffset + 2];
      return Math.sqrt((dr * dr + dg * dg + db * db) / 3);
    };
    const isBackgroundCandidate = (pixelIndex: number, sourceIndex = -1) => {
      const distance = distanceAt(pixelIndex);
      if (distance <= searchLimit) return true;
      if (adaptiveBackground && sourceIndex >= 0) {
        const adaptiveStep = 12 + settings.threshold * 0.18;
        const adaptiveDistanceLimit = searchLimit + 92;
        if (distance <= adaptiveDistanceLimit && colorStepAt(pixelIndex, sourceIndex) <= adaptiveStep) return true;
      }
      if (settings.shadowCleanup <= 0 || distance > shadowSearchLimit) return false;
      const offset = pixelIndex * 4;
      const red = pixels[offset];
      const green = pixels[offset + 1];
      const blue = pixels[offset + 2];
      const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
      const luminance = red * 0.299 + green * 0.587 + blue * 0.114;
      const neutralLimit = 24 + settings.shadowCleanup * 0.28;
      const darknessLimit = 34 + settings.shadowCleanup * 0.72;
      return chroma <= neutralLimit && luminance >= backgroundLuminance - darknessLimit;
    };
    const enqueue = (pixelIndex: number, sourceIndex = -1) => {
      if (queued[pixelIndex] || !isBackgroundCandidate(pixelIndex, sourceIndex)) return;
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
      if (x > 0) enqueue(pixelIndex - 1, pixelIndex);
      if (x < width - 1) enqueue(pixelIndex + 1, pixelIndex);
      if (y > 0) enqueue(pixelIndex - width, pixelIndex);
      if (y < height - 1) enqueue(pixelIndex + width, pixelIndex);
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
        const shadowThreshold = settings.threshold + settings.shadowCleanup * 0.56;
        const edgeAlpha = distance <= shadowThreshold
          ? 0
          : clamp(((distance - shadowThreshold) / featherRange) * 255);
        alpha = Math.min(alpha, edgeAlpha);
      }
      if (alpha > 0 && alpha < 255 && settings.edgeCleanup > 0) {
        const cleanup = settings.edgeCleanup / 100;
        const originalAlpha = alpha / 255;
        const matteAlpha = Math.max(0.025, originalAlpha);
        const recoveredRed = (pixels[offset] - background[0] * (1 - originalAlpha)) / matteAlpha;
        const recoveredGreen = (pixels[offset + 1] - background[1] * (1 - originalAlpha)) / matteAlpha;
        const recoveredBlue = (pixels[offset + 2] - background[2] * (1 - originalAlpha)) / matteAlpha;
        pixels[offset] = clamp(pixels[offset] + (recoveredRed - pixels[offset]) * cleanup);
        pixels[offset + 1] = clamp(pixels[offset + 1] + (recoveredGreen - pixels[offset + 1]) * cleanup);
        pixels[offset + 2] = clamp(pixels[offset + 2] + (recoveredBlue - pixels[offset + 2]) * cleanup);
        const transparentCutoff = settings.edgeCleanup * 0.52;
        if (alpha <= transparentCutoff) alpha = 0;
        else {
          const normalized = (alpha - transparentCutoff) / Math.max(1, 255 - transparentCutoff);
          alpha = clamp((normalized ** (1 - cleanup * 0.28)) * 255);
        }
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
