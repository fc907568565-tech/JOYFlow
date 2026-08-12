import { removeSemanticBackground } from './semanticBackgroundRemoval';

export interface SmartCutoutProgress {
  percent: number;
  label: string;
}

type ProgressListener = (progress: SmartCutoutProgress) => void;

const loadImage = (source: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('智能抠图结果解析失败'));
  image.src = source;
});

const normalizeTransparentOutput = async (source: string, outputSize = 700, paddingPercent = 10) => {
  const image = await loadImage(source);
  const sourceCanvas = document.createElement('canvas');
  sourceCanvas.width = image.naturalWidth;
  sourceCanvas.height = image.naturalHeight;
  const sourceContext = sourceCanvas.getContext('2d', { willReadFrequently: true });
  if (!sourceContext) throw new Error('当前浏览器不支持透明图处理');
  sourceContext.drawImage(image, 0, 0);
  const pixels = sourceContext.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  let minX = sourceCanvas.width;
  let minY = sourceCanvas.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < sourceCanvas.height; y += 1) {
    for (let x = 0; x < sourceCanvas.width; x += 1) {
      const alpha = pixels.data[(y * sourceCanvas.width + x) * 4 + 3];
      if (alpha <= 5) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) throw new Error('没有识别到可保留的主体');
  const subjectWidth = maxX - minX + 1;
  const subjectHeight = maxY - minY + 1;
  const padding = outputSize * Math.max(0, Math.min(35, paddingPercent)) / 100;
  const available = outputSize - padding * 2;
  const scale = Math.min(available / subjectWidth, available / subjectHeight);
  const drawWidth = subjectWidth * scale;
  const drawHeight = subjectHeight * scale;
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = outputSize;
  outputCanvas.height = outputSize;
  const outputContext = outputCanvas.getContext('2d');
  if (!outputContext) throw new Error('无法创建透明输出画布');
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
    drawHeight,
  );
  return outputCanvas.toDataURL('image/png');
};

export const runSmartCutout = async (
  sourceUrl: string,
  onProgress?: ProgressListener,
) => {
  onProgress?.({ percent: 8, label: '正在准备原始素材' });
  const requestUrl = /^https?:\/\//i.test(sourceUrl)
    ? `/remote-asset?u=${encodeURIComponent(sourceUrl)}`
    : sourceUrl;
  const sourceResponse = await fetch(requestUrl);
  if (!sourceResponse.ok) throw new Error('原始素材读取失败');
  const sourceBlob = await sourceResponse.blob();

  const semanticResult = await removeSemanticBackground(sourceBlob, ({ percent, label }) => {
    const mappedPercent = 12 + Math.round(percent * 0.76);
    onProgress?.({ percent: mappedPercent, label });
  });
  onProgress?.({ percent: 90, label: '正在整理尺寸与透明边缘' });
  const dataUrl = await normalizeTransparentOutput(semanticResult, 700, 10);
  onProgress?.({ percent: 100, label: '智能抠图完成' });
  return dataUrl;
};
