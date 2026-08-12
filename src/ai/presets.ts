import { useState, useCallback, useEffect, useMemo } from 'react';
import type { ModelConfig } from './types';
import { DEFAULT_MODEL_CONFIG } from './types';

export interface ModelPreset {
  id: string;
  name: string;
  config: ModelConfig;
  builtIn?: boolean;
  capabilities?: ModelMediaKind[];
  recommended?: boolean;
  styleDescription?: string;
}

export type ModelMediaKind = 'image' | 'video';

export const CORE_IMAGE_PRESET_IDS = [
  '__doubao_seedream_45__',
  '__doubao_seedream__',
  '__jd_gpt_image__',
  '__jd_gemini_3_pro_image__',
] as const;

export const isCoreImagePreset = (preset: ModelPreset) =>
  CORE_IMAGE_PRESET_IDS.includes(preset.id as typeof CORE_IMAGE_PRESET_IDS[number]);

export const inferModelCapabilities = (
  config: ModelConfig,
  name = ''
): ModelMediaKind[] => {
  const signature = `${name} ${config.model}`.toLowerCase();
  const imageHint = /(image|seedream|flux|stable.?diffusion|dall.?e|imagen|midjourney)/.test(signature);
  const videoHint = /(video|seedance|wan\d|wan-|kling|hailuo|sora|veo|pixverse|t2v|i2v)/.test(signature);

  if (imageHint && !videoHint) return ['image'];
  if (videoHint && !imageHint) return ['video'];
  if (imageHint && videoHint) return ['image', 'video'];

  const hasImageEndpoint = Boolean(config.imageGeneratePath?.trim());
  const hasVideoEndpoint = Boolean(config.videoGeneratePath?.trim());
  if (hasImageEndpoint && !hasVideoEndpoint) return ['image'];
  if (hasVideoEndpoint && !hasImageEndpoint) return ['video'];

  return ['image', 'video'];
};

export const presetSupportsKind = (preset: ModelPreset, kind: ModelMediaKind) =>
  (preset.capabilities || inferModelCapabilities(preset.config, preset.name)).includes(kind);

const STORAGE_KEY = 'ai-studio-model-presets';
const ACTIVE_PRESET_KEY = 'ai-studio-active-preset';
const MODEL_SECRET_STORAGE_KEY = 'joyflow-model-secrets-v1';

interface RememberedModelSecret {
  apiKey?: string;
  imgbbApiKey?: string;
}

const modelSecretId = (config: ModelConfig) => `${config.baseUrl.trim()}::${config.model.trim()}`;

const loadRememberedModelSecrets = (): Record<string, RememberedModelSecret> => {
  try {
    const raw = localStorage.getItem(MODEL_SECRET_STORAGE_KEY);
    return raw ? JSON.parse(raw) as Record<string, RememberedModelSecret> : {};
  } catch {
    return {};
  }
};

export const withRememberedModelSecrets = (config: ModelConfig): ModelConfig => {
  const remembered = loadRememberedModelSecrets()[modelSecretId(config)];
  if (!remembered) return { ...config };
  return {
    ...config,
    apiKey: remembered.apiKey || config.apiKey,
    imgbbApiKey: remembered.imgbbApiKey || config.imgbbApiKey,
  };
};

export const rememberModelSecrets = (config: ModelConfig) => {
  try {
    const secrets = loadRememberedModelSecrets();
    const id = modelSecretId(config);
    const apiKey = config.apiKey.trim();
    const imgbbApiKey = config.imgbbApiKey?.trim() || '';
    if (!apiKey && !imgbbApiKey) delete secrets[id];
    else secrets[id] = { apiKey, imgbbApiKey };
    localStorage.setItem(MODEL_SECRET_STORAGE_KEY, JSON.stringify(secrets));
  } catch {
    // Key persistence must never block generation.
  }
};

// 内置预设模板
export const BUILT_IN_PRESETS: ModelPreset[] = [
  {
    id: '__doubao_video__',
    name: '豆包 (视频生成)',
    builtIn: true,
    capabilities: ['video'],
    config: {
      baseUrl: 'https://ark.cn-beijing.volces.com',
      apiKey: '',
      model: 'doubao-seedance-1-5-pro-251215',
      imageGeneratePath: '/api/v3/contents/generations/tasks',
      videoGeneratePath: '/api/v3/contents/generations/tasks',
      taskStatusPath: '/api/v3/contents/generations/tasks/{id}',
      timeoutMs: 120000,
      pollIntervalMs: 5000,
      pollMaxTimes: 60,
    },
  },
  {
    id: '__agnes_image__',
    name: 'Agnes AI (文生图)',
    builtIn: true,
    capabilities: ['image'],
    config: {
      baseUrl: 'https://apihub.agnes-ai.com',
      apiKey: '',
      model: 'agnes-image-2.1-flash',
      imageGeneratePath: '/v1/images/generations',
      videoGeneratePath: '/v1/videos',
      taskStatusPath: '/agnesapi?video_id=<VIDEO_ID>',
      timeoutMs: 60000,
      pollIntervalMs: 2000,
      pollMaxTimes: 30,
    },
  },
  {
    id: '__agnes_video__',
    name: 'Agnes AI (视频生成)',
    builtIn: true,
    capabilities: ['video'],
    config: {
      baseUrl: 'https://apihub.agnes-ai.com',
      apiKey: '',
      model: 'agnes-video-v2.0',
      imageGeneratePath: '/v1/images/generations',
      videoGeneratePath: '/v1/videos',
      taskStatusPath: '/agnesapi?video_id=<VIDEO_ID>',
      timeoutMs: 120000,
      pollIntervalMs: 5000,
      pollMaxTimes: 60,
    },
  },
  {
    id: '__siliconflow__',
    name: 'SiliconFlow (硅基流动)',
    builtIn: true,
    capabilities: ['video'],
    config: {
      baseUrl: 'https://api.siliconflow.cn',
      apiKey: '',
      model: 'Wan-AI/Wan2.1-T2V-14B',
      imageGeneratePath: '/v1/images/generations',
      videoGeneratePath: '/v1/videos/generations',
      taskStatusPath: '/v1/videos/results/:id',
      timeoutMs: 60000,
      pollIntervalMs: 3000,
      pollMaxTimes: 40,
    },
  },
  {
    id: '__doubao_seedream_45__',
    name: 'Seedream 4.5（卡通拟物）',
    builtIn: true,
    capabilities: ['image'],
    recommended: true,
    styleDescription: '默认推荐｜3D 卡通拟物风格稳定，参考图一致性好，适合角色海报场景和特产道具。',
    config: {
      baseUrl: '/ark-api',
      apiKey: '',
      model: 'doubao-seedream-4-5-251128',
      imageGeneratePath: '/api/v3/images/generations',
      videoGeneratePath: '',
      taskStatusPath: '',
      timeoutMs: 300000,
      pollIntervalMs: 2000,
      pollMaxTimes: 1,
    },
  },
  {
    id: '__doubao_seedream__',
    name: 'Seedream 5.0（卡通拟物·更多细节）',
    builtIn: true,
    capabilities: ['image'],
    styleDescription: '延续 4.5 的卡通拟物表现，并增加材质、纹理和画面细节，适合需要更精细结果的方案。',
    config: {
      baseUrl: '/ark-api',
      apiKey: '',
      model: 'doubao-seedream-5-0-260128',
      imageGeneratePath: '/api/v3/images/generations',
      videoGeneratePath: '/api/v3/images/generations',
      taskStatusPath: '',
      timeoutMs: 300000,
      pollIntervalMs: 2000,
      pollMaxTimes: 60,
    },
  },
  {
    id: '__jd_gpt_image__',
    name: 'GPT Image 2（偏写实·仅内网）',
    builtIn: true,
    capabilities: ['image'],
    styleDescription: '风格略偏写实，材质与光影更自然，适合希望降低卡通感的方案；仅在京东内网环境可用。',
    config: {
      baseUrl: '/jd-api/v1',
      apiKey: '',
      model: 'GPT-image-2-joybuilder',
      imageGeneratePath: '/images/generations',
      imageEditPath: '/images/edits',
      videoGeneratePath: '/videos/generations',
      taskStatusPath: '/tasks/:id',
      timeoutMs: 600000,
      pollIntervalMs: 2000,
      pollMaxTimes: 60,
    },
  },
  {
    id: '__jd_gemini_3_pro_image__',
    name: 'Gemini 3 Pro Image Preview（仅内网）',
    builtIn: true,
    capabilities: ['image'],
    styleDescription: '擅长创意构图与画面细节，支持文字生图和参考图融图；仅在京东内网环境可用。',
    config: {
      baseUrl: '/jd-api',
      apiKey: '',
      model: 'Gemini-3-Pro-Image-Preview-joybuilder',
      imageGeneratePath: '/v1/images/gemini_flash/generations',
      videoGeneratePath: '',
      taskStatusPath: '',
      timeoutMs: 300000,
      pollIntervalMs: 2000,
      pollMaxTimes: 1,
    },
  },
  {
    id: '__jd_seedance_2_fast__',
    name: 'Seedance 2.0 Fast（仅内网）',
    builtIn: true,
    capabilities: ['video'],
    recommended: true,
    styleDescription: '京东内网高速视频模型，支持单图生视频和首尾帧控制；需要填写个人 API Key。',
    config: {
      baseUrl: '/jd-api',
      apiKey: '',
      model: 'Doubao-Seedance-2.0-fast-joybuilder',
      imageGeneratePath: '',
      videoGeneratePath: '/v1/task/submit',
      taskStatusPath: '/v1/task/{id}',
      timeoutMs: 300000,
      pollIntervalMs: 5000,
      pollMaxTimes: 120,
    },
  },
];

const loadPresets = (): ModelPreset[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ModelPreset[];
  } catch {
    return [];
  }
};

const savePresets = (presets: ModelPreset[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
};

const loadActiveId = (): string | null => {
  return localStorage.getItem(ACTIVE_PRESET_KEY);
};

const saveActiveId = (id: string | null) => {
  if (id) localStorage.setItem(ACTIVE_PRESET_KEY, id);
  else localStorage.removeItem(ACTIVE_PRESET_KEY);
};

export function useModelPresets(setModelConfig: (cfg: ModelConfig) => void) {
  const [userPresets, setUserPresets] = useState<ModelPreset[]>(loadPresets);
  const [activePresetId, setActivePresetId] = useState<string | null>(loadActiveId);

  // 所有预设 = 内置 + 用户自定义
  const allPresets = useMemo(
    () => [...BUILT_IN_PRESETS, ...userPresets],
    [userPresets]
  );

  // 持久化用户预设
  useEffect(() => {
    savePresets(userPresets);
  }, [userPresets]);

  // 持久化当前选中
  useEffect(() => {
    saveActiveId(activePresetId);
  }, [activePresetId]);

  // 始终让下拉框选中的预设与实际请求配置保持一致。
  // 这也避免 React 严格模式重复挂载时，旧配置覆盖刚切换的模型。
  useEffect(() => {
    if (activePresetId) {
      const preset = allPresets.find((p) => p.id === activePresetId);
      if (preset) {
        setModelConfig(withRememberedModelSecrets(preset.config));
      }
    }
  }, [activePresetId, allPresets, setModelConfig]);

  // 切换预设
  const switchPreset = useCallback(
    (presetId: string) => {
      const preset = allPresets.find((p) => p.id === presetId);
      if (!preset) return;
      setActivePresetId(presetId);
      setModelConfig(withRememberedModelSecrets(preset.config));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allPresets]
  );

  // 保存当前配置为新预设
  const saveAsPreset = useCallback(
    (name: string, config: ModelConfig, capabilities?: ModelMediaKind[]) => {
      const id = `preset_${Date.now()}`;
      const newPreset: ModelPreset = {
        id,
        name,
        config,
        capabilities: capabilities || inferModelCapabilities(config, name),
      };
      setUserPresets((prev) => [...prev, newPreset]);
      setActivePresetId(id);
    },
    []
  );

  // 更新现有用户预设的配置
  const updatePreset = useCallback(
    (presetId: string, config: ModelConfig) => {
      setUserPresets((prev) =>
        prev.map((p) => (p.id === presetId ? { ...p, config } : p))
      );
    },
    []
  );

  // 删除用户预设
  const deletePreset = useCallback(
    (presetId: string) => {
      setUserPresets((prev) => prev.filter((p) => p.id !== presetId));
      if (activePresetId === presetId) {
        setActivePresetId(null);
      }
    },
    [activePresetId]
  );

  return {
    allPresets,
    activePresetId,
    switchPreset,
    saveAsPreset,
    updatePreset,
    deletePreset,
  };
}
