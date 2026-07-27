import { useState, useCallback, useEffect, useMemo } from 'react';
import type { ModelConfig } from './types';
import { DEFAULT_MODEL_CONFIG } from './types';

export interface ModelPreset {
  id: string;
  name: string;
  config: ModelConfig;
  builtIn?: boolean;
  capabilities?: ModelMediaKind[];
}

export type ModelMediaKind = 'image' | 'video';

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

const stripPresetSecrets = (config: ModelConfig): ModelConfig => ({
  ...config,
  apiKey: '',
  imgbbApiKey: '',
});

// 内置预设模板
export const BUILT_IN_PRESETS: ModelPreset[] = [
  {
    id: '__openai__',
    name: 'OpenAI (GPT-Image)',
    builtIn: true,
    capabilities: ['image'],
    config: {
      baseUrl: 'https://api.openai.com',
      apiKey: '',
      model: 'gpt-image-1',
      imageGeneratePath: '/v1/images/generations',
      videoGeneratePath: '/v1/videos/generations',
      taskStatusPath: '/v1/tasks/:id',
      timeoutMs: 45000,
      pollIntervalMs: 2000,
      pollMaxTimes: 25,
    },
  },
  {
    id: '__google_nano_banana__',
    name: 'Google Nano Banana 2',
    builtIn: true,
    capabilities: ['image'],
    config: {
      baseUrl: '/google-api',
      apiKey: '',
      model: 'gemini-3.1-flash-image',
      imageGeneratePath: '/v1beta/models/gemini-3.1-flash-image:generateContent',
      videoGeneratePath: '',
      taskStatusPath: '',
      timeoutMs: 300000,
      pollIntervalMs: 2000,
      pollMaxTimes: 1,
    },
  },
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
    name: '豆包 Seedream 4.5（文生图 / 单图 / 多图生图）',
    builtIn: true,
    capabilities: ['image'],
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
    name: '豆包 Seedream 5.0 (图片/图生图)',
    builtIn: true,
    capabilities: ['image'],
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
    name: 'JD GPT-Image-2（文生图 / 图生图）',
    builtIn: true,
    capabilities: ['image'],
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
    id: '__jd_gemini_flash__',
    name: 'JD Gemini-Flash',
    builtIn: true,
    capabilities: ['image'],
    config: {
      baseUrl: '/jd-api',
      apiKey: '',
      model: 'Gemini-3.1-Flash-Image-Preview-joybuilder',
      imageGeneratePath: '/v1/images/gemini_flash/generations',
      videoGeneratePath: '/v1/videos/generations',
      taskStatusPath: '/v1/tasks/:id',
      timeoutMs: 300000,
      pollIntervalMs: 2000,
      pollMaxTimes: 60,
    },
  },
  {
    id: '__jd_gemini_pro_image__',
    name: 'JD Gemini Pro Image Preview',
    builtIn: true,
    capabilities: ['image'],
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
    name: 'JD Doubao Seedance 2.0 Fast',
    builtIn: true,
    capabilities: ['video'],
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
    return (JSON.parse(raw) as ModelPreset[]).map((preset) => ({
      ...preset,
      config: stripPresetSecrets(preset.config),
    }));
  } catch {
    return [];
  }
};

const savePresets = (presets: ModelPreset[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(
    presets.map((preset) => ({
      ...preset,
      config: stripPresetSecrets(preset.config),
    }))
  ));
};

const loadActiveId = (): string | null => {
  return localStorage.getItem(ACTIVE_PRESET_KEY);
};

const saveActiveId = (id: string | null) => {
  if (id) localStorage.setItem(ACTIVE_PRESET_KEY, id);
  else localStorage.removeItem(ACTIVE_PRESET_KEY);
};

export function useModelPresets(
  setModelConfig: (cfg: ModelConfig | ((current: ModelConfig) => ModelConfig)) => void
) {
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

  // 启动时恢复上次选中的预设配置
  useEffect(() => {
    if (activePresetId) {
      const preset = allPresets.find((p) => p.id === activePresetId);
      if (preset) {
        setModelConfig((current) => ({
          ...preset.config,
          apiKey: current.apiKey,
          imgbbApiKey: current.imgbbApiKey || '',
        }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切换预设
  const switchPreset = useCallback(
    (presetId: string) => {
      const preset = allPresets.find((p) => p.id === presetId);
      if (!preset) return;
      setActivePresetId(presetId);
      setModelConfig((current) => ({
        ...preset.config,
        apiKey: current.apiKey,
        imgbbApiKey: current.imgbbApiKey || '',
      }));
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
        config: stripPresetSecrets(config),
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
        prev.map((p) => (
          p.id === presetId ? { ...p, config: stripPresetSecrets(config) } : p
        ))
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
