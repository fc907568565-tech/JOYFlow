export type SemanticLayerName = '角色 / 主体' | '小舞台' | '关联道具' | '补充元素';

export interface SemanticLayerPoint {
  id: string;
  x: number;
  y: number;
  kind: 'keep' | 'remove';
  layer: SemanticLayerName;
}

export interface SemanticLayerProgress {
  percent: number;
  label: string;
}

export interface SemanticLayerObject {
  id: string;
  name: string;
  category: 'subject' | 'stage' | 'prop';
  box: [number, number, number, number];
  point: [number, number];
  reason: string;
}

interface LoadedSegmenter {
  model: any;
  processor: any;
  RawImage: any;
  Tensor: any;
  backend: 'webgpu' | 'wasm';
}

interface EncodedImage {
  source: string;
  rawImage: any;
  processed: any;
  embeddings: Record<string, any>;
}

const MODEL_ID = 'Xenova/slimsam-77-uniform';
const modelProgressListeners = new Set<(progress: SemanticLayerProgress) => void>();
let segmenterPromise: Promise<LoadedSegmenter> | null = null;
let encodedImage: EncodedImage | null = null;

const emitModelProgress = (progress: SemanticLayerProgress) => {
  modelProgressListeners.forEach((listener) => listener(progress));
};

const getSegmenter = async (onProgress?: (progress: SemanticLayerProgress) => void) => {
  if (onProgress) modelProgressListeners.add(onProgress);
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      emitModelProgress({ percent: 5, label: '正在准备语义分层引擎' });
      const { SamModel, AutoProcessor, RawImage, Tensor } = await import('@huggingface/transformers');
      const hasWebGpu = typeof navigator !== 'undefined' && 'gpu' in navigator;
      let backend: LoadedSegmenter['backend'] = hasWebGpu ? 'webgpu' : 'wasm';
      const progressCallback = (event: { status?: string; progress?: number; file?: string }) => {
        if (event.status === 'progress' && Number.isFinite(event.progress)) {
          emitModelProgress({
            percent: Math.max(6, Math.min(48, Math.round(6 + (event.progress as number) * 0.42))),
            label: '首次使用：正在加载分割模型',
          });
        }
      };
      const modelOptions: Record<string, unknown> = {
        dtype: hasWebGpu ? 'fp16' : 'q8',
        progress_callback: progressCallback,
      };
      if (hasWebGpu) modelOptions.device = 'webgpu';
      let model;
      try {
        model = await SamModel.from_pretrained(MODEL_ID, modelOptions);
      } catch (error) {
        if (!hasWebGpu) throw error;
        backend = 'wasm';
        emitModelProgress({ percent: 16, label: 'GPU 不可用，正在切换兼容模式' });
        model = await SamModel.from_pretrained(MODEL_ID, {
          dtype: 'q8',
          progress_callback: progressCallback,
        });
      }
      const processor = await AutoProcessor.from_pretrained(MODEL_ID, {
        progress_callback: (event: { status?: string; progress?: number }) => {
          if (event.status === 'progress' && Number.isFinite(event.progress)) {
            emitModelProgress({ percent: 50, label: '正在准备图像处理器' });
          }
        },
      });
      emitModelProgress({ percent: 52, label: '语义分层模型已就绪' });
      return { model, processor, RawImage, Tensor, backend };
    })().catch((error) => {
      segmenterPromise = null;
      throw error;
    });
  }
  try {
    return await segmenterPromise;
  } finally {
    if (onProgress) modelProgressListeners.delete(onProgress);
  }
};

const sigmoid = (value: number) => 1 / (1 + Math.exp(-value));

const smoothstep = (edge0: number, edge1: number, value: number) => {
  const normalized = Math.min(1, Math.max(0, (value - edge0) / Math.max(0.0001, edge1 - edge0)));
  return normalized * normalized * (3 - 2 * normalized);
};

const loadBrowserImage = (source: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('分层原图加载失败'));
  image.src = source;
});

/**
 * Point-guided semantic layering. Every keep point is segmented independently,
 * then the masks are merged so visually related but disconnected props can remain.
 * Remove points are included as negative prompts for every semantic layer.
 */
export const segmentSemanticLayers = async (
  source: string,
  points: SemanticLayerPoint[],
  onProgress?: (progress: SemanticLayerProgress) => void,
) => {
  const keepPoints = points.filter((point) => point.kind === 'keep');
  const removePoints = points.filter((point) => point.kind === 'remove');
  if (keepPoints.length === 0) throw new Error('请先在图上点选至少一个需要保留的对象');

  onProgress?.({ percent: 2, label: '正在启动语义分层' });
  const segmenter = await getSegmenter(onProgress);
  onProgress?.({ percent: 54, label: `正在用 ${segmenter.backend === 'webgpu' ? 'GPU' : 'CPU'} 理解画面` });

  if (!encodedImage || encodedImage.source !== source) {
    const rawImage = await segmenter.RawImage.fromURL(source);
    const processed = await segmenter.processor(rawImage);
    onProgress?.({ percent: 60, label: '正在提取画面结构特征' });
    const embeddings = await segmenter.model.get_image_embeddings(processed);
    encodedImage = { source, rawImage, processed, embeddings };
  }

  const { rawImage, processed, embeddings } = encodedImage;
  const width = rawImage.width as number;
  const height = rawImage.height as number;
  const pixelCount = width * height;
  const mergedConfidence = new Float32Array(pixelCount);
  const reshaped = processed.reshaped_input_sizes[0] as [number, number];

  for (let keepIndex = 0; keepIndex < keepPoints.length; keepIndex += 1) {
    const keepPoint = keepPoints[keepIndex];
    const promptPoints = [keepPoint, ...removePoints];
    const coordinates = promptPoints.flatMap((point) => [point.x * reshaped[1], point.y * reshaped[0]]);
    const labels = promptPoints.map((point) => BigInt(point.kind === 'keep' ? 1 : 0));
    const inputPoints = new segmenter.Tensor('float32', coordinates, [1, 1, promptPoints.length, 2]);
    const inputLabels = new segmenter.Tensor('int64', labels, [1, 1, promptPoints.length]);
    const { pred_masks: predMasks, iou_scores: iouScores } = await segmenter.model({
      ...embeddings,
      input_points: inputPoints,
      input_labels: inputLabels,
    });
    inputPoints.dispose?.();
    inputLabels.dispose?.();

    const masks = await segmenter.processor.post_process_masks(
      predMasks,
      processed.original_sizes,
      processed.reshaped_input_sizes,
      { binarize: false },
    );
    const mask = masks[0];
    const maskCount = mask.dims[1] || 3;
    let bestMaskIndex = 0;
    for (let maskIndex = 1; maskIndex < maskCount; maskIndex += 1) {
      if (Number(iouScores.data[maskIndex]) > Number(iouScores.data[bestMaskIndex])) bestMaskIndex = maskIndex;
    }
    const maskOffset = bestMaskIndex * pixelCount;
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      const confidence = sigmoid(Number(mask.data[maskOffset + pixelIndex]));
      if (confidence > mergedConfidence[pixelIndex]) mergedConfidence[pixelIndex] = confidence;
    }
    mask.dispose?.();
    predMasks.dispose?.();
    iouScores.dispose?.();
    onProgress?.({
      percent: Math.round(64 + ((keepIndex + 1) / keepPoints.length) * 25),
      label: `正在合并“${keepPoint.layer}” ${keepIndex + 1}/${keepPoints.length}`,
    });
  }

  onProgress?.({ percent: 91, label: '正在精修边缘与透明度' });
  const image = await loadBrowserImage(source);
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const context = output.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法创建透明图片');
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const alpha = smoothstep(0.42, 0.58, mergedConfidence[pixelIndex]);
    pixels.data[pixelIndex * 4 + 3] = Math.round(alpha * 255);
  }
  context.putImageData(pixels, 0, 0);
  onProgress?.({ percent: 100, label: '语义分层完成' });
  return output.toDataURL('image/png');
};

/**
 * Segments image-understanding results without user interaction. Each semantic
 * object uses both a bounding box and an inner point, which is significantly
 * more stable than relying on a single click for complex subjects.
 */
export const segmentSemanticLayerObjects = async (
  source: string,
  objects: SemanticLayerObject[],
  onProgress?: (progress: SemanticLayerProgress) => void,
) => {
  if (objects.length === 0) throw new Error('图像理解没有返回需要保留的画面层');
  onProgress?.({ percent: 30, label: '正在启动对象分割引擎' });
  const segmenter = await getSegmenter((progress) => {
    onProgress?.({
      percent: Math.round(30 + progress.percent * 0.34),
      label: progress.label,
    });
  });
  onProgress?.({ percent: 49, label: `正在用 ${segmenter.backend === 'webgpu' ? 'GPU' : 'CPU'} 提取画面结构` });

  if (!encodedImage || encodedImage.source !== source) {
    const rawImage = await segmenter.RawImage.fromURL(source);
    const processed = await segmenter.processor(rawImage);
    const embeddings = await segmenter.model.get_image_embeddings(processed);
    encodedImage = { source, rawImage, processed, embeddings };
  }

  const { rawImage, processed, embeddings } = encodedImage;
  const width = rawImage.width as number;
  const height = rawImage.height as number;
  const pixelCount = width * height;
  const mergedConfidence = new Float32Array(pixelCount);
  const reshaped = processed.reshaped_input_sizes[0] as [number, number];
  const reshapedHeight = reshaped[0];
  const reshapedWidth = reshaped[1];

  for (let objectIndex = 0; objectIndex < objects.length; objectIndex += 1) {
    const object = objects[objectIndex];
    const [x1, y1, x2, y2] = object.box;
    const [pointX, pointY] = object.point;
    const inputPoints = new segmenter.Tensor(
      'float32',
      [pointX * reshapedWidth, pointY * reshapedHeight],
      [1, 1, 1, 2],
    );
    const inputLabels = new segmenter.Tensor('int64', [BigInt(1)], [1, 1, 1]);
    const inputBoxes = new segmenter.Tensor(
      'float32',
      [x1 * reshapedWidth, y1 * reshapedHeight, x2 * reshapedWidth, y2 * reshapedHeight],
      [1, 1, 4],
    );
    const { pred_masks: predMasks, iou_scores: iouScores } = await segmenter.model({
      ...embeddings,
      input_points: inputPoints,
      input_labels: inputLabels,
      input_boxes: inputBoxes,
    });
    inputPoints.dispose?.();
    inputLabels.dispose?.();
    inputBoxes.dispose?.();

    const masks = await segmenter.processor.post_process_masks(
      predMasks,
      processed.original_sizes,
      processed.reshaped_input_sizes,
      { binarize: false },
    );
    const mask = masks[0];
    const maskCount = mask.dims[1] || 3;
    const boxLeft = Math.max(0, Math.floor(x1 * width));
    const boxTop = Math.max(0, Math.floor(y1 * height));
    const boxRight = Math.min(width - 1, Math.ceil(x2 * width));
    const boxBottom = Math.min(height - 1, Math.ceil(y2 * height));
    const boxPixelCount = Math.max(1, (boxRight - boxLeft + 1) * (boxBottom - boxTop + 1));
    const pointPixelIndex = Math.min(height - 1, Math.max(0, Math.round(pointY * height))) * width
      + Math.min(width - 1, Math.max(0, Math.round(pointX * width)));
    const targetCoverage = object.category === 'stage' ? 0.62 : object.category === 'subject' ? 0.5 : 0.42;
    let bestMaskIndex = 0;
    let bestCandidateScore = Number.NEGATIVE_INFINITY;
    for (let maskIndex = 0; maskIndex < maskCount; maskIndex += 1) {
      const candidateOffset = maskIndex * pixelCount;
      let insidePixels = 0;
      let outsidePixels = 0;
      for (let pixelY = 0; pixelY < height; pixelY += 1) {
        for (let pixelX = 0; pixelX < width; pixelX += 1) {
          const pixelIndex = pixelY * width + pixelX;
          if (Number(mask.data[candidateOffset + pixelIndex]) <= 0) continue;
          if (pixelX >= boxLeft && pixelX <= boxRight && pixelY >= boxTop && pixelY <= boxBottom) insidePixels += 1;
          else outsidePixels += 1;
        }
      }
      const coverage = insidePixels / boxPixelCount;
      const outsideRatio = outsidePixels / Math.max(1, insidePixels + outsidePixels);
      const containsPoint = Number(mask.data[candidateOffset + pointPixelIndex]) > 0;
      const candidateScore = (containsPoint ? 0.65 : -0.65)
        - Math.abs(coverage - targetCoverage) * 1.25
        - outsideRatio * 1.8
        + Number(iouScores.data[maskIndex]) * 0.12;
      if (candidateScore > bestCandidateScore) {
        bestCandidateScore = candidateScore;
        bestMaskIndex = maskIndex;
      }
    }
    const maskOffset = bestMaskIndex * pixelCount;
    const clipMarginX = Math.max(2, Math.round(width * 0.012));
    const clipMarginY = Math.max(2, Math.round(height * 0.012));
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      const pixelX = pixelIndex % width;
      const pixelY = Math.floor(pixelIndex / width);
      if (
        pixelX < boxLeft - clipMarginX
        || pixelX > boxRight + clipMarginX
        || pixelY < boxTop - clipMarginY
        || pixelY > boxBottom + clipMarginY
      ) continue;
      const confidence = sigmoid(Number(mask.data[maskOffset + pixelIndex]));
      if (confidence > mergedConfidence[pixelIndex]) mergedConfidence[pixelIndex] = confidence;
    }
    mask.dispose?.();
    predMasks.dispose?.();
    iouScores.dispose?.();
    onProgress?.({
      percent: Math.round(57 + ((objectIndex + 1) / objects.length) * 34),
      label: `正在抠出“${object.name}” ${objectIndex + 1}/${objects.length}`,
    });
  }

  onProgress?.({ percent: 94, label: '正在合并关联对象并精修边缘' });
  const image = await loadBrowserImage(source);
  const output = document.createElement('canvas');
  output.width = width;
  output.height = height;
  const context = output.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法创建透明图片');
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    const alpha = smoothstep(0.4, 0.56, mergedConfidence[pixelIndex]);
    pixels.data[pixelIndex * 4 + 3] = Math.round(alpha * 255);
  }
  context.putImageData(pixels, 0, 0);
  onProgress?.({ percent: 100, label: '关联对象抠图完成' });
  return output.toDataURL('image/png');
};
