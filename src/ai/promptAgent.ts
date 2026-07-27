import type { GeneratePayload, ModelConfig } from './types';

export interface PromptAgentConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  path: string;
}

const STORAGE_KEY = 'lottiekey-prompt-agent-config-v2';

export const DEFAULT_PROMPT_AGENT_CONFIG: PromptAgentConfig = {
  baseUrl: import.meta.env.DEV ? '/ark-api' : '/api/ark',
  apiKey: '',
  model: 'doubao-seed-2-0-lite-260428',
  path: '/api/v3/responses',
};

export const loadPromptAgentConfig = (): PromptAgentConfig => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw
      ? { ...DEFAULT_PROMPT_AGENT_CONFIG, ...JSON.parse(raw), apiKey: '' }
      : DEFAULT_PROMPT_AGENT_CONFIG;
  } catch {
    return DEFAULT_PROMPT_AGENT_CONFIG;
  }
};

export const savePromptAgentConfig = (config: PromptAgentConfig) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...config, apiKey: '' }));
};

const normalizeBaseUrl = (baseUrl: string) =>
  /ark\.cn-beijing\.volces\.com|volcengine\.com/i.test(baseUrl)
    ? (import.meta.env.DEV ? '/ark-api' : '/api/ark')
    : baseUrl.replace(/\/$/, '');

const readAgentText = (raw: any): string => {
  if (typeof raw?.output_text === 'string') return raw.output_text;
  if (Array.isArray(raw?.output)) {
    const outputText = raw.output
      .flatMap((item: any) => Array.isArray(item?.content) ? item.content : [])
      .map((item: any) => item?.text || item?.content || '')
      .filter(Boolean)
      .join('\n');
    if (outputText) return outputText;
  }
  const content = raw?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((item) => item?.text || item?.content || '').filter(Boolean).join('\n');
  }
  return raw?.result?.text || raw?.data?.text || raw?.text || '';
};

export const optimizeGenerationPrompt = async (
  agentConfig: PromptAgentConfig,
  currentConfig: ModelConfig,
  payload: GeneratePayload,
) => {
  const baseUrl = normalizeBaseUrl(agentConfig.baseUrl.trim() || currentConfig.baseUrl.trim());
  const path = agentConfig.path.trim() || '/api/v3/responses';
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const apiKey = agentConfig.apiKey.trim() || currentConfig.apiKey.trim();
  if (!agentConfig.model.trim()) throw new Error('请先填写 Agent 模型名称');
  if (!baseUrl) throw new Error('请先填写 Agent Base URL');

  const mode = payload.kind === 'video'
    ? payload.videoMode === 'image2video' ? '图生视频'
      : payload.videoMode === 'keyframes' ? '首尾帧视频' : '文生视频'
    : payload.imageMode === 'image2image' ? '图生图' : '文生图';
  const systemPrompt = [
    '你是专业的 AI 视觉生成提示词优化 Agent。',
    '在不改变用户核心创意、角色身份和动作意图的前提下，将输入改写为清晰、可执行的中文视觉提示词。',
    '补充主体、动作、镜头、构图、环境、光线、材质和风格信息；视频任务还要补充镜头运动和时间连续性。',
    '如果提供了参考图，请先分析画面主体、构图和视觉风格，并确保优化结果与参考图一致。',
    '不要虚构用户未要求的品牌、文字或角色设定。只输出优化后的提示词正文，不要解释，不要使用 Markdown。',
  ].join('');
  const userPrompt = `任务类型：${mode}\n分辨率：${payload.resolution || payload.size}\n画面比例：${payload.ratio || '自动'}\n原始提示词：${payload.prompt}`;
  const referenceImage = payload.firstFrame || payload.referenceImages[0];
  const inputContent: Array<Record<string, string>> = [];
  if (referenceImage && !referenceImage.startsWith('blob:')) {
    inputContent.push({ type: 'input_image', image_url: referenceImage });
  }
  inputContent.push({ type: 'input_text', text: `${systemPrompt}\n\n${userPrompt}` });

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(path.includes('/responses') ? {
        model: agentConfig.model.trim(),
        input: [{ role: 'user', content: inputContent }],
      } : {
        model: agentConfig.model.trim(),
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.6,
      }),
      signal: controller.signal,
    });
    const raw = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(raw?.error?.message || raw?.message || `Agent 请求失败 (${response.status})`);
    const optimized = readAgentText(raw).trim().replace(/^```(?:text)?\s*|\s*```$/g, '');
    if (!optimized) throw new Error('Agent 没有返回可用的提示词');
    return optimized;
  } finally {
    window.clearTimeout(timeout);
  }
};

export const describeAtlasSceneOptions = async (
  agentConfig: PromptAgentConfig,
  currentConfig: ModelConfig,
  imageUrl: string,
  locationName: string,
  strategy: 'local' | 'recompose' | 'landmark',
  camera: { rotation: number; tilt: number; zoom: number },
) => {
  const baseUrl = normalizeBaseUrl(agentConfig.baseUrl.trim() || currentConfig.baseUrl.trim());
  const path = agentConfig.path.trim() || '/api/v3/responses';
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const apiKey = agentConfig.apiKey.trim() || currentConfig.apiKey.trim();
  if (!agentConfig.model.trim()) throw new Error('请先填写 Agent 模型名称');
  if (!baseUrl) throw new Error('请先填写 Agent Base URL');

  const strategyInstruction = strategy === 'recompose'
    ? '采用相邻新机位：在原拍摄位置附近小幅向左或向右移动，并轻微转动镜头，呈现同一场景的另一角度。'
    : strategy === 'landmark'
      ? '采用局部近景：在同一场景内靠近有辨识度的建筑或景物，可使用轻微侧角，但必须能明确识别为原场景。'
      : '采用原机位拉近：基本保留原照片的拍摄方向、主体与空间层次，只向前推进或收紧画面。';
  const rotationInstruction = Math.abs(camera.rotation) < 5
    ? '基本保持原照片的水平观察方向'
    : camera.rotation < 0
      ? `摄像机向场景左侧环绕约${Math.abs(camera.rotation)}度，从左前方观察主体`
      : `摄像机向场景右侧环绕约${camera.rotation}度，从右前方观察主体`;
  const tiltInstruction = Math.abs(camera.tilt) < 4
    ? '保持接近人眼高度的平视机位'
    : camera.tilt < 0
      ? `使用约${Math.abs(camera.tilt)}度的低机位仰视`
      : `使用约${camera.tilt}度的高机位俯视`;
  const zoomInstruction = camera.zoom < 34
    ? '使用广角全景，保留较多环境'
    : camera.zoom < 67
      ? '使用中景，兼顾主体和环境'
      : '使用近景，主体占据更大画面但仍保留场景辨识信息';
  const instruction = [
    '你是图鉴场景取景助手。请观察用户框选的参考照片，为后续卡通海报生图提供三个简短取景方案。',
    `用户填写的地点是：${locationName.trim()}。`,
    strategyInstruction,
    `目标摄像机参数：${rotationInstruction}；${tiltInstruction}；${zoomInstruction}。`,
    '参考照片是场景身份、建筑结构和空间布局的最高优先级依据。必须保留主体建筑、主要树木或道路及其真实相对位置，让结果明确是同一个地点。',
    '允许在原拍摄位置附近前移、侧移或小幅旋转镜头，以生成同一场景的其他角度。不得移动或替换现有景物、改造建筑、交换前后关系、加入新的地标，或把元素重新组合成另一个场景。',
    '照片未展示的侧面只能做保守、连续且符合原建筑结构的延伸，不要凭空设计新的主体。',
    '每个方案只需概括主体、前中后景、自然光线和视觉重心，不要进行过细描述。场景构图的美感与层次完整优先。',
    '不要添加照片里没有的物件，不要描述人物、品牌、文字、Logo、画风、材质、色彩风格或生成参数。',
    '三个方案都必须服从上述目标摄像机参数，只可在主体落点、景物层次和构图节奏上做小幅变化，并保持同一场景的空间连续性。每个控制在45到80个汉字。',
    '严格输出三行，格式为“方案1：...”“方案2：...”“方案3：...”，不要解释，不要Markdown。',
  ].join('');

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 60_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(path.includes('/responses') ? {
        model: agentConfig.model.trim(),
        input: [{
          role: 'user',
          content: [
            { type: 'input_image', image_url: imageUrl },
            { type: 'input_text', text: instruction },
          ],
        }],
      } : {
        model: agentConfig.model.trim(),
        messages: [{ role: 'user', content: instruction }],
        temperature: 0.35,
      }),
      signal: controller.signal,
    });
    const raw = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(raw?.error?.message || raw?.message || `场景分析失败 (${response.status})`);
    const description = readAgentText(raw)
      .trim()
      .replace(/^```(?:text)?\s*|\s*```$/g, '')
      .replace(/\r/g, '');
    if (!description) throw new Error('Agent 没有返回可用的场景描述');
    const options = description
      .split(/\n+/)
      .map((line) => line.replace(/^\s*(?:方案\s*)?[1-3一二三][：:、.．)）-]?\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 3)
      .map((line) => line.replace(/\s+/g, ' ').slice(0, 180));
    return options.length ? options : [description.replace(/\s+/g, ' ').slice(0, 180)];
  } finally {
    window.clearTimeout(timeout);
  }
};
