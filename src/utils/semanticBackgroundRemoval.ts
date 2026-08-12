export interface SemanticRemovalProgress {
  percent: number;
  label: string;
}

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.onerror = () => reject(new Error('透明图片读取失败'));
  reader.readAsDataURL(blob);
});

const progressLabel = (key: string) => {
  const normalized = key.toLowerCase();
  if (normalized.includes('model') || normalized.includes('onnx')) return '正在加载主体识别模型';
  if (normalized.includes('wasm') || normalized.includes('runtime')) return '正在准备智能抠图引擎';
  return '正在分析角色、小舞台与道具';
};

/**
 * Runs foreground segmentation entirely in the browser. The model is loaded only
 * when the user enters the cutout workflow, keeping the normal JOYFlow bundle light.
 */
export const removeSemanticBackground = async (
  source: string | Blob,
  onProgress?: (progress: SemanticRemovalProgress) => void,
) => {
  onProgress?.({ percent: 3, label: '正在启动智能抠图' });
  const { removeBackground } = await import('@imgly/background-removal');
  let highestProgress = 3;
  const modelPublicPath = new URL(
    `${import.meta.env.BASE_URL}cutout-model/`.replace(/^\/+/, '/'),
    window.location.origin,
  ).href;
  const blob = await removeBackground(source, {
    publicPath: modelPublicPath,
    model: 'isnet_fp16',
    device: 'cpu',
    output: { format: 'image/png', quality: 1 },
    progress: (key, current, total) => {
      if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) return;
      highestProgress = Math.max(highestProgress, Math.min(88, Math.round((current / total) * 88)));
      onProgress?.({ percent: highestProgress, label: progressLabel(key) });
    },
  });
  onProgress?.({ percent: 94, label: '正在细化透明边缘' });
  const dataUrl = await blobToDataUrl(blob);
  onProgress?.({ percent: 100, label: '智能抠图完成' });
  return dataUrl;
};

/**
 * ISNet deliberately keeps uncertain low-contrast edges semi-transparent. Micro
 * stages need those grass, base and shadow pixels to read as one solid object, so
 * lift meaningful alpha values while preserving a soft anti-aliased outer edge.
 */
export const strengthenSemanticForeground = (canvas: HTMLCanvasElement) => {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return canvas;
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 3; index < imageData.data.length; index += 4) {
    const alpha = imageData.data[index];
    if (alpha <= 4) {
      imageData.data[index] = 0;
      continue;
    }
    const normalized = (alpha - 4) / 251;
    imageData.data[index] = Math.round(255 * (normalized ** 0.44));
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
};
