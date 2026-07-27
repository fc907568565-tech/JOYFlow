import type{
  GeneratePayload,
  GenerateTask,
  ModelConfig,
  NormalizedTaskResult,
} from './types';
import { ensureImageUrl } from '../utils/imageUpload';

const withSlash = (s: string) => (s.startsWith('/') ? s : `/${s}`);

// 智能解析图片输入（用于 OpenAI 兼容 API 的 image 字段）：
// - 已是 http(s) URL：原样返回
// - 已是 data URL：原样返回（保留 "data:image/xxx;base64," 前缀）
// - 是裸 base64：补上 "data:image/png;base64," 前缀返回 data URL
// - 若配置了 imgbbApiKey 会优先尝试上传获取 http URL；失败则回退到 data URL
// 说明：Agnes 等 API 的 extra_body.image 拒绝裸 base64（会报 "invalid input image"），
//       同时也不能有 base64 长度不为 4 倍数的问题——data URL 形式是最兼容的选择。
const resolveImageInput = async (
  img: string,
  imgbbKey: string
): Promise<string> => {
  if (!img) return '';
  if (img.startsWith('http://') || img.startsWith('https://')) return img;
  if (imgbbKey) {
    try {
      return await ensureImageUrl(img, imgbbKey);
    } catch (e) {
      console.warn('[AI-Debug] imgbb 上传失败，回退到 data URL:', e);
    }
  }
  // 保证返回 data URL（Agnes、多数 OpenAI 兼容 API 均可接受）
  if (img.startsWith('data:image/')) return img;
  return `data:image/png;base64,${img}`;
};

const toBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
};

const toGeminiInlineData = async (image: string) => {
  const dataUrlMatch = image.match(/^data:(image\/[\w.+-]+);base64,(.+)$/s);
  if (dataUrlMatch) {
    return { mime_type: dataUrlMatch[1], data: dataUrlMatch[2].replace(/\s/g, '') };
  }

  const source = /^https?:\/\//i.test(image)
    ? `/remote-asset?u=${encodeURIComponent(image)}`
    : image;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`参考图片读取失败 (HTTP ${response.status})`);
  const blob = await response.blob();
  return {
    mime_type: blob.type.startsWith('image/') ? blob.type : 'image/png',
    data: toBase64(new Uint8Array(await blob.arrayBuffer())),
  };
};

const normalizeArkBaseUrl = (baseUrl: string) =>
  /ark\.cn-beijing\.volces\.com|volcengine\.com/i.test(baseUrl)
    ? (import.meta.env.DEV ? '/ark-api' : '/api/ark')
    : baseUrl;

const blobToDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('Image conversion failed'));
  reader.readAsDataURL(blob);
});

// Ark cannot read browser-only blob: URLs. Preserve public URLs and data URLs,
// but materialize local/proxied assets as a data URL before submitting them.
const resolveArkImageInput = async (image: string, imgbbKey = ''): Promise<string> => {
  if (!image) return '';
  if (/^data:image\//i.test(image)) return image;

  if (/^https?:\/\//i.test(image)) return image;

  if (imgbbKey) {
    try {
      return await ensureImageUrl(image, imgbbKey);
    } catch (error) {
      console.warn('[AI-Debug] Ark image upload failed, falling back to base64:', error);
    }
  }

  const response = await fetch(image);
  if (!response.ok) throw new Error(`Unable to read keyframe image (HTTP ${response.status})`);
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('The selected keyframe is not an image');
  return blobToDataUrl(blob);
};

// 构建请求URL
const buildUrl = (baseUrl: string, path: string) => {
  const base = baseUrl.replace(/\/$/, '');
  return `${base}${withSlash(path)}`;
};

const pushResultUrl = (urls: string[], value: unknown, mime = 'image/png') => {
  if (typeof value !== 'string') return;
  const v = value.trim();
  if (!v) return;
  if (/^(https?:|data:|blob:)/i.test(v) || /^\/(?!\/)/.test(v)) {
    urls.push(v);
    return;
  }
  if (v.length > 200 && /^[A-Za-z0-9+/=\s]+$/.test(v)) {
    urls.push(`data:${mime};base64,${v.replace(/\s/g, '')}`);
  }
};

const normalizeResult = (raw: any): NormalizedTaskResult => {
  // 调试日志：输出原始API响应，帮助排查Agnes AI返回格式
  // Avoid stringifying base64 image responses; it can block the UI for seconds.

  const statusRaw = String(
    raw?.status ?? raw?.state ?? raw?.data?.status ?? raw?.task?.status ?? raw?.task_status ?? raw?.video?.status ?? ''
  ).toLowerCase();

  const succeeded = ['succeeded', 'success', 'done', 'completed', 'finish', 'finished', 'complete'].includes(statusRaw);
  const failed = ['failed', 'error', 'canceled', 'cancelled', 'fail'].includes(statusRaw);
  const running = ['running', 'processing', 'in_progress', 'pending', 'queued', 'submitted', 'generating', 'created', 'starting', 'waiting'].includes(statusRaw);

  const urls: string[] = [];
  const candidates = [
    raw?.url,
    raw?.result_url,
    raw?.video_url,
    raw?.image_url,
    raw?.download_url,
    raw?.remixed_from_video_id, // Agnes AI 视频: 实际存放视频URL的字段
    raw?.content?.video_url, // 火山引擎 Ark: content.video_url (content为对象)
    raw?.content?.image_url,
    raw?.content?.url,
    raw?.data?.url,
    raw?.data?.result_url,
    raw?.data?.video_url,
    raw?.data?.image,
    raw?.data?.image_url,
    raw?.data?.download_url,
    raw?.data?.b64_json,
    raw?.data?.base64,
    raw?.result?.url,
    raw?.result?.image,
    raw?.result?.result_url,
    raw?.result?.image_url,
    raw?.result?.video_url,
    raw?.result?.download_url,
    raw?.result?.b64_json,
    raw?.result?.base64,
    raw?.video?.url,
    raw?.video?.download_url,
    raw?.video?.video_url,
    raw?.output?.video_url,
    raw?.output?.image,
    raw?.output?.image_url,
    raw?.output?.url,
    raw?.output?.download_url,
    raw?.output?.b64_json,
    raw?.output?.base64,
  ];

  for (const c of candidates) {
    pushResultUrl(urls, c);
  }

  const arrays = [
    raw?.urls,
    raw?.outputs,
    raw?.images,
    raw?.videos,
    raw?.data,
    raw?.data?.urls,
    raw?.data?.images,
    raw?.data?.videos,
    raw?.data?.image,
    raw?.output,
    raw?.output?.images,
    raw?.output?.urls,
    raw?.output?.results,
    raw?.data?.output,
    raw?.data?.output?.images,
    raw?.data?.output?.urls,
    raw?.results,
    raw?.result?.images,
    raw?.result?.urls,
    raw?.result?.results,
    raw?.data?.results,
    raw?.video?.results,
    raw?.content, // 火山引擎 Ark API: content 数组
  ];

  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (typeof item === 'string') pushResultUrl(urls, item);
      else if (item?.url) pushResultUrl(urls, item.url);
      else if (item?.result_url) pushResultUrl(urls, item.result_url);
      else if (item?.video_url?.url) pushResultUrl(urls, item.video_url.url); // Ark: {type:"video_url", video_url:{url:"..."}}
      else if (item?.video_url && typeof item.video_url === 'string') pushResultUrl(urls, item.video_url);
      else if (item?.image_url?.url) pushResultUrl(urls, item.image_url.url); // Ark: {type:"image_url", image_url:{url:"..."}}
      else if (item?.image_url && typeof item.image_url === 'string') pushResultUrl(urls, item.image_url);
      else if (item?.download_url) pushResultUrl(urls, item.download_url);
      else if (item?.b64_json) pushResultUrl(urls, item.b64_json, item.mime_type || item.mime || 'image/png');
      else if (item?.base64) pushResultUrl(urls, item.base64, item.mime_type || item.mime || 'image/png');
      else if (item?.data && typeof item.data === 'string') pushResultUrl(urls, item.data, item.mime_type || item.mime || 'image/png');
    }
  }

  // Gemini API 格式: candidates[].content.parts[].inline_data / text
  if (Array.isArray(raw?.candidates)) {
    for (const cand of raw.candidates) {
      const parts = cand?.content?.parts;
      if (!Array.isArray(parts)) continue;
      for (const part of parts) {
        const inlineData = part?.inlineData || part?.inline_data;
        const fileData = part?.fileData || part?.file_data;
        if (inlineData?.data) {
          const mime = inlineData.mimeType || inlineData.mime_type || 'image/png';
          urls.push(`data:${mime};base64,${inlineData.data}`);
        } else if (fileData?.fileUri || fileData?.file_uri) {
          urls.push(String(fileData.fileUri || fileData.file_uri));
        }
      }
    }
  }

  const taskId = String(
    raw?.video_id ?? raw?.task_id ?? raw?.id ?? raw?.data?.task_id ?? raw?.data?.video_id ?? raw?.data?.id ?? raw?.task?.id ?? raw?.video?.id ?? ''
  ) || undefined;

  const progress = Number(raw?.progress ?? raw?.data?.progress ?? raw?.percent ?? raw?.video?.progress ?? 0);
  const errorMessage = String(
    raw?.error?.message ?? raw?.message ?? raw?.error_message ?? raw?.data?.error ?? raw?.fail_reason ?? raw?.video?.error ?? ''
  ) || undefined;

  // 如果已经解析出了结果 URLs，不管 status 字段怎么说，都视为成功
  // （解决 JD Gemini API 同步返回图片但带有中间状态字段的问题）
  const finalStatus = failed ? 'failed' 
    : (urls.length > 0 ? 'succeeded' 
    : (succeeded ? 'succeeded' : (running ? 'running' : 'queued')));

  return {
    status: finalStatus,
    progress: Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0,
    taskId,
    urls: Array.from(new Set(urls)),
    errorMessage,
    raw,
  };
};

const requestJson = async (url: string, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(`请求超时 (${Math.round(timeoutMs / 1000)}s)`), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...((init.headers as Record<string, string>) ?? {}),
      },
    });

    const text = await res.text();
    let data: any = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = { rawText: text };
    }

    if (!res.ok) {
      throw new Error(data?.error?.message || data?.message || `HTTP ${res.status}`);
    }

    return data;
  } catch (err: any){
    if (err.name === 'AbortError') {
      throw new Error(`请求超时 (${Math.round(timeoutMs / 1000)}s)，请检查网络连接或增加超时时间`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

// 使用 JSON 格式发送图生图请求到 imageEditPath 端点
// JD 的 /v1/images/edit 接口兼容 OpenAI JSON 格式，image 字段为纯 base64 字符串数组
const submitImageEdit = async (
  cfg: ModelConfig,
  payload: GeneratePayload
): Promise<NormalizedTaskResult> => {
  const editPath = cfg.imageEditPath!;
  const url = buildUrl(cfg.baseUrl, editPath);
  const timeout = Math.max(cfg.timeoutMs, 120000);

  // 构建 image 数组 - 尝试多种格式兼容
  // 格式1: 纯 base64 字符串数组（不含前缀）- 最可能被 JD 接受
  const isJdGptImage = /GPT-image-\d/i.test(cfg.model)
    || (/joybuilder/i.test(cfg.model) && /gpt-image/i.test(cfg.model));
  const imageInputs: string[] = [];
  for (const img of payload.referenceImages) {
    if (img.startsWith('data:image/')) {
      imageInputs.push(img);
    } else if (img.startsWith('http')) {
      imageInputs.push(img);
    }
  }

  // JD API 可能接受：单张图用字符串，多张用数组
  const imageField = isJdGptImage
    ? imageInputs
    : (imageInputs.length === 1 ? imageInputs[0] : imageInputs);

  const requestedSize = payload.size || '1024x1024';
  const [requestedWidth, requestedHeight] = requestedSize.split('x').map(Number);
  const editSize = isJdGptImage
    ? (requestedWidth > requestedHeight
      ? '1536x1024'
      : (requestedHeight > requestedWidth ? '1024x1536' : '1024x1024'))
    : requestedSize;

  const body: Record<string, unknown> = {
    model: cfg.model,
    prompt: payload.prompt,
    image: imageField,
    size: editSize,
    n: isJdGptImage ? 1 : Math.max(1, payload.numImages || 1),
    response_format: 'b64_json',
  };

  console.log('[AI-Debug] submitImageEdit URL:', url);
  console.log('[AI-Debug] submitImageEdit body (image field type):', typeof imageField, Array.isArray(imageField) ? `array[${imageInputs.length}]` : 'string');
  console.log('[AI-Debug] submitImageEdit body keys:', Object.keys(body).join(','));
  console.log('[AI-Debug] submitImageEdit timeout:', timeout);

  let raw: Record<string, unknown>;
  try {
    raw = await requestJson(
      url,
      {
        method: 'POST',
        headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
        body: JSON.stringify(body),
      },
      timeout
    );
    console.log('[AI-Debug] submitImageEdit response:', JSON.stringify(raw).slice(0, 500));
  } catch (err: unknown) {
    if (isJdGptImage) throw err;
    // 如果 edit 端点失败，尝试回退到 generations 端点（带 image 字段）
    console.warn('[AI-Debug] submitImageEdit failed, falling back to generations endpoint:', err);
    const genUrl = buildUrl(cfg.baseUrl, cfg.imageGeneratePath);
    const genBody: Record<string, unknown> = {
      model: cfg.model,
      prompt: payload.prompt,
      image: imageField,
    };
    if (payload.size) genBody.size = payload.size;
    if (payload.numImages && payload.numImages > 1) genBody.n = payload.numImages;

    console.log('[AI-Debug] fallback generations URL:', genUrl);
    raw = await requestJson(
      genUrl,
      {
        method: 'POST',
        headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
        body: JSON.stringify(genBody),
      },
      timeout
    );
    console.log('[AI-Debug] fallback generations response:', JSON.stringify(raw).slice(0, 500));
  }

  // 如果返回了错误（如参数解析失败），再尝试 data URL 格式
  if (raw && (raw.error || (raw as Record<string, unknown>).message)) {
    const errMsg = JSON.stringify(raw.error || (raw as Record<string, unknown>).message || '');
    if (errMsg.includes('参数') || errMsg.includes('parse') || errMsg.includes('invalid')) {
      console.warn('[AI-Debug] First attempt failed, retrying with data URL format...');
      // 格式2: 完整 data URL 字符串
      const dataUrls: string[] = [];
      for (const img of payload.referenceImages) {
        if (img.startsWith('data:image/')) {
          dataUrls.push(img); // 带完整 data:image/xxx;base64, 前缀
        }
      }
      const imageField2 = dataUrls.length === 1 ? dataUrls[0] : dataUrls;
      const retryBody: Record<string, unknown> = {
        model: cfg.model,
        prompt: payload.prompt,
        image: imageField2,
      };
      if (payload.size) retryBody.size = payload.size;
      if (payload.numImages && payload.numImages > 1) retryBody.n = payload.numImages;

      const retryUrl = buildUrl(cfg.baseUrl, editPath);
      console.log('[AI-Debug] Retry with data URL format to:', retryUrl);
      const retryRaw = await requestJson(
        retryUrl,
        {
          method: 'POST',
          headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
          body: JSON.stringify(retryBody),
        },
        timeout
      );
      console.log('[AI-Debug] Retry response:', JSON.stringify(retryRaw).slice(0, 500));
      return normalizeResult(retryRaw as Record<string, unknown>);
    }
  }

  return normalizeResult(raw);
};

export const submitGenerateTask = async (
  cfg: ModelConfig,
  payload: GeneratePayload
): Promise<NormalizedTaskResult> => {
  // 图生图模式：如果配置了 imageEditPath，使用 multipart/form-data 格式发到 edit 端点
  const isImage2Image = !payload.kind || payload.kind === 'image';
  const inferredImageEditPath = cfg.imageEditPath
    || (/GPT-image-\d/i.test(cfg.model) ? '/images/edits' : '');
  const useEditEndpoint = isImage2Image && payload.imageMode === 'image2image'
    && payload.referenceImages.length > 0 && inferredImageEditPath;
  
  if (useEditEndpoint) {
    return submitImageEdit({ ...cfg, imageEditPath: inferredImageEditPath }, payload);
  }

  const path = payload.kind === 'video' ? cfg.videoGeneratePath : cfg.imageGeneratePath;
  const requestBaseUrl = /volces\.com|volcengine\.com/.test(cfg.baseUrl) || path.includes('/contents/generations')
    ? normalizeArkBaseUrl(cfg.baseUrl)
    : cfg.baseUrl;
  const url = buildUrl(requestBaseUrl, path);

  const isVideo = payload.kind === 'video';

  // 判断是否为火山引擎 Ark API（豆包视频）
  const isArkApi = /volces\.com|volcengine\.com/.test(cfg.baseUrl) ||
    path.includes('/contents/generations') ||
    (path.includes('/v1/task/submit') && /seedance/i.test(cfg.model));

  // 判断是否为 Gemini 格式 API（contents 数组）
  const isGeminiApi = path.includes('gemini');
  const isGoogleGeminiApi = /google-api|\/api\/google|generativelanguage\.googleapis\.com/i.test(cfg.baseUrl);

  let body: Record<string, unknown>;

  if (isGeminiApi) {
    // Gemini API 格式: { model, contents: [{role:"user", parts:[{text:"..."}, {inline_data:{...}}]}] }
    const parts: Array<Record<string, unknown>> = [];
    // 图生图模式：先放图片，再放文本描述（Gemini需要图在前文在后）
    if (payload.imageMode === 'image2image' && payload.referenceImages.length > 0) {
      for (const img of payload.referenceImages) {
        if (!img) continue;
        parts.push({ inline_data: await toGeminiInlineData(img) });
      }
    }
    parts.push({ text: payload.prompt });
    if (isGoogleGeminiApi) {
      const imageSize = /^(512|1K|2K|4K)$/.test(payload.size || '')
        ? payload.size
        : '1K';
      body = {
        contents: [{ role: 'user', parts }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: {
            aspectRatio: payload.ratio || '1:1',
            imageSize,
          },
        },
      };
    } else {
      body = {
        model: cfg.model,
        contents: [{ role: 'user', parts }],
      };
    }
  } else if (isArkApi) {
    // 火山引擎 Ark API 格式: { model, content: [{type:"text", text:"..."}, ...] }
    const content: Array<Record<string, unknown>> = [];

    // 判断是否为 seedance 系列模型（视频生成）
    const isSeedance = /seedance/i.test(cfg.model);

    content.push({ type: 'text', text: payload.prompt });

    if (isVideo && isSeedance) {
      // Seedance 视频生成：首尾帧需要带 role 字段
      // 首帧: { type: "image_url", image_url: { url: "..." }, role: "first_frame" }
      // 尾帧: { type: "image_url", image_url: { url: "..." }, role: "last_frame" }
      const [arkFirstFrame, arkLastFrame] = await Promise.all([
        resolveArkImageInput(payload.firstFrame || '', cfg.imgbbApiKey || ''),
        resolveArkImageInput(payload.lastFrame || '', cfg.imgbbApiKey || ''),
      ]);
      if (arkFirstFrame) {
        content.push({
          type: 'image_url',
          image_url: { url: arkFirstFrame },
          role: 'first_frame',
        });
      }
      if (arkLastFrame) {
        content.push({
          type: 'image_url',
          image_url: { url: arkLastFrame },
          role: 'last_frame',
        });
      }
      // 普通参考图（非首尾帧）
      for (const image of payload.referenceImages) {
        const imgUrl = await resolveArkImageInput(image, cfg.imgbbApiKey || '');
        if (!imgUrl) continue;
        content.push({
          type: 'image_url',
          image_url: { url: imgUrl },
        });
      }

      // Seedance 顶级参数
      body = {
        model: cfg.model,
        content,
        generate_audio: /seedance-1-5-pro/i.test(cfg.model),
        duration: payload.durationSec || 5,
        ratio: payload.videoMode === 'text2video' ? (payload.ratio || '16:9') : 'adaptive',
        resolution: payload.resolution || '720p',
        watermark: false,
      };
    } else {
      // 非 seedance 的 Ark API（如豆包图片生成等）
      if (isVideo) {
        const duration = payload.durationSec || 5;
        let textContent = payload.prompt;
        if (!textContent.includes('--duration')) {
          textContent += `  --duration ${duration}`;
        }
        if (!textContent.includes('--watermark')) {
          textContent += ' --watermark false';
        }
        // 替换已添加的text条目
        content[0] = { type: 'text', text: textContent };
      }

      // 参考图片作为 image_url 添加（包括首尾帧）
      const arkImages = [
        ...(payload.firstFrame ? [payload.firstFrame] : []),
        ...payload.referenceImages,
        ...(payload.lastFrame ? [payload.lastFrame] : []),
      ];
      if (arkImages.length > 0) {
        for (const imgUrl of arkImages) {
          content.push({
            type: 'image_url',
            image_url: { url: imgUrl },
          });
        }
      }

      body = { model: cfg.model, content };
    }
  } else {
    // 通用 API 格式 (OpenAI / SiliconFlow / Agnes AI 等)
    if (isVideo) {
      const sec = payload.durationSec || 5;
      const videoMode = payload.videoMode || 'text2video';
      const imgbbKey = cfg.imgbbApiKey || '';

      // num_frames 遵循 8n+1 规则, frame_rate=24
      let numFrames = 121;
      if (sec <= 3) numFrames = 81;        // ~3.4s @24fps
      else if (sec <= 5) numFrames = 121;  // ~5s @24fps
      else if (sec <= 7) numFrames = 161;  // ~6.7s @24fps
      else if (sec <= 10) numFrames = 241; // ~10s @24fps
      else if (sec <= 14) numFrames = 321; // ~13.4s @24fps
      else numFrames = 441;                // ~18.4s @24fps (max)

      if (videoMode === 'text2video') {
        // 文生视频
        const [w, h] = (payload.size || '1152x768').split('x').map(Number);
        body = {
          model: cfg.model,
          prompt: payload.prompt,
          height: h || 768,
          width: w || 1152,
          num_frames: numFrames,
          frame_rate: 24,
        };
      } else if (videoMode === 'image2video') {
        // 图生视频 - 优先直传 base64，仅在配置了 imgbbKey 时才上传获取 URL
        const imageInput = await resolveImageInput(payload.firstFrame || '', imgbbKey);
        body = {
          model: cfg.model,
          prompt: payload.prompt,
          image: imageInput,
          num_frames: numFrames,
          frame_rate: 24,
        };
      } else {
        // 关键帧模式 - 优先直传 base64，仅在配置了 imgbbKey 时才上传获取 URL
        const [firstInput, lastInput] = await Promise.all([
          resolveImageInput(payload.firstFrame || '', imgbbKey),
          resolveImageInput(payload.lastFrame || '', imgbbKey),
        ]);
        body = {
          model: cfg.model,
          prompt: payload.prompt,
          extra_body: {
            image: [firstInput, lastInput].filter(Boolean),
            mode: 'keyframes',
          },
          num_frames: numFrames,
          frame_rate: 24,
        };
      }
    } else {
      // 图片生成
      const imageMode = payload.imageMode || 'text2image';
      // 判断是否为 JD GPT-Image-2 / joybuilder 系列：官方仅接受 { model, prompt }
      // 传入 size / negative_prompt 等字段会导致模型 hang 或超时；因此这里严格按 curl 示例最小化 body
      const isJdGptImage = /GPT-image-\d/i.test(cfg.model) || (/joybuilder/i.test(cfg.model) && /gpt-image/i.test(cfg.model));
      // 判断是否为豆包 Seedream 系列（火山引擎 Ark，走 /ark-api 代理，同步图片生成）
      const isSeedream = /seedream/i.test(cfg.model) || /\/ark-api|volces\.com/.test(cfg.baseUrl);

      if (isSeedream) {
        // 豆包 Seedream 官方格式：
        // { model, prompt, sequential_image_generation, response_format, size, stream, watermark, image? }
        // size 使用 "2K" / "4K" / "1K"，不是像素规格；此处默认 "2K"
        body = {
          model: cfg.model,
          prompt: payload.prompt,
          sequential_image_generation: 'disabled',
          response_format: 'url',
          size: /^\d+K$/i.test(payload.size || '') ? payload.size : '2K',
          stream: false,
          watermark: true,
        };
        // 图生图：单张参考图发送字符串，多张参考图发送数组。
        if (imageMode === 'image2image' && payload.referenceImages.length > 0) {
          const imgbbKey = cfg.imgbbApiKey || '';
          const imageInputs: string[] = [];
          for (const img of payload.referenceImages) {
            if (!img) continue;
            // Seedream 接受 http URL 或 data URL；resolveImageInput 会保证格式合规
            const resolved = await resolveImageInput(img, imgbbKey);
            if (resolved) imageInputs.push(resolved);
          }
          body.image = imageInputs.length === 1 ? imageInputs[0] : imageInputs;
          console.log('[AI-Debug] Seedream image2image inputs:', imageInputs.length,
            'field type:', imageInputs.length === 1 ? 'single' : 'array',
            'first type:', imageInputs[0]?.startsWith('http') ? 'url' : 'data-url');
        }
      } else {
        body = {
          model: cfg.model,
          prompt: payload.prompt,
        };
        if (!isJdGptImage) {
          body.negative_prompt = payload.negativePrompt || undefined;
          body.size = payload.size;
          body.n = (payload.numImages && payload.numImages > 1) ? payload.numImages : undefined;
        }

        // 图生图模式：将参考图传入
        if (imageMode === 'image2image' && payload.referenceImages.length > 0) {
          // 判断是否为 Agnes AI API：需要通过 extra_body.image 传 URL 数组，返回 b64_json
          const isAgnesApi = /apihub\.agnes-ai\.com/.test(cfg.baseUrl) || /agnes-image/i.test(cfg.model);

          if (isAgnesApi) {
            // Agnes AI 图生图格式：
            // { model, prompt, size, extra_body: { image: [URL 或 data URL], response_format: "b64_json" } }
            // resolveImageInput 会保证返回 http URL 或完整 data URL（拒绝裸 base64）
            const imgbbKey = cfg.imgbbApiKey || '';
            const imageInputs: string[] = [];
            for (const img of payload.referenceImages) {
              if (!img) continue;
              const resolved = await resolveImageInput(img, imgbbKey);
              if (resolved) imageInputs.push(resolved);
            }
            body.extra_body = {
              image: imageInputs,
              response_format: 'b64_json',
            };
            console.log('[AI-Debug] Agnes image2image inputs:', imageInputs.length,
              'first type:', imageInputs[0]?.startsWith('http') ? 'url' : imageInputs[0]?.startsWith('data:') ? 'data-url' : 'raw-base64');
          } else {
            // 通用/JD 图生图：使用纯 base64 字符串（不带 data URL 前缀）放到 image 字段
            const imageInputs: string[] = [];
            for (const img of payload.referenceImages) {
              if (img.startsWith('data:image/')) {
                imageInputs.push(img);
              } else if (img.startsWith('http')) {
                imageInputs.push(img);
              }
            }
            // JD GPT-Image-2 图生图使用 JSON Array 协议；即使只有一张图也必须发送数组。
            if (isJdGptImage) {
              body.extra_body = { image: imageInputs };
            } else {
              body.image = imageInputs.length === 1 ? imageInputs[0] : imageInputs;
            }
          }
        }
      }
    }
  }

  // 生成 POST 请求 timeout 直接使用 cfg.timeoutMs（每个模型自行调），最少 60s 兜底
  const timeout = Math.max(cfg.timeoutMs, 60000);

  console.log('[AI-Debug] submitGenerateTask URL:', url);
  console.log('[AI-Debug] submitGenerateTask body:', JSON.stringify(body, null, 2));
  console.log('[AI-Debug] submitGenerateTask timeout:', timeout);

  const raw = await requestJson(
    url,
    {
      method: 'POST',
      headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
      body: JSON.stringify(body),
    },
    timeout
  );

  console.log('[AI-Debug] submitGenerateTask response keys:', Object.keys(raw || {}));
  
  const result = normalizeResult(raw);

  // Gemini API 是同步返回的（直接返回 candidates 格式或错误）
  // 如果响应中包含 candidates 数组，说明是同步完成，不需要轮询
  // 强制清除 taskId 避免误入轮询循环
  if (isGeminiApi) {
    // 详细输出 Gemini 响应结构用于调试
    console.log('[AI-Debug] Gemini raw keys:', Object.keys(raw || {}));
    if (raw?.candidates) {
      console.log('[AI-Debug] Gemini candidates:', JSON.stringify(raw.candidates).slice(0, 1000));
    }
    if (raw?.data) {
      console.log('[AI-Debug] Gemini data field:', JSON.stringify(raw.data).slice(0, 500));
    }

    if (raw?.candidates || result.urls.length > 0) {
      // 同步返回了结果（可能有图片，也可能只有文本）
      result.status = result.urls.length > 0 ? 'succeeded' : 'failed';
      result.taskId = undefined;
      if (result.urls.length === 0 && !result.errorMessage) {
        // 检查是否 Gemini 返回了文本而不是图片
        const textParts: string[] = [];
        if (Array.isArray(raw?.candidates)) {
          for (const cand of (raw as any).candidates) {
            const parts = cand?.content?.parts;
            if (Array.isArray(parts)) {
              for (const p of parts) {
                if (p?.text) textParts.push(p.text);
              }
            }
          }
        }
        result.errorMessage = textParts.length > 0 
          ? `模型返回了文本而非图片: ${textParts.join(' ').slice(0, 200)}`
          : '模型未返回图片数据，响应: ' + JSON.stringify(raw).slice(0, 300);
      }
    } else if (!result.taskId) {
      // 没有 candidates 也没有 taskId，可能是错误响应
      result.status = 'failed';
      if (!result.errorMessage) {
        result.errorMessage = `Gemini API 返回异常: ${JSON.stringify(raw).slice(0, 200)}`;
      }
    }
    console.log('[AI-Debug] Gemini result override:', result.status, 'urls:', result.urls.length, 'taskId:', result.taskId);
  }

  return result;
};

export const pollTaskUntilDone = async (
  cfg: ModelConfig,
  taskId: string,
  onTick?: (r: NormalizedTaskResult) => void
): Promise<NormalizedTaskResult> => {
  // 支持多种占位符格式: :id, :task_id, :video_id, {id}, {task_id}, <VIDEO_ID> 等
  // 同时支持查询参数中的占位符，如 /agnesapi?video_id=<VIDEO_ID>
  const hasPlaceholder = /:(id|task_id|video_id)|<[^>]+>|\{[^}]+\}/i.test(cfg.taskStatusPath);
  let path: string;
  if (hasPlaceholder) {
    path = cfg.taskStatusPath.replace(
      /:(id|task_id|video_id)|<[^>]+>|\{[^}]+\}/gi,
      encodeURIComponent(taskId)
    );
  } else {
    // 无占位符时，将taskId追加到路径末尾（如 /v1/videos/ + taskId）
    const base = cfg.taskStatusPath.replace(/\/$/, '');
    path = `${base}/${encodeURIComponent(taskId)}`;
  }
  const url = buildUrl(normalizeArkBaseUrl(cfg.baseUrl), path);
  console.log('[AI-Debug] pollTaskUntilDone URL:', url, 'taskId:', taskId);

  // 使用配置的轮询参数（视频生成建议配置较大值）
  const maxTimes = Math.max(cfg.pollMaxTimes, 30);
  const interval = Math.max(cfg.pollIntervalMs, 2000);

  for (let i = 0; i < maxTimes; i += 1) {
    const raw = await requestJson(
      url,
      {
        method: 'GET',
        headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {},
      },
      Math.max(cfg.timeoutMs, 90000)
    );

    console.log(`[AI-Debug] poll #${i + 1} response:`, JSON.stringify(raw).slice(0, 500));
    const normalized = normalizeResult(raw);
    console.log(`[AI-Debug] poll #${i + 1} normalized status:`, normalized.status, 'urls:', normalized.urls.length);
    onTick?.(normalized);

    if (normalized.status === 'succeeded' || normalized.status === 'failed') {
      return normalized;
    }

    await new Promise((r) => setTimeout(r, interval));
  }

  return {
    status: 'failed',
    progress: 100,
    urls: [],
    errorMessage: '任务轮询超时（已等待约' + Math.round(maxTimes * interval / 1000 / 60) + '分钟），视频生成可能仍在排队中。',
    raw: null,
  };
};

export const toTask = (params: {
  prompt: string;
  kind: 'image' | 'video';
  model: string;
  first: NormalizedTaskResult;
}): GenerateTask => ({
  id: params.first.taskId || `local_${Date.now()}`,
  kind: params.kind,
  prompt: params.prompt,
  model: params.model,
  createdAt: Date.now(),
  status: params.first.status,
  progress: params.first.progress,
  errorMessage: params.first.errorMessage,
  resultUrls: params.first.urls,
  rawLastResponse: params.first.raw,
});
