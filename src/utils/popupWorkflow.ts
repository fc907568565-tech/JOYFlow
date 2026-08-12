export type PopupStage = 'setup' | 'scene' | 'subject' | 'cutout' | 'compose' | 'motion' | 'export';

export interface PopupCutoutSettings {
  algorithmVersion: 3;
  backgroundMode: 'auto' | 'manual';
  backgroundColor: string;
  threshold: number;
  feather: number;
  despill: number;
}

export interface PopupSceneRecipe {
  theme: string;
  structure: string;
  materialStyle: string;
  mood: string;
  lighting: string;
  surroundingElements: string;
  backgroundColor: string;
  pitch: number;
  yaw: number;
  focalLength: number;
  freeNotes: string;
}

export interface PopupLayout {
  canvasWidth: number;
  canvasHeight: number;
  titleText: string;
  titleY: number;
  titleScale: number;
  visualX: number;
  visualY: number;
  visualScale: number;
  buttonText: string;
  buttonY: number;
  buttonScale: number;
}

export interface PopupProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  currentStage: PopupStage;
  sceneRecipe: PopupSceneRecipe;
  scenePrompt: string;
  sceneRevision: number;
  selectedSceneId?: string;
  selectedSubjectId?: string;
  selectedCompositeId?: string;
  selectedCutoutId?: string;
  motionInputId?: string;
  selectedMotionId?: string;
  joyState?: Record<string, unknown>;
  cutoutSettings: PopupCutoutSettings;
  layout: PopupLayout;
}

const ACTIVE_PROJECT_KEY = 'joyflow_popup_active_project_v1';

export const POPUP_RECIPE_PRESETS = {
  theme: ['体育运动', '节日庆典', '会员权益', '游戏活动', '新品发布'],
  structure: [
    '一个迷你圆形足球场草坪，草坪上有一个球门，球门旁边有一个奖杯，草坪上还有一两个足球',
    '一个迷你庆典舞台，左右有彩带与礼盒，中央留出完整的主体空间',
    '一个精致的会员礼遇展台，周围点缀徽章、礼盒和柔和光环',
  ],
  materialStyle: [
    '3D卡通，材质偏真实细腻，颜色鲜艳不暗沉',
    '三渲二卡通，形体简洁，边缘清晰，材质精致',
    '软质黏土风格，圆润亲和，颜色明快',
  ],
  mood: ['温馨氛围', '热烈庆典氛围', '轻松活泼氛围', '高级精致氛围'],
  lighting: ['全局光照，明亮', '柔和棚拍光，主体区域明亮', '明亮日光，阴影轻柔'],
  surroundingElements: ['无', '少量彩带与星光', '少量礼盒与徽章', '少量花草与粒子'],
} as const;

export const DEFAULT_POPUP_RECIPE: PopupSceneRecipe = {
  theme: POPUP_RECIPE_PRESETS.theme[0],
  structure: POPUP_RECIPE_PRESETS.structure[0],
  materialStyle: POPUP_RECIPE_PRESETS.materialStyle[0],
  mood: POPUP_RECIPE_PRESETS.mood[0],
  lighting: POPUP_RECIPE_PRESETS.lighting[0],
  surroundingElements: POPUP_RECIPE_PRESETS.surroundingElements[0],
  backgroundColor: '#ff00ff',
  pitch: 5,
  yaw: 0,
  focalLength: 50,
  freeNotes: '',
};

export const DEFAULT_POPUP_LAYOUT: PopupLayout = {
  canvasWidth: 720,
  canvasHeight: 900,
  titleText: '限时好礼 等你来拿',
  titleY: 0.14,
  titleScale: 1,
  visualX: 0.5,
  visualY: 0.5,
  visualScale: 0.72,
  buttonText: '立即参与',
  buttonY: 0.84,
  buttonScale: 1,
};

export const DEFAULT_POPUP_CUTOUT: PopupCutoutSettings = {
  algorithmVersion: 3,
  backgroundMode: 'auto',
  backgroundColor: '#ff00ff',
  threshold: 28,
  feather: 8,
  despill: 0.35,
};

const colorName = (hex: string) => `${hex} 纯色抠图背景`;

export const buildPopupScenePrompt = (recipe: PopupSceneRecipe, cameraAdjustment = false) => {
  const camera = `正面视角，轻微俯视 ${recipe.pitch}°，水平偏转 ${recipe.yaw}°，${recipe.focalLength}mm 镜头`;
  const fixedBackground = recipe.backgroundColor.toUpperCase();
  const prefix = cameraAdjustment
    ? '基于参考图重新构图，仅调整相机机位与透视关系，保持主题、物体、材质、颜色和主体留白区域一致。'
    : '生成一个用于动态营销弹窗的独立微缩场景。';
  return [
    prefix,
    `硬性抠图要求：画布中除独立小舞台及其主体物外，所有区域必须使用完全一致的 ${fixedBackground} 纯色背景。`,
    `主题：${recipe.theme}。`,
    `场景结构：${recipe.structure}。`,
    `材质风格：${recipe.materialStyle}。`,
    `氛围与光线：${recipe.mood}，${recipe.lighting}。`,
    `周围元素：${recipe.surroundingElements}。`,
    `视角机位：${camera}。`,
    '场景必须是一个局部独立的小舞台，中央保留约 45% 空间用于后续植入角色。',
    '所有物体完整、不切边，轮廓清晰，视觉重心集中。',
    '不生成角色、人物、IP、文字、按钮、Logo、页面背景或完整海报。',
    `背景固定为 ${colorName(fixedBackground)}。从画布四角、四条边到主体轮廓外侧，RGB 数值必须保持完全一致。`,
    '禁止摄影棚地面、墙面、地平线、渐变、光晕、暗角、噪点、纹理、反射、背景投影、文字或水印。',
    '只允许小舞台内部和物体接触处出现阴影，任何阴影都不能落到纯色背景上。',
    recipe.freeNotes.trim() ? `补充要求：${recipe.freeNotes.trim()}。` : '',
    `再次确认：背景不是场景内容，必须是单一、平坦、无任何变化的 ${fixedBackground} 纯色。`,
  ].filter(Boolean).join('\n');
};

const makeProject = (): PopupProject => {
  const now = Date.now();
  const recipe = { ...DEFAULT_POPUP_RECIPE };
  return {
    id: `popup_${now}_${Math.random().toString(36).slice(2, 8)}`,
    name: `动态弹窗 ${new Date(now).toLocaleDateString()}`,
    createdAt: now,
    updatedAt: now,
    currentStage: 'setup',
    sceneRecipe: recipe,
    scenePrompt: buildPopupScenePrompt(recipe),
    sceneRevision: 0,
    cutoutSettings: { ...DEFAULT_POPUP_CUTOUT, backgroundColor: recipe.backgroundColor },
    layout: { ...DEFAULT_POPUP_LAYOUT },
  };
};

export const loadActivePopupProject = (): PopupProject | null => {
  try {
    const raw = localStorage.getItem(ACTIVE_PROJECT_KEY);
    return raw ? JSON.parse(raw) as PopupProject : null;
  } catch {
    return null;
  }
};

export const saveActivePopupProject = (project: PopupProject): PopupProject => {
  const next = { ...project, updatedAt: Date.now() };
  localStorage.setItem(ACTIVE_PROJECT_KEY, JSON.stringify(next));
  return next;
};

export const createPopupProject = (): PopupProject => saveActivePopupProject(makeProject());

export const ensureActivePopupProject = (): PopupProject => {
  const current = loadActivePopupProject();
  if (!current) return createPopupProject();
  const pitch = Math.min(15, Math.max(0, current.sceneRecipe.pitch));
  const scenePrompt = current.scenePrompt
    .replace(/高机位(?:俯视)?\s*/g, '正面视角，轻微俯视 ')
    .replace(/轻微俯视\s*-?\d+(?:\.\d+)?°/g, `轻微俯视 ${pitch}°`);
  const usesCurrentCutoutAlgorithm = current.cutoutSettings?.algorithmVersion === 3;
  const cutoutSettings: PopupCutoutSettings = usesCurrentCutoutAlgorithm
    ? {
        ...DEFAULT_POPUP_CUTOUT,
        backgroundColor: current.sceneRecipe.backgroundColor,
        ...current.cutoutSettings,
        threshold: Math.min(90, Math.max(10, current.cutoutSettings.threshold)),
        feather: Math.min(28, Math.max(2, current.cutoutSettings.feather)),
      }
    : {
        ...DEFAULT_POPUP_CUTOUT,
        backgroundColor: current.sceneRecipe.backgroundColor,
      };
  const cutoutSettingsUnchanged = Boolean(current.cutoutSettings)
    && current.cutoutSettings.algorithmVersion === cutoutSettings.algorithmVersion
    && current.cutoutSettings.backgroundMode === cutoutSettings.backgroundMode
    && current.cutoutSettings.backgroundColor === cutoutSettings.backgroundColor
    && current.cutoutSettings.threshold === cutoutSettings.threshold
    && current.cutoutSettings.feather === cutoutSettings.feather
    && current.cutoutSettings.despill === cutoutSettings.despill;
  if (scenePrompt === current.scenePrompt && pitch === current.sceneRecipe.pitch && cutoutSettingsUnchanged) return current;
  return saveActivePopupProject({
    ...current,
    scenePrompt,
    sceneRecipe: { ...current.sceneRecipe, pitch },
    cutoutSettings,
  });
};

export const patchActivePopupProject = (patch: Partial<PopupProject>): PopupProject | null => {
  const current = loadActivePopupProject();
  if (!current) return null;
  return saveActivePopupProject({ ...current, ...patch });
};
