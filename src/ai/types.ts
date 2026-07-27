export type GenerateKind = 'image' | 'video';
export type VideoMode = 'text2video' | 'image2video' | 'keyframes';
export type ImageMode = 'text2image' | 'image2image';

export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  imageGeneratePath: string;
  /** 图生图/编辑端点路径（GPT-Image-2 使用 /v1/images/edit，通过 multipart/form-data 上传） */
  imageEditPath?: string;
  videoGeneratePath: string;
  taskStatusPath: string;
  timeoutMs: number;
  pollIntervalMs: number;
  pollMaxTimes: number;
  /** imgbb 图床 API Key，用于将 base64 图片上传转 URL（图生视频/关键帧模式需要） */
  imgbbApiKey?: string;
}

export interface GeneratePayload {
  kind: GenerateKind;
  videoMode?: VideoMode;
  imageMode?: ImageMode;
  prompt: string;
  negativePrompt?: string;
  size: string;
  durationSec?: number;
  ratio?: string;
  resolution?: '480p' | '720p';
  quality?: string;
  numImages?: number;
  referenceImages: string[];
  // 图生视频的参考图
  firstFrame?: string;
  // 关键帧模式的尾帧
  lastFrame?: string;
}

export interface GenerateTask {
  id: string;
  workflowProjectId?: string;
  kind: GenerateKind;
  imageMode?: ImageMode;
  videoMode?: VideoMode;
  prompt: string;
  displayPrompt?: string;
  model: string;
  createdAt: number;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  progress: number;
  errorMessage?: string;
  resultUrls: string[];
  rawLastResponse?: unknown;
}

export interface NormalizedTaskResult {
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  progress: number;
  taskId?: string;
  urls: string[];
  errorMessage?: string;
  raw:unknown;
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  baseUrl: 'https://api.openai.com',
  apiKey: '',
  model: 'gpt-image-1',
  imageGeneratePath: '/v1/images/generations',
  videoGeneratePath: '/v1/videos/generations',
  taskStatusPath: '/v1/tasks/:id',
  timeoutMs: 45000,
  pollIntervalMs: 2000,
  pollMaxTimes: 25,
};

export const DEFAULT_PAYLOAD: GeneratePayload = {
  kind: 'image',
  videoMode: 'text2video',
  imageMode: 'text2image',
  prompt: '',
  negativePrompt: '',
  size: '1024x1024',
  durationSec: 5,
  ratio: '1:1',
  resolution: '720p',
  quality: '1080p',
  numImages: 1,
  referenceImages: [],
};

export const TASK_STATUS_TEXT: Record<GenerateTask['status'], string> = {
  queued: '排队中',
  running: '生成中',
  succeeded: '成功',
  failed: '失败',
};
