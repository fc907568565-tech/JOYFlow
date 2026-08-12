import type { GeneratePayload, ModelConfig } from './types';

export interface PromptAgentConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  path: string;
}

export interface PopupSemanticLayerObject {
  id: string;
  name: string;
  category: 'subject' | 'stage' | 'prop';
  box: [number, number, number, number];
  point: [number, number];
  reason: string;
}

const STORAGE_KEY = 'lottiekey-prompt-agent-config-v2';

export const GPT55_PROMPT_AGENT_CONFIG: PromptAgentConfig = {
  baseUrl: '/jd-api',
  apiKey: '',
  model: 'GPT-5.5-joybuilder',
  path: '/v1/chat/completions',
};

const LEGACY_DEFAULT_PROMPT_AGENT_CONFIG: PromptAgentConfig = {
  baseUrl: '/ark-api',
  apiKey: '',
  model: 'doubao-seed-2-0-lite-260428',
  path: '/api/v3/responses',
};

export const DEFAULT_PROMPT_AGENT_CONFIG: PromptAgentConfig = {
  ...GPT55_PROMPT_AGENT_CONFIG,
};

export const loadPromptAgentConfig = (): PromptAgentConfig => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PROMPT_AGENT_CONFIG;
    const saved = JSON.parse(raw) as Partial<PromptAgentConfig>;
    const isLegacyDefault = saved.baseUrl === LEGACY_DEFAULT_PROMPT_AGENT_CONFIG.baseUrl
      && saved.model === LEGACY_DEFAULT_PROMPT_AGENT_CONFIG.model
      && saved.path === LEGACY_DEFAULT_PROMPT_AGENT_CONFIG.path;
    if (isLegacyDefault) return { ...DEFAULT_PROMPT_AGENT_CONFIG };
    return {
      ...DEFAULT_PROMPT_AGENT_CONFIG,
      ...saved,
      apiKey: saved.apiKey?.trim() || '',
    };
  } catch {
    return DEFAULT_PROMPT_AGENT_CONFIG;
  }
};

export const savePromptAgentConfig = (config: PromptAgentConfig) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
};

const normalizeBaseUrl = (baseUrl: string) =>
  /ark\.cn-beijing\.volces\.com|volcengine\.com/i.test(baseUrl) ? '/ark-api' : baseUrl.replace(/\/$/, '');

const chatSamplingParams = (model: string, temperature: number) =>
  /gpt-5\.5/i.test(model) ? {} : { temperature };

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

const parseSceneOptions = (rawText: string) => {
  const description = rawText
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
  if (options.length < 3) throw new Error(`Agent 仅返回 ${options.length} 个有效方案，需要三个方案`);
  return options;
};

const clampUnit = (value: unknown) => Math.min(1, Math.max(0, Number(value) || 0));

const parsePopupSemanticLayers = (rawText: string): PopupSemanticLayerObject[] => {
  const cleaned = rawText.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('图像理解模型未返回可用的分层结果');
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  if (!Array.isArray(parsed?.objects)) throw new Error('图像理解结果缺少对象列表');
  const objects = parsed.objects.slice(0, 12).flatMap((item: any, index: number) => {
    if (!Array.isArray(item?.box) || item.box.length !== 4) return [];
    let [x1, y1, x2, y2] = item.box.map(clampUnit) as [number, number, number, number];
    if (x2 < x1) [x1, x2] = [x2, x1];
    if (y2 < y1) [y1, y2] = [y2, y1];
    if (x2 - x1 < 0.015 || y2 - y1 < 0.015) return [];
    const rawPoint = Array.isArray(item?.point) && item.point.length === 2
      ? item.point.map(clampUnit)
      : [(x1 + x2) / 2, (y1 + y2) / 2];
    const point: [number, number] = [
      Math.min(x2, Math.max(x1, rawPoint[0])),
      Math.min(y2, Math.max(y1, rawPoint[1])),
    ];
    const category: PopupSemanticLayerObject['category'] = item?.category === 'stage'
      ? 'stage'
      : item?.category === 'prop'
        ? 'prop'
        : 'subject';
    return [{
      id: `ai-layer-${Date.now()}-${index}`,
      name: String(item?.name || (category === 'subject' ? '主体' : category === 'stage' ? '承载舞台' : '关联道具')).slice(0, 24),
      category,
      box: [x1, y1, x2, y2] as [number, number, number, number],
      point,
      reason: String(item?.reason || '').slice(0, 80),
    }];
  });
  if (!objects.some((item) => item.category === 'subject')) throw new Error('没有识别到需要保留的主体');
  if (!objects.some((item) => item.category === 'stage')) throw new Error('没有识别到主体所在的承载舞台');
  return objects;
};

export const analyzePopupSemanticLayers = async (
  agentConfig: PromptAgentConfig,
  imageUrl: string,
) => {
  const baseUrl = normalizeBaseUrl(agentConfig.baseUrl.trim() || DEFAULT_PROMPT_AGENT_CONFIG.baseUrl);
  const path = agentConfig.path.trim() || '/v1/chat/completions';
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const apiKey = agentConfig.apiKey.trim();
  if (!apiKey) throw new Error('未检测到语言模型 API Key，请先在“角色海报 → 初始设置 → 语言模型”中填写并保存');
  const instruction = [
    '你是视觉素材语义分层助手。请分析这张动态营销弹窗中间素材的画面。',
    '目标是自动保留一个完整、语义关联的前景组合：',
    '1. subject：核心角色、IP、人物或用户明确展示的主体，必须包含完整身体和附着装饰。',
    '2. stage：承载主体的独立小舞台、草坪、展台、地基、底座及其自然接触阴影，必须包含完整底部轮廓。',
    '3. prop：位于小舞台上、与主题或主体强相关的道具，例如球门、足球、奖杯、礼盒。每个独立道具单独返回。',
    '不要保留：外围海报背景板、大面积纯色或渐变背景、文字、按钮、Logo、水印、与主舞台无关的装饰。',
    '为每个需要保留的对象给出紧贴完整轮廓的归一化坐标框 box=[x1,y1,x2,y2]，左上角为[0,0]，右下角为[1,1]。',
    '同时给出一个位于该对象内部、最能代表它的点 point=[x,y]。坐标必须严格限制在0到1之间。',
    '严格只输出JSON，不要Markdown或解释：',
    '{"objects":[{"name":"JOY角色","category":"subject","box":[0.2,0.1,0.7,0.8],"point":[0.45,0.4],"reason":"核心主体"},{"name":"圆形草坪舞台","category":"stage","box":[0.1,0.45,0.9,0.9],"point":[0.5,0.75],"reason":"承载主体的底座"}]}',
  ].join('\n');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 90_000);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(path.includes('/responses') ? {
        model: agentConfig.model.trim() || GPT55_PROMPT_AGENT_CONFIG.model,
        input: [{
          role: 'user',
          content: [
            { type: 'input_image', image_url: imageUrl },
            { type: 'input_text', text: instruction },
          ],
        }],
      } : {
        model: agentConfig.model.trim() || GPT55_PROMPT_AGENT_CONFIG.model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: instruction },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        }],
        ...chatSamplingParams(agentConfig.model, 0.1),
      }),
      signal: controller.signal,
    });
    const raw = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(raw?.error?.message || raw?.message || `图像理解失败 (${response.status})`);
    return parsePopupSemanticLayers(readAgentText(raw));
  } finally {
    window.clearTimeout(timeout);
  }
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
          {
            role: 'user',
            content: referenceImage && !referenceImage.startsWith('blob:')
              ? [
                { type: 'text', text: userPrompt },
                { type: 'image_url', image_url: { url: referenceImage } },
              ]
              : userPrompt,
          },
        ],
        ...chatSamplingParams(agentConfig.model, 0.6),
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
    '你是角色海报场景取景助手。请观察用户框选的参考照片，为后续卡通海报生图提供三个简短取景方案。',
    locationName.trim()
      ? `用户补充的场景备注是：${locationName.trim()}。这条备注只用于辅助理解；如果与参考照片冲突，必须以照片为准。`
      : '用户没有填写场景备注，请完全依据参考照片理解场景，不要猜测或补充具体地名。',
    strategyInstruction,
    `目标摄像机参数是主方案的锚点：${rotationInstruction}；${tiltInstruction}；${zoomInstruction}。`,
    '参考照片是场景身份、建筑结构和空间布局的最高优先级依据。必须保留主体建筑、主要树木或道路及其真实相对位置，让结果明确是同一个地点。',
    '允许在原拍摄位置附近前移、侧移或小幅旋转镜头，以生成同一场景的其他角度。不得移动或替换现有景物、改造建筑、交换前后关系、加入新的地标，或把元素重新组合成另一个场景。',
    '照片未展示的侧面只能做保守、连续且符合原建筑结构的延伸，不要凭空设计新的主体。',
    '每个方案只需概括主体、前中后景、自然光线和视觉重心，不要进行过细描述。场景构图的美感与层次完整优先。',
    '不要添加照片里没有的物件，不要描述人物、品牌、文字、Logo、画风、材质、色彩风格或生成参数。',
    '三个方案必须形成一眼可辨的构图差异：方案1最接近目标摄像机参数，以主体和场景全貌为核心；方案2在原拍摄点附近做水平方向的左前或右前侧移，用前景形成引导；方案3改变观察高度或景别，在高机位俯视、低机位仰视、近景或广角中选择适合照片的一种。三个方案不得使用相同的机位方位和主体落点。',
    '每个方案必须明确写出机位方位、景别、主体落点以及前中后景关系，同时保持同一真实场景的空间连续性。每个控制在55到90个汉字。',
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
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: instruction },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        }],
        ...chatSamplingParams(agentConfig.model, 0.35),
      }),
      signal: controller.signal,
    });
    const raw = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(raw?.error?.message || raw?.message || `场景分析失败 (${response.status})`);
    return parseSceneOptions(readAgentText(raw));
  } finally {
    window.clearTimeout(timeout);
  }
};

export const describeAtlasTextSceneOptions = async (
  agentConfig: PromptAgentConfig,
  currentConfig: ModelConfig,
  sceneConcept: string,
  locationName: string,
  ratio: string,
) => {
  const baseUrl = normalizeBaseUrl(agentConfig.baseUrl.trim() || currentConfig.baseUrl.trim());
  const path = agentConfig.path.trim() || '/api/v3/responses';
  const url = `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const apiKey = agentConfig.apiKey.trim() || currentConfig.apiKey.trim();
  if (!agentConfig.model.trim()) throw new Error('请先填写 Agent 模型名称');
  if (!baseUrl) throw new Error('请先填写 Agent Base URL');

  const instruction = [
    '你是角色海报的场景策划与取景助手。',
    '用户没有上传参考图，请只依据文字描述，为后续卡通拟物场景生图整理三个简短、可执行的画面方案。',
    `用户的核心场景描述是：${sceneConcept.trim()}。`,
    locationName.trim() ? `用户补充的地点或场景名称是：${locationName.trim()}。` : '',
    `最终画面比例是：${ratio}。`,
    '先理解场景主体、时间或天气、氛围、空间层次和希望传达的感受，再把信息组织成可直接用于生图的画面描述。',
    '三个方案必须忠实保留用户的核心创意，但采用明显不同的构图和机位：方案1使用能清楚建立环境的主视角；方案2采用侧向或低机位，让前景形成引导；方案3采用高机位、近景或更开阔的景别，形成不同观看感受。',
    '每个方案都要明确主体落点、前景、中景、远景、自然光线和视觉重心。不要添加人物、品牌、文字、Logo、材质风格或模型参数。',
    '描述应有画面感但不要堆砌关键词，每个方案控制在55到100个汉字。',
    '严格输出三行，格式为“方案1：...”“方案2：...”“方案3：...”，不要解释，不要Markdown。',
  ].filter(Boolean).join('');

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
          content: [{ type: 'input_text', text: instruction }],
        }],
      } : {
        model: agentConfig.model.trim(),
        messages: [{ role: 'user', content: instruction }],
        ...chatSamplingParams(agentConfig.model, 0.55),
      }),
      signal: controller.signal,
    });
    const raw = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(raw?.error?.message || raw?.message || `场景分析失败 (${response.status})`);
    return parseSceneOptions(readAgentText(raw));
  } finally {
    window.clearTimeout(timeout);
  }
};
