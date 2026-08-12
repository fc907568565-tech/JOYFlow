import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles,
  Image as ImageIcon,
  Clapperboard,
  KeyRound,
  Link as LinkIcon,
  Clock3,
  LoaderCircle,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Download,
  Save,
  Trash2,
  ChevronDown,
  ChevronRight,
  Upload,
  X,
  Film,
  Package,
  Bot,
  Settings2,
  WandSparkles,
  Undo2,
  Plus,
  AlignLeft,
  Camera,
  Maximize2,
  SlidersHorizontal,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import {
  DEFAULT_MODEL_CONFIG,
  DEFAULT_PAYLOAD,
  TASK_STATUS_TEXT,
  type GeneratePayload,
  type GenerateTask,
  type ModelConfig,
  type NormalizedTaskResult,
} from '../ai/types';
import { pollTaskUntilDone, submitGenerateTask } from '../ai/client';
import { isCoreImagePreset, presetSupportsKind, rememberModelSecrets, useModelPresets } from '../ai/presets';
import { addToLibrary } from '../utils/assetLibrary';
import type { LibraryAsset } from '../utils/assetLibrary';
import { loadAIHistory, saveAIHistory } from '../utils/aiHistory';
import {
  loadPromptAgentConfig,
  optimizeGenerationPrompt,
  savePromptAgentConfig,
  type PromptAgentConfig,
} from '../ai/promptAgent';
import { AssetLibrary } from './AssetLibrary';
import { SceneRegionEditor, type SceneEditRegion } from './SceneRegionEditor';

const isVideoUrl = (url: string) => /\.(mp4|webm|mov)(\?|$)/i.test(url);

const SEEDANCE_PIXEL_SIZES = {
  '480p': {
    '16:9': '864×496', '4:3': '752×560', '1:1': '640×640',
    '3:4': '560×752', '9:16': '496×864', '21:9': '992×432',
  },
  '720p': {
    '16:9': '1280×720', '4:3': '1112×834', '1:1': '960×960',
    '3:4': '834×1112', '9:16': '720×1280', '21:9': '1470×630',
  },
} as const;

const SEEDANCE_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'] as const;

const updateTask = (tasks: GenerateTask[], id: string, patch: Partial<GenerateTask>) =>
  tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));

interface ScenePromptBlock {
  id: string;
  label: string;
  text: string;
  freeform?: boolean;
}

const SCENE_BLOCK_RULES = [
  { label: '光线与氛围', pattern: /光|影|晴|阴|雾|雨|晨|午后|黄昏|夜|氛围|明亮|柔和|温暖|冷调/ },
  { label: '构图与空间', pattern: /前景|中景|后景|构图|画面|左侧|右侧|中央|中心|层次|空间|视角|机位|留白/ },
  { label: '视觉重点', pattern: /突出|强调|聚焦|重点|视觉重心|辨识度|主体占据|引导线/ },
] as const;

const cleanSceneClause = (value: string) =>
  value.trim().replace(/^[，。；;、\s]+|[，。；;、\s]+$/g, '');

const parseScenePromptBlocks = (prompt: string): ScenePromptBlock[] => {
  const normalized = prompt.trim().replace(/\r/g, '');
  if (!normalized) return [];
  let clauses = normalized
    .split(/[\n。；;]+/)
    .map(cleanSceneClause)
    .filter(Boolean);
  if (clauses.length < 3) {
    clauses = normalized
      .split(/[，,]+/)
      .map(cleanSceneClause)
      .filter(Boolean);
  }
  if (clauses.length > 6) {
    clauses = [...clauses.slice(0, 5), clauses.slice(5).join('，')];
  }
  const usedLabels = new Set<string>();
  return clauses.map((text, index) => {
    const spatialLabel = /前景/.test(text) ? '前景层次'
      : /中景/.test(text) ? '中景层次'
        : /远景|背景|天际|海平线/.test(text) ? '远景层次'
          : null;
    const matched = SCENE_BLOCK_RULES.find((rule) => rule.pattern.test(text) && !usedLabels.has(rule.label));
    const label = spatialLabel
      || matched?.label
      || (index === 0 ? '主体与地点' : `场景细节 ${index}`);
    usedLabels.add(label);
    return { id: `scene-block-${index}-${label}`, label, text };
  });
};

const composeScenePrompt = (blocks: ScenePromptBlock[]) => {
  const clauses = blocks.map((block) => cleanSceneClause(block.text)).filter(Boolean);
  return clauses.length ? `${clauses.join('，')}。` : '';
};

type SceneDepth = 'foreground' | 'midground' | 'background';
type SceneLayout = 'landmark' | 'guided' | 'layered';
type SceneSubjectSide = 'left' | 'center' | 'right';
type SceneShapeKind = 'mass' | 'ribbon' | 'cluster' | 'plane';
type SceneCameraPlacement = 'front' | 'left' | 'right' | 'high';

interface SceneVisualPlan {
  title: string;
  camera: string;
  light: string;
  focus: string;
  layout: SceneLayout;
  subjectSide: SceneSubjectSide;
  subjectScale: 'compact' | 'normal' | 'large';
  cameraPlacement: SceneCameraPlacement;
  seed: number;
  shapes: Record<SceneDepth, SceneShapeKind>;
  layers: Record<SceneDepth, string>;
}

const SCENE_LAYER_CANDIDATES: Record<SceneDepth, string[]> = {
  foreground: ['道路', '草坡', '草地', '植物', '花丛', '围栏', '台阶', '水面', '河流', '自然景观'],
  midground: ['主体建筑', '建筑群', '建筑', '地标', '商店', '站台', '车辆', '火车', '海面', '主体'],
  background: ['远山', '山体', '天空', '云层', '海面', '树林', '天际线', '建筑群', '环境'],
};

const SCENE_LAYER_FALLBACKS: Record<SceneDepth, string> = {
  foreground: '近景引导',
  midground: '主体建筑',
  background: '环境层次',
};

const SCENE_LAYER_META = [
  { depth: 'background', label: '远景', dotClass: 'bg-[#477291]', labelClass: 'text-sky-200/80' },
  { depth: 'midground', label: '中景', dotClass: 'bg-[#477562]', labelClass: 'text-emerald-200/80' },
  { depth: 'foreground', label: '前景', dotClass: 'bg-[#8b6f51]', labelClass: 'text-amber-200/80' },
] as const;

const hashSceneText = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const seededSceneValue = (seed: number, salt: number) => {
  const value = Math.sin((seed + salt * 1013) * 0.0000137) * 43758.5453;
  return value - Math.floor(value);
};

const inferSceneShape = (label: string): SceneShapeKind => {
  if (/道路|河流|水面|海面|轨道|桥|路径/.test(label)) return 'ribbon';
  if (/植物|草|花|树林|树木|自然|云/.test(label)) return 'cluster';
  if (/建筑|地标|主体|商店|站台|车辆|火车/.test(label)) return 'mass';
  return 'plane';
};

const detectCameraPlacement = (prompt: string): SceneCameraPlacement | null => {
  if (/高机位|俯视|鸟瞰/.test(prompt)) return 'high';
  if (/左侧|左前方|左旋/.test(prompt)) return 'left';
  if (/右侧|右前方|右旋/.test(prompt)) return 'right';
  if (/正面/.test(prompt)) return 'front';
  return null;
};

const extractSceneLayerLabel = (prompt: string, depth: SceneDepth) => {
  const depthPattern = depth === 'foreground'
    ? /前景(?:承接|保留|使用|采用|设置|安排|放置|为|是)?([^，。；\n]{1,22})/
    : depth === 'midground'
      ? /中景(?:承接|保留|使用|采用|设置|安排|放置|完整呈现|为|是)?([^，。；\n]{1,22})/
      : /(?:远景|后景|背景)(?:承接|保留|使用|采用|设置|安排|放置|保持|为|是)?([^，。；\n]{1,22})/;
  const explicitClause = prompt.match(depthPattern)?.[1] || '';
  const candidates = SCENE_LAYER_CANDIDATES[depth];
  const explicitMatch = candidates.find((candidate) => explicitClause.includes(candidate));
  if (explicitMatch) return explicitMatch;
  const globalMatch = candidates.find((candidate) => prompt.includes(candidate));
  return globalMatch || SCENE_LAYER_FALLBACKS[depth];
};

const buildSceneVisualPlan = (
  prompt: string,
  index: number,
  fallbackCameraPlacement: SceneCameraPlacement,
): SceneVisualPlan => {
  const hasCloseView = /近景|靠近|放大|特写|主体占据/.test(prompt);
  const hasWideView = /全景|广角|完整呈现|完整保留/.test(prompt);
  const hasGuidedForeground = /引导线|道路|前景承接|自然景观/.test(prompt);
  const hasLayeredView = /层次|前中后景|纵深|空间关系/.test(prompt);
  const seed = hashSceneText(`${prompt}-${index}`);
  const cameraPlacement = detectCameraPlacement(prompt) || fallbackCameraPlacement;
  const side: SceneSubjectSide = /左侧|左前方/.test(prompt)
    ? 'left'
    : /右侧|右前方/.test(prompt)
      ? 'right'
      : seededSceneValue(seed, 3) < 0.33
        ? 'left'
        : seededSceneValue(seed, 3) > 0.72
          ? 'right'
          : 'center';
  const layout: SceneLayout = hasGuidedForeground && index === 1
    ? 'guided'
    : hasLayeredView && index > 0
      ? 'layered'
      : 'landmark';
  const title = /主体轮廓/.test(prompt)
    ? '轮廓优先'
    : /侧移|侧向|左侧|右侧/.test(prompt)
      ? '侧向取景'
      : hasCloseView
        ? '主体近景'
        : hasWideView && index === 0
          ? '完整全景'
          : layout === 'guided'
            ? '前景引导'
            : layout === 'layered'
              ? '纵深层次'
              : ['地标主导', '前景引导', '层次展开'][index] || '空间构图';
  const cameraTokens = [
    prompt.match(/正面|左侧|右侧|侧向|环绕/)?.[0],
    prompt.match(/平视|低机位|高机位|仰视|俯视/)?.[0],
    prompt.match(/特写|近景|中景|全景|广角/)?.[0],
  ].filter(Boolean);
  const cameraPlacementLabel: Record<SceneCameraPlacement, string> = {
    front: '正面',
    left: '左侧',
    right: '右侧',
    high: '高机位',
  };
  const light = prompt.match(/清晨|午后|黄昏|夜景|夜晚|自然光|柔和光|暖光|冷光|薄雾|晴天|阴天/)?.[0] || '自然光';
  const focusMatch = prompt.match(/(?:视觉重心|视觉重点|视觉焦点|聚焦|突出|强调)(?:在|为|是|放在)?([^，。；\n]{1,12})/)?.[1]
    || prompt.match(/(?:重心|焦点)(?:落在|位于)([^，。；\n]{1,12})/)?.[1];
  const focus = focusMatch?.replace(/^(主体|画面)/, '').trim()
    || extractSceneLayerLabel(prompt, 'midground');
  const layers = {
    foreground: extractSceneLayerLabel(prompt, 'foreground'),
    midground: extractSceneLayerLabel(prompt, 'midground'),
    background: extractSceneLayerLabel(prompt, 'background'),
  };

  return {
    title,
    camera: cameraTokens.slice(0, 2).join(' · ') || `${cameraPlacementLabel[cameraPlacement]} · ${hasWideView ? '全景' : hasCloseView ? '近景' : '中景'}`,
    light,
    focus,
    layout,
    subjectSide: side,
    subjectScale: hasCloseView ? 'large' : hasWideView ? 'compact' : 'normal',
    cameraPlacement,
    seed,
    shapes: {
      foreground: inferSceneShape(layers.foreground),
      midground: inferSceneShape(layers.midground),
      background: inferSceneShape(layers.background),
    },
    layers,
  };
};

const buildSceneVisualPlans = (prompts: string[]) => {
  const explicitPlacements = new Set(prompts.map(detectCameraPlacement).filter(Boolean));
  const fallbackOrders: SceneCameraPlacement[][] = [
    ['front', 'left', 'right', 'high'],
    ['left', 'right', 'high', 'front'],
    ['right', 'high', 'left', 'front'],
  ];
  const usedPlacements = new Set<SceneCameraPlacement>();

  return prompts.map((prompt, index) => {
    const explicitPlacement = detectCameraPlacement(prompt);
    const candidates = fallbackOrders[index] || fallbackOrders[0];
    const fallbackPlacement = candidates.find((placement) => (
      !usedPlacements.has(placement) && !explicitPlacements.has(placement)
    )) || candidates.find((placement) => !usedPlacements.has(placement)) || candidates[0];
    const plan = buildSceneVisualPlan(prompt, index, explicitPlacement || fallbackPlacement);
    usedPlacements.add(plan.cameraPlacement);
    return plan;
  });
};

const AbstractSceneShape: React.FC<{
  kind: SceneShapeKind;
  x: number;
  y: number;
  scale: number;
  color: string;
  seed: number;
  emphasis?: boolean;
}> = ({ kind, x, y, scale, color, seed, emphasis = false }) => {
  const rotation = Math.round((seededSceneValue(seed, 17) - 0.5) * 24);
  const opacity = emphasis ? 0.92 : 0.58;

  if (kind === 'ribbon') {
    const bend = Math.round((seededSceneValue(seed, 19) - 0.5) * 18);
    return (
      <g transform={`translate(${x} ${y}) scale(${scale}) rotate(${rotation})`} opacity={opacity}>
        <path d={`M-30 ${bend} C-14 ${-8 - bend}, 12 ${8 + bend}, 31 ${-bend}`} fill="none" stroke={color} strokeWidth={emphasis ? 10 : 7} strokeLinecap="round" />
        <path d={`M-30 ${bend} C-14 ${-8 - bend}, 12 ${8 + bend}, 31 ${-bend}`} fill="none" stroke="#d9ffff" strokeOpacity="0.2" strokeWidth="1" strokeDasharray="3 3" />
      </g>
    );
  }

  if (kind === 'cluster') {
    return (
      <g transform={`translate(${x} ${y}) scale(${scale})`} opacity={opacity}>
        <circle cx="-15" cy="1" r="8" fill={color} />
        <circle cx="-3" cy="-6" r="11" fill={color} />
        <circle cx="11" cy="0" r="9" fill={color} />
        <circle cx="20" cy="-4" r="5" fill={color} opacity="0.68" />
        <circle cx="-22" cy="-6" r="4" fill={color} opacity="0.6" />
      </g>
    );
  }

  if (kind === 'mass') {
    const horizontal = seededSceneValue(seed, 23) > 0.55;
    const width = horizontal ? 38 : 27;
    const height = horizontal ? 17 : 28;
    return (
      <g transform={`translate(${x} ${y}) scale(${scale}) rotate(${rotation * 0.35})`} opacity={opacity}>
        <ellipse cx="2" cy="4" rx={width * 0.62} ry="5" fill="#061012" opacity="0.5" />
        <rect x={-width / 2} y={-height} width={width} height={height} rx="4" fill={color} />
        <polygon points={`${width / 2},${-height} ${width / 2 + 8},${-height + 5} ${width / 2 + 8},4 ${width / 2},0`} fill={color} opacity="0.45" />
        <path d={`M${-width / 2 + 5} ${-height + 7} H${width / 2 - 5}`} stroke="#e8ffff" strokeOpacity="0.24" strokeWidth="1.2" />
      </g>
    );
  }

  return (
    <g transform={`translate(${x} ${y}) scale(${scale}) rotate(${rotation})`} opacity={opacity}>
      <polygon points="-29,-7 -8,-16 29,-8 17,12 -19,14" fill={color} />
      <polygon points="-19,14 17,12 12,18 -23,19" fill={color} opacity="0.46" />
      <path d="M-19 4 L18 -4" stroke="#e8ffff" strokeOpacity="0.18" strokeWidth="1" />
    </g>
  );
};

const ScenePlanPreview: React.FC<{ plan: SceneVisualPlan }> = ({ plan }) => {
  const isHighView = plan.cameraPlacement === 'high';
  const cameraMap: Record<SceneCameraPlacement, { x: number; y: number; vanishX: number; vanishY: number }> = {
    front: { x: 80, y: 101, vanishX: 80, vanishY: 30 },
    left: { x: 18, y: 96, vanishX: 111, vanishY: 34 },
    right: { x: 142, y: 96, vanishX: 49, vanishY: 34 },
    high: { x: 137, y: 18, vanishX: 77, vanishY: 67 },
  };
  const camera = cameraMap[plan.cameraPlacement];
  const subjectBaseX = plan.subjectSide === 'left' ? 53 : plan.subjectSide === 'right' ? 109 : 80;
  const subjectX = Math.max(35, Math.min(125, subjectBaseX + Math.round((seededSceneValue(plan.seed, 29) - 0.5) * 15)));
  const subjectY = isHighView ? 59 : 70;
  const subjectScale = plan.subjectScale === 'large' ? 1.06 : plan.subjectScale === 'compact' ? 0.72 : 0.88;
  const farX = Math.max(28, Math.min(132, camera.vanishX + Math.round((seededSceneValue(plan.seed, 31) - 0.5) * 54)));
  const foreX = Math.max(28, Math.min(132, 80 + Math.round((seededSceneValue(plan.seed, 37) - 0.5) * 92)));
  const guideControlX = Math.round((camera.x + subjectX) / 2 + (seededSceneValue(plan.seed, 41) - 0.5) * 18);
  const cameraLeft = `${(camera.x / 160) * 100}%`;
  const cameraTop = `${(camera.y / 110) * 100}%`;

  return (
    <div className="relative aspect-[16/11] overflow-hidden rounded-md border border-white/10 bg-[#0d1518] shadow-inner">
      <svg viewBox="0 0 160 110" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <rect width="160" height="110" fill="#0d1518" />

        {isHighView ? (
          <>
            <polygon points="80,19 136,45 80,72 24,45" fill="#263b48" stroke="#5e7f91" strokeOpacity="0.32" />
            <polygon points="80,34 153,68 80,102 7,68" fill="#29463f" stroke="#6f9889" strokeOpacity="0.28" />
            <polygon points="80,52 160,89 113,110 47,110 0,89" fill="#514535" stroke="#9b8263" strokeOpacity="0.24" />
            <g fill="none" stroke="#d8eeea" strokeOpacity="0.12" strokeWidth="0.7">
              <path d="M80 19 V102" />
              <path d="M24 45 L136 45" />
              <path d="M7 68 L153 68" />
              <path d="M32 57 L80 80 L128 57" />
              <path d="M18 80 L80 109 L142 80" />
            </g>
          </>
        ) : (
          <>
            <rect width="160" height="38" fill="#16242c" />
            <polygon points={`${camera.vanishX - 19},36 ${camera.vanishX + 19},36 ${camera.vanishX + 39},54 ${camera.vanishX - 39},54`} fill="#263f4d" stroke="#5e8092" strokeOpacity="0.3" />
            <polygon points={`${camera.vanishX - 39},54 ${camera.vanishX + 39},54 ${Math.min(157, camera.vanishX + 70)},82 ${Math.max(3, camera.vanishX - 70)},82`} fill="#29483f" stroke="#6d9786" strokeOpacity="0.26" />
            <polygon points={`${Math.max(3, camera.vanishX - 70)},82 ${Math.min(157, camera.vanishX + 70)},82 160,110 0,110`} fill="#514535" stroke="#9a8262" strokeOpacity="0.22" />
            <g fill="none" stroke="#d8eeea" strokeOpacity="0.12" strokeWidth="0.7">
              <path d={`M${camera.vanishX} ${camera.vanishY} L4 110`} />
              <path d={`M${camera.vanishX} ${camera.vanishY} L43 110`} />
              <path d={`M${camera.vanishX} ${camera.vanishY} L117 110`} />
              <path d={`M${camera.vanishX} ${camera.vanishY} L156 110`} />
              <path d={`M${camera.vanishX - 28} 47 L${camera.vanishX + 28} 47`} />
              <path d={`M${Math.max(8, camera.vanishX - 52)} 65 L${Math.min(152, camera.vanishX + 52)} 65`} />
              <path d="M10 91 H150" />
            </g>
          </>
        )}

        <AbstractSceneShape kind={plan.shapes.background} x={farX} y={isHighView ? 38 : 45} scale={0.46 + seededSceneValue(plan.seed, 43) * 0.2} color="#4f8198" seed={plan.seed + 1} />
        <AbstractSceneShape kind={plan.shapes.foreground} x={foreX} y={isHighView ? 82 : 91} scale={0.82 + seededSceneValue(plan.seed, 47) * 0.3} color="#a17e56" seed={plan.seed + 2} />

        {plan.layout === 'layered' && (
          <>
            <AbstractSceneShape kind="plane" x={38} y={isHighView ? 61 : 69} scale={0.48} color="#4e826c" seed={plan.seed + 4} />
            <AbstractSceneShape kind="cluster" x={128} y={isHighView ? 70 : 76} scale={0.42} color="#477961" seed={plan.seed + 5} />
          </>
        )}

        {plan.layout === 'guided' && (
          <path d={`M${foreX} 108 Q${guideControlX} 82 ${subjectX} ${subjectY + 1}`} fill="none" stroke="#b79161" strokeOpacity="0.72" strokeWidth="9" strokeLinecap="round" />
        )}

        <polygon points={`${camera.x},${camera.y} ${subjectX - 10},${subjectY - 10} ${subjectX + 10},${subjectY + 5}`} fill="#67e8f9" opacity="0.06" />
        <path d={`M${camera.x} ${camera.y} Q${guideControlX} ${Math.round((camera.y + subjectY) / 2)} ${subjectX} ${subjectY}`} fill="none" stroke="#87e9f4" strokeOpacity="0.5" strokeWidth="1.2" strokeDasharray="3 2" />
        <circle cx={subjectX} cy={subjectY} r={plan.subjectScale === 'large' ? 22 : 17} fill="none" stroke="#77e7f2" strokeOpacity="0.2" strokeDasharray="2 3" />
        <AbstractSceneShape kind={plan.shapes.midground} x={subjectX} y={subjectY} scale={subjectScale} color="#70dce3" seed={plan.seed + 3} emphasis />
      </svg>

      <div
        className="absolute z-20 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded border border-white/15 bg-[#071012]/90 px-1.5 py-1 text-[8px] font-medium text-cyan-100 shadow"
        style={{ left: cameraLeft, top: cameraTop }}
      >
        <Camera size={10} strokeWidth={2.2} />
        相机
      </div>
    </div>
  );
};

interface SceneOptionSummary {
  title: string;
  camera: string;
  feeling: string;
}

const buildSceneOptionSummary = (prompt: string, index: number): SceneOptionSummary => {
  const isHigh = /高机位|俯视|鸟瞰/.test(prompt);
  const isLow = /低机位|仰视/.test(prompt);
  const isLeft = /左侧|左前方|左旋/.test(prompt);
  const isRight = /右侧|右前方|右旋/.test(prompt);
  const isClose = /特写|近景|靠近|放大|主体占据/.test(prompt);
  const isWide = /全景|广角|完整呈现|完整保留/.test(prompt);
  const hasGuide = /引导线|道路|路径|前景承接/.test(prompt);
  const shot = isClose ? '近景' : isWide ? '全景' : '中景';
  const direction = isHigh
    ? '高机位'
    : isLow
      ? '低机位'
      : isLeft
        ? '左侧'
        : isRight
          ? '右侧'
          : '正面';

  if (isHigh) {
    return { title: '俯瞰层次', camera: `${direction} · ${shot}`, feeling: '空间关系更清楚，画面开阔而有秩序。' };
  }
  if (isLow) {
    return { title: '仰视张力', camera: `${direction} · ${shot}`, feeling: '主体更有存在感，画面张力和临场感更强。' };
  }
  if (isLeft || isRight) {
    return { title: '侧向展开', camera: `${direction} · ${shot}`, feeling: '空间从侧面展开，画面更有行进感和纵深。' };
  }
  if (isClose) {
    return { title: '贴近主体', camera: `${direction} · ${shot}`, feeling: '视线更集中，主体辨识度和临场感更强。' };
  }
  if (isWide) {
    return { title: '开阔全景', camera: `${direction} · ${shot}`, feeling: '环境完整舒展，适合建立地点的整体印象。' };
  }
  if (hasGuide) {
    return { title: '前景引导', camera: `${direction} · ${shot}`, feeling: '视线自然进入主体，画面路径更明确、更有深度。' };
  }
  const fallbacks: SceneOptionSummary[] = [
    { title: '稳定建立', camera: `${direction} · ${shot}`, feeling: '画面稳定清楚，主体与环境关系容易理解。' },
    { title: '空间展开', camera: `${direction} · ${shot}`, feeling: '场景层次逐步展开，观看节奏更舒展。' },
    { title: '纵深呼应', camera: `${direction} · ${shot}`, feeling: '前后空间相互呼应，画面更有探索感。' },
  ];
  return fallbacks[index] || fallbacks[0];
};

// 将文件转为 base64 data URL
const fileToDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

interface AIStudioProps {
  workflowProjectId?: string;
  workflowStage?: 'scene' | 'dynamic';
  workflowInputAsset?: LibraryAsset | null;
  workflowRatio?: string;
  workflowSize?: string;
  workflowPrompt?: string;
  workflowReferenceImages?: string[];
  workflowReferenceLabels?: string[];
  workflowPromptOptions?: string[];
  workflowPromptTemplate?: { prefix: string; suffix: string };
  workflowPromptMaxLength?: number;
  onWorkflowPromptChange?: (prompt: string) => void;
  onSelectResult?: (asset: LibraryAsset) => void;
}

export const AIStudio: React.FC<AIStudioProps> = ({
  workflowProjectId,
  workflowStage = 'scene',
  workflowInputAsset,
  workflowRatio,
  workflowSize,
  workflowPrompt,
  workflowReferenceImages,
  workflowReferenceLabels,
  workflowPromptOptions,
  workflowPromptTemplate,
  workflowPromptMaxLength,
  onWorkflowPromptChange,
  onSelectResult,
}) => {
  const [modelConfig, setModelConfig] = useState<ModelConfig>(DEFAULT_MODEL_CONFIG);
  const [payload, setPayload] = useState<GeneratePayload>(DEFAULT_PAYLOAD);
  const [tasks, setTasks] = useState<GenerateTask[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [configExpanded, setConfigExpanded] = useState(false);
  const [agentConfig, setAgentConfig] = useState<PromptAgentConfig>(() => loadPromptAgentConfig());
  const [agentExpanded, setAgentExpanded] = useState(false);
  const [isOptimizingPrompt, setIsOptimizingPrompt] = useState(false);
  const [selectingResult, setSelectingResult] = useState<string | null>(null);
  const [previousPrompt, setPreviousPrompt] = useState('');
  const [previewResult, setPreviewResult] = useState<{ url: string; task: GenerateTask } | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<{ url: string; task: GenerateTask } | null>(null);
  const [adjustPrompt, setAdjustPrompt] = useState('');
  const [adjustMask, setAdjustMask] = useState('');
  const [adjustRegion, setAdjustRegion] = useState<SceneEditRegion | null>(null);
  const [adjustMode, setAdjustMode] = useState<'region' | 'global'>('region');
  // 图生图 / 首尾帧参考图
  const [refImages, setRefImages] = useState<string[]>([]);
  const [firstFrame, setFirstFrame] = useState('');
  const [lastFrame, setLastFrame] = useState('');
  const [libraryTarget, setLibraryTarget] = useState<'ref' | 'first' | 'last' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const firstFrameRef = useRef<HTMLInputElement>(null);
  const lastFrameRef = useRef<HTMLInputElement>(null);
  const historyLoadedRef = useRef(false);
  const scenePresetInitializedRef = useRef<string | null>(null);
  const dynamicPresetInitializedRef = useRef<string | null>(null);

  const { allPresets, activePresetId, switchPreset, saveAsPreset, deletePreset } =
    useModelPresets(setModelConfig);

  const guidedImageWorkflow = Boolean(workflowProjectId && workflowStage === 'scene');
  const compatiblePresets = useMemo(
    () => allPresets.filter((preset) => (
      presetSupportsKind(preset, payload.kind)
      && (!guidedImageWorkflow || isCoreImagePreset(preset))
    )),
    [allPresets, guidedImageWorkflow, payload.kind]
  );
  const selectedPreset = compatiblePresets.find((preset) => preset.id === activePresetId);

  const visibleTasks = useMemo(() => {
    if (!workflowProjectId) return tasks;
    const expectedKind = workflowStage === 'dynamic' ? 'video' : 'image';
    return tasks.filter((task) => task.workflowProjectId === workflowProjectId && task.kind === expectedKind);
  }, [tasks, workflowProjectId, workflowStage]);
  const latestTask = visibleTasks[0] ?? null;
  const isSeedanceVideo = payload.kind === 'video' && /seedance/i.test(modelConfig.model);
  const isJdSeedanceTaskVideo = isSeedanceVideo
    && /\/jd-api(?:\/|$)|llm-gw\.jd\.local/i.test(modelConfig.baseUrl)
    && /\/v1\/task\/submit/i.test(modelConfig.videoGeneratePath);
  const seedanceResolution = payload.resolution || '720p';
  const seedanceRatio = SEEDANCE_RATIOS.includes(payload.ratio as typeof SEEDANCE_RATIOS[number])
    ? payload.ratio as typeof SEEDANCE_RATIOS[number]
    : '16:9';
  const seedancePixelSize = SEEDANCE_PIXEL_SIZES[seedanceResolution][seedanceRatio];
  const workflowReferencesKey = (workflowReferenceImages || []).join('|');
  const isDynamicWorkflow = Boolean(workflowProjectId && workflowStage === 'dynamic');
  const workflowStaticFrame = workflowInputAsset?.url || '';
  const sceneOptionSummaries = useMemo(
    () => (workflowPromptOptions || []).map(buildSceneOptionSummary),
    [workflowPromptOptions]
  );

  useEffect(() => {
    if (!workflowProjectId) return;
    if (workflowStage === 'dynamic') {
      setPayload((current) => ({
        ...current,
        kind: 'video',
        videoMode: 'image2video',
        ratio: workflowRatio || current.ratio || '1:1',
        resolution: '720p',
        size: workflowSize || current.size,
        prompt: current.prompt.trim() ? current.prompt : workflowPrompt || current.prompt,
      }));
      setFirstFrame(workflowInputAsset?.url || '');
      setLastFrame('');
      setRefImages([]);
      return;
    }
    setPayload((current) => ({
      ...current,
      kind: 'image',
      imageMode: workflowReferenceImages?.length ? 'image2image' : 'text2image',
      ratio: workflowRatio || current.ratio,
      size: workflowSize || current.size,
      prompt: workflowPrompt || current.prompt,
    }));
    let cancelled = false;
    void Promise.all((workflowReferenceImages || []).map(async (image) => {
      if (image.startsWith('data:image/')) return image;
      try {
        const response = await fetch(image);
        if (!response.ok) return image;
        return fileToDataUrl(await response.blob());
      } catch {
        return image;
      }
    })).then((images) => {
      if (!cancelled) setRefImages(images);
    });
    return () => { cancelled = true; };
  }, [workflowProjectId, workflowStage, workflowInputAsset?.id, workflowRatio, workflowSize, workflowReferencesKey]);

  useEffect(() => {
    if (workflowProjectId && workflowStage === 'scene') {
      if (scenePresetInitializedRef.current !== workflowProjectId) {
        scenePresetInitializedRef.current = workflowProjectId;
        if (activePresetId !== '__doubao_seedream_45__') switchPreset('__doubao_seedream_45__');
      }
      return;
    }
    if (workflowProjectId && workflowStage === 'dynamic') {
      if (dynamicPresetInitializedRef.current !== workflowProjectId) {
        dynamicPresetInitializedRef.current = workflowProjectId;
        if (activePresetId !== '__jd_seedance_2_fast__') switchPreset('__jd_seedance_2_fast__');
      }
      return;
    }
    const activePreset = allPresets.find((preset) => preset.id === activePresetId);
    if (activePreset && presetSupportsKind(activePreset, payload.kind)) return;

    const fallbackPreset = compatiblePresets[0];
    if (fallbackPreset && fallbackPreset.id !== activePresetId) {
      switchPreset(fallbackPreset.id);
    }
  }, [activePresetId, allPresets, compatiblePresets, payload.kind, switchPreset, workflowProjectId, workflowStage]);

  useEffect(() => {
    try {
      savePromptAgentConfig(agentConfig);
    } catch {
      // Agent configuration persistence should not block the editor.
    }
  }, [agentConfig]);

  useEffect(() => {
    const closeOverlay = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setPreviewResult(null);
      setAdjustTarget(null);
    };
    window.addEventListener('keydown', closeOverlay);
    return () => window.removeEventListener('keydown', closeOverlay);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadAIHistory().then((savedTasks) => {
      if (cancelled) return;
      setTasks((currentTasks) => {
        if (currentTasks.length === 0) return savedTasks;
        const currentIds = new Set(currentTasks.map((task) => task.id));
        return [...currentTasks, ...savedTasks.filter((task) => !currentIds.has(task.id))];
      });
      historyLoadedRef.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!historyLoadedRef.current) return;
    const timer = window.setTimeout(() => {
      void saveAIHistory(tasks);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [tasks]);

  const stats = useMemo(() => {
    const total = visibleTasks.length;
    const ok = visibleTasks.filter((t) => t.status === 'succeeded').length;
    const fail = visibleTasks.filter((t) => t.status === 'failed').length;
    return { total, ok, fail };
  }, [visibleTasks]);

  const deleteFailedTask = (taskId: string) => {
    setTasks((current) => current.filter((task) => task.id !== taskId));
  };

  const validateConfig = () => {
    if (!modelConfig.baseUrl.trim()) return '请填写 Base URL';
    if (!modelConfig.model.trim()) return '请填写模型名称';
    if (payload.kind === 'video' && payload.videoMode === 'image2video' && !firstFrame) return '请上传首帧图片';
    if (payload.kind === 'video' && payload.videoMode === 'keyframes' && (!firstFrame || !lastFrame)) return '首尾帧模式需要同时上传首帧和尾帧图片';
    if (!payload.prompt.trim() && refImages.length === 0 && !firstFrame) return '请填写创意描述或上传参考图';
    return '';
  };

  const handleFileUpload = async (files: FileList | null, target: 'ref' | 'first' | 'last') => {
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      const dataUrl = await fileToDataUrl(file);
      if (target === 'ref'){
        setRefImages((prev) => [...prev, dataUrl]);
      } else if (target === 'first') {
        setFirstFrame(dataUrl);
      } else {
        setLastFrame(dataUrl);
      }
    }
  };

  const selectFromLibrary = (asset: LibraryAsset) => {
    if (asset.type !== 'image' || !libraryTarget) return;
    if (libraryTarget === 'ref') setRefImages((prev) => [...prev, asset.url].slice(0, 4));
    if (libraryTarget === 'first') setFirstFrame(asset.url);
    if (libraryTarget === 'last') setLastFrame(asset.url);
    setLibraryTarget(null);
  };

  // 智能判断当前应导入到哪个目标
  const getDropTarget = (): 'ref' | 'first' | 'last' => {
    if (payload.kind === 'video') {
      if (payload.videoMode === 'image2video') return 'first';
      if (payload.videoMode === 'keyframes') return firstFrame ? 'last' : 'first';
    }
    return 'ref';
  };

  // 拖拽状态
  const [isDragging, setIsDragging] = useState(false);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await handleFileUpload(files, getDropTarget());
      return;
    }
    // 如果拖入的是URL图片
    const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      const target = getDropTarget();
      if (target === 'ref') setRefImages((prev) => [...prev, url]);
      else if (target === 'first') setFirstFrame(url);
      else setLastFrame(url);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  // 粘贴支持
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const target = getDropTarget();
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            const dataUrl = await fileToDataUrl(file);
            if (target === 'ref') setRefImages((prev) => [...prev, dataUrl]);
            else if (target === 'first') setFirstFrame(dataUrl);
            else setLastFrame(dataUrl);
          }
        }
      }
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [payload.kind, payload.videoMode, payload.imageMode, firstFrame]);

  const resolveGenerateRequest = async (
    requestPayload: GeneratePayload,
    onTick?: (result: NormalizedTaskResult) => void,
  ) => {
    const first = await submitGenerateTask(modelConfig, requestPayload);
    onTick?.(first);
    if ((first.status === 'running' || first.status === 'queued') && first.taskId) {
      return pollTaskUntilDone(modelConfig, first.taskId, onTick);
    }
    return first;
  };

  const submitGenerationBatch = async (
    finalPayload: GeneratePayload,
    displayPrompt?: string,
    requestedCount = 1,
  ) => {
    const batchSize = finalPayload.kind === 'image'
      ? Math.max(1, Math.min(4, requestedCount))
      : 1;
    const placeholderId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const placeholderTask: GenerateTask = {
      id: placeholderId,
      workflowProjectId,
      kind: finalPayload.kind,
      imageMode: finalPayload.imageMode,
      videoMode: finalPayload.videoMode,
      prompt: finalPayload.prompt,
      displayPrompt,
      model: modelConfig.model,
      createdAt: Date.now(),
      status: 'running',
      progress: 6,
      progressIsEstimated: true,
      batchSize,
      resultUrls: [],
    };
    setTasks((current) => [placeholderTask, ...current]);
    setIsGenerating(true);

    let estimateTimer: number | undefined;
    if (batchSize === 1) {
      const startedAt = Date.now();
      estimateTimer = window.setInterval(() => {
        const elapsed = Date.now() - startedAt;
        const estimate = Math.min(92, Math.round(8 + 80 * (1 - Math.exp(-elapsed / 26000))));
        setTasks((current) => current.map((task) => (
          task.id === placeholderId && (task.status === 'running' || task.status === 'queued')
            ? { ...task, progress: Math.max(task.progress, estimate), progressIsEstimated: true }
            : task
        )));
      }, 900);
    }

    try {
      if (batchSize > 1) {
        const resultSets: string[][] = Array.from({ length: batchSize }, () => []);
        const failures: string[] = [];
        let cursor = 0;
        let completed = 0;
        let lastRaw: unknown;

        const worker = async () => {
          while (cursor < batchSize) {
            const index = cursor;
            cursor += 1;
            try {
              const result = await resolveGenerateRequest({ ...finalPayload, numImages: 1 });
              lastRaw = result.raw;
              if (result.status === 'succeeded' && result.urls.length > 0) {
                resultSets[index] = result.urls;
              } else {
                failures.push(result.errorMessage || `第 ${index + 1} 张未返回图片`);
              }
            } catch (error: any) {
              failures.push(error?.message || `第 ${index + 1} 张生成失败`);
            } finally {
              completed += 1;
              const urls = resultSets.flat();
              const finished = completed === batchSize;
              setTasks((current) => updateTask(current, placeholderId, {
                status: finished ? (urls.length > 0 ? 'succeeded' : 'failed') : 'running',
                progress: Math.round((completed / batchSize) * 100),
                progressIsEstimated: false,
                failedCount: failures.length,
                resultUrls: urls,
                errorMessage: finished && failures.length > 0
                  ? `${urls.length} 张生成成功，${failures.length} 张失败，可单独重新生成。`
                  : undefined,
                rawLastResponse: lastRaw,
              }));
            }
          }
        };

        await Promise.all(Array.from({ length: Math.min(2, batchSize) }, () => worker()));
      } else {
        const result = await resolveGenerateRequest(finalPayload, (tick) => {
          setTasks((current) => current.map((task) => {
            if (task.id !== placeholderId) return task;
            const hasRealProgress = tick.progress > 0;
            return {
              ...task,
              status: tick.status,
              progress: hasRealProgress ? tick.progress : task.progress,
              progressIsEstimated: !hasRealProgress,
              resultUrls: tick.urls.length > 0 ? tick.urls : task.resultUrls,
              errorMessage: tick.errorMessage,
              rawLastResponse: tick.raw,
            };
          }));
        });
        setTasks((current) => updateTask(current, placeholderId, {
          status: result.status,
          progress: result.status === 'succeeded' || result.status === 'failed' ? 100 : Math.max(result.progress, 8),
          progressIsEstimated: false,
          resultUrls: result.urls,
          errorMessage: result.errorMessage,
          rawLastResponse: result.raw,
        }));
      }
    } catch (error: any) {
      console.error('[AI-Error] generate failed:', error);
      setTasks((current) => updateTask(current, placeholderId, {
        status: 'failed',
        progress: 100,
        progressIsEstimated: false,
        errorMessage: error?.message || '请求失败',
      }));
    } finally {
      if (estimateTimer !== undefined) window.clearInterval(estimateTimer);
      setIsGenerating(false);
    }
  };

  const buildCurrentPayload = () => {
    let finalRefImages: string[] = [];
    let finalFirstFrame: string | undefined;
    let finalLastFrame: string | undefined;

    if (payload.kind === 'video') {
      if (payload.videoMode === 'image2video') finalFirstFrame = firstFrame || undefined;
      if (payload.videoMode === 'keyframes') {
        finalFirstFrame = firstFrame || undefined;
        finalLastFrame = lastFrame || undefined;
      }
    } else if (payload.imageMode === 'image2image') {
      finalRefImages = [...refImages];
    }

    const editablePrompt = payload.prompt.trim();
    const submittedPrompt = workflowPromptTemplate
      ? `${workflowPromptTemplate.prefix}${editablePrompt}${workflowPromptTemplate.suffix}`
      : editablePrompt;
    return {
      editablePrompt,
      finalPayload: {
        ...payload,
        prompt: submittedPrompt,
        negativePrompt: undefined,
        referenceImages: finalRefImages,
        firstFrame: finalFirstFrame,
        lastFrame: finalLastFrame,
      } as GeneratePayload,
    };
  };

  const onGenerate = async () => {
    const error = validateConfig();
    if (error) { alert(error); return; }
    const { editablePrompt, finalPayload } = buildCurrentPayload();
    console.log('[AI-Generate] start, config:', modelConfig.baseUrl, modelConfig.model);
    console.log('[AI-Generate] payload:', finalPayload);
    await submitGenerationBatch(
      finalPayload,
      workflowPromptTemplate ? editablePrompt : undefined,
      finalPayload.kind === 'image' ? finalPayload.numImages || 1 : 1,
    );
  };

  const regenerateSingleResult = async (task: GenerateTask) => {
    if (isGenerating) return;
    const requestPayload: GeneratePayload = {
      ...payload,
      kind: task.kind,
      imageMode: task.imageMode,
      videoMode: task.videoMode,
      prompt: task.prompt,
      numImages: 1,
      referenceImages: task.kind === 'image' && task.imageMode === 'image2image' ? [...refImages] : [],
      firstFrame: task.kind === 'video' ? firstFrame || undefined : undefined,
      lastFrame: task.kind === 'video' && task.videoMode === 'keyframes' ? lastFrame || undefined : undefined,
    };
    await submitGenerationBatch(requestPayload, task.displayPrompt, 1);
  };

  const openSceneAdjustment = (target: { url: string; task: GenerateTask }) => {
    setAdjustTarget(target);
    setAdjustPrompt('');
    setAdjustMask('');
    setAdjustRegion(null);
    setAdjustMode('region');
  };

  const closeSceneAdjustment = () => {
    setAdjustTarget(null);
    setAdjustPrompt('');
    setAdjustMask('');
    setAdjustRegion(null);
    setAdjustMode('region');
  };

  const describeEditRegion = (region: SceneEditRegion) => {
    const centerX = (region.x + region.width / 2) / region.imageWidth;
    const centerY = (region.y + region.height / 2) / region.imageHeight;
    const horizontal = centerX < 0.34 ? '左侧' : centerX > 0.66 ? '右侧' : '中间';
    const vertical = centerY < 0.34 ? '上方' : centerY > 0.66 ? '下方' : '中部';
    const left = Math.round((region.x / region.imageWidth) * 100);
    const top = Math.round((region.y / region.imageHeight) * 100);
    const right = Math.round(((region.x + region.width) / region.imageWidth) * 100);
    const bottom = Math.round(((region.y + region.height) / region.imageHeight) * 100);
    return `画面${vertical}${horizontal}的蓝色标记区域（横向 ${left}%–${right}%，纵向 ${top}%–${bottom}%）`;
  };

  const submitSceneAdjustment = async () => {
    const isRegionEdit = adjustMode === 'region';
    if (!adjustTarget || !adjustPrompt.trim() || (isRegionEdit && (!adjustMask || !adjustRegion)) || isGenerating) return;
    const instruction = adjustPrompt.trim();
    const regionDescription = isRegionEdit && adjustRegion ? describeEditRegion(adjustRegion) : '';
    const requestPayload: GeneratePayload = {
      ...payload,
      kind: 'image',
      imageMode: 'image2image',
      prompt: isRegionEdit
        ? `仅调整${regionDescription}：${instruction}。严格保持标记区域之外的原图主体、构图、镜头角度、色彩和细节不变，修改边缘自然并与原画面风格一致。`
        : `以原图为基础进行整体调整：${instruction}。保留原图中仍适用的主体内容和空间关系，使整体变化统一、自然，并保持画面完整。`,
      numImages: 1,
      referenceImages: [adjustTarget.url],
      editMask: isRegionEdit ? adjustMask : undefined,
      firstFrame: undefined,
      lastFrame: undefined,
    };
    closeSceneAdjustment();
    await submitGenerationBatch(requestPayload, `${isRegionEdit ? '局部' : '整体'}场景调整：${instruction}`, 1);
  };

  const saveToLibrary = async (url: string, kind: 'image' | 'video', prompt: string) => {
    try {
      await addToLibrary({ url, type: kind, prompt, thumbnail: kind === 'image' ? url : undefined });
      alert('已存入素材仓库');
    } catch (error) {
      console.error('[AssetLibrary] save failed:', error);
      alert('素材保存失败，请检查浏览器存储空间');
    }
  };

  const selectWorkflowResult = async (url: string, task: GenerateTask) => {
    const expectedKind = workflowStage === 'dynamic' ? 'video' : 'image';
    if (!workflowProjectId || task.kind !== expectedKind || selectingResult) return;
    setSelectingResult(url);
    try {
      const asset = await addToLibrary({
        url,
        type: expectedKind,
        prompt: task.prompt,
        thumbnail: expectedKind === 'image' ? url : undefined,
        projectId: workflowProjectId,
        workflowId: workflowProjectId,
        stage: workflowStage,
        parentAssetId: workflowInputAsset?.id,
        model: task.model,
        generationParams: {
          kind: task.kind,
          videoMode: task.videoMode,
          ratio: payload.ratio,
          size: payload.size,
          durationSec: payload.durationSec,
        },
        version: 1,
        selected: true,
        status: 'approved',
        tags: [workflowStage === 'dynamic' ? '动态海报' : '海报场景'],
      });
      onSelectResult?.(asset);
    } catch (error) {
      console.error('[AtlasWorkflow] select result failed:', error);
      alert(`${workflowStage === 'dynamic' ? '视频' : '场景'}保存失败，请检查浏览器存储空间`);
    } finally {
      setSelectingResult(null);
    }
  };

  const optimizePrompt = async () => {
    if (!payload.prompt.trim()) {
      alert('请先输入需要优化的关键词或提示词');
      return;
    }
    setIsOptimizingPrompt(true);
    try {
      const optimized = await optimizeGenerationPrompt(agentConfig, modelConfig, payload);
      setPreviousPrompt(payload.prompt);
      setPayload((current) => ({ ...current, prompt: optimized }));
    } catch (error: any) {
      alert(error?.name === 'AbortError' ? 'Agent 优化超时，请稍后重试' : error?.message || 'Agent 优化失败');
      setAgentExpanded(true);
    } finally {
      setIsOptimizingPrompt(false);
    }
  };

  const chooseScenePrompt = (prompt: string) => {
    setPayload((current) => ({ ...current, prompt }));
    onWorkflowPromptChange?.(prompt);
  };

  const chooseWorkflowVideoMode = (mode: 'image2video' | 'keyframes') => {
    setPayload((current) => ({ ...current, videoMode: mode }));
    setFirstFrame((current) => current || workflowStaticFrame);
    if (mode === 'keyframes') {
      setLastFrame((current) => current || workflowStaticFrame);
    }
  };

  const restoreWorkflowStaticFrame = (target: 'first' | 'last') => {
    if (!workflowStaticFrame) return;
    if (target === 'first') setFirstFrame(workflowStaticFrame);
    else setLastFrame(workflowStaticFrame);
  };

  return (
    <div className="flex h-full min-h-0 flex-1 overflow-hidden">
      {/* 左侧：参数面板 */}
      <aside
        className={`w-[600px] min-w-[520px] max-w-[56vw] shrink-0 border-r border-[var(--border-soft)] bg-[#0d1010] flex flex-col overflow-hidden relative ${isDragging ? 'ring-2 ring-[var(--primary)] ring-inset' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {/* 拖拽提示 */}
        {isDragging && (
          <div className="absolute inset-0 z-50 bg-[var(--primary)]/10 backdrop-blur-sm flex items-center justify-center pointer-events-none">
            <div className="text-center space-y-2">
              <Upload size={28} className="mx-auto text-[var(--primary)]" />
              <p className="text-xs font-medium text-[var(--primary)]">释放以导入参考图</p>
            </div>
          </div>
        )}
        <div className="px-7 pt-6 pb-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg border border-white/10 bg-white/5 flex items-center justify-center">
              {payload.kind === 'image' ? <ImageIcon size={20} className="text-cyan-300" /> : <Clapperboard size={20} className="text-blue-300" />}
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-white">{workflowProjectId ? (workflowStage === 'dynamic' ? '动态海报' : '场景生成') : payload.kind === 'image' ? '图片生成' : '视频生成'}</h2>
              <p className="text-sm text-neutral-500 mt-1">AI Creative Studio</p>
            </div>
          </div>
        </div>

        <div className="px-7 pb-5 shrink-0">
          {!workflowProjectId && <div className="grid grid-cols-2 gap-1 p-1 rounded-lg border border-white/5 bg-white/[0.035]">
            <button className={`h-12 rounded-md text-base font-medium flex items-center justify-center gap-2 transition-colors ${payload.kind === 'image' ? 'bg-white/10 text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-200'}`} onClick={() => setPayload((s) => ({ ...s, kind: 'image', size: '1024x1024' }))}>
              <ImageIcon size={16} /> 图片模式
            </button>
            <button className={`h-12 rounded-md text-base font-medium flex items-center justify-center gap-2 transition-colors ${payload.kind === 'video' ? 'bg-white/10 text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-200'}`} onClick={() => setPayload((s) => ({ ...s, kind: 'video', size: '1280x720', resolution: '720p', ratio: '16:9' }))}>
              <Clapperboard size={16} /> 视频模式
            </button>
          </div>}
          {!workflowProjectId && <div className={`grid gap-1 mt-3 ${payload.kind === 'video' ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {(payload.kind === 'video'
              ? ([['text2video', '文生视频'], ['image2video', '图生视频'], ['keyframes', '首尾帧']] as const)
              : ([['text2image', '文生图'], ['image2image', '图生图']] as const)
            ).map(([mode, label]) => {
              const active = payload.kind === 'video' ? payload.videoMode === mode : payload.imageMode === mode;
              return (
                <button key={mode} className={`h-11 rounded-md border text-[15px] transition-colors ${active ? 'border-cyan-400/70 bg-cyan-400/10 text-cyan-200' : 'border-white/8 text-neutral-500 hover:text-neutral-200 hover:border-white/15'}`} onClick={() => setPayload((s) => payload.kind === 'video' ? ({ ...s, videoMode: mode as GeneratePayload['videoMode'] }) : ({ ...s, imageMode: mode as GeneratePayload['imageMode'] }))}>
                  {label}
                </button>
              );
            })}
          </div>}
          {isDynamicWorkflow && (
            <div className="mt-3 space-y-2">
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/5 bg-white/[0.035] p-1">
                {([
                  ['image2video', '单图生视频', '以静态定稿为首帧，让画面自然动起来'],
                  ['keyframes', '首尾帧', '用两张静态海报控制动作起点与终点'],
                ] as const).map(([mode, label, description]) => {
                  const active = payload.videoMode === mode;
                  return (
                    <button
                      key={mode}
                      type="button"
                      className={`min-h-[72px] rounded-md border px-4 py-3 text-left transition-colors ${active ? 'border-cyan-400/60 bg-cyan-400/10 text-white' : 'border-transparent text-neutral-500 hover:border-white/10 hover:text-neutral-200'}`}
                      onClick={() => chooseWorkflowVideoMode(mode)}
                    >
                      <span className="block text-[15px] font-medium">{label}</span>
                      <span className={`mt-1 block text-xs leading-5 ${active ? 'text-cyan-100/65' : 'text-neutral-600'}`}>{description}</span>
                    </button>
                  );
                })}
              </div>
              <p className="px-1 text-xs leading-5 text-neutral-600">
                两种模式都从当前静态海报开始；首尾帧模式可单独替换尾帧，精确控制视频结束画面。
              </p>
            </div>
          )}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scroll-area px-7 pb-8 space-y-8">
          {workflowProjectId && workflowStage === 'scene' && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-base font-semibold text-neutral-200">参考素材</h3>
                <span className="text-xs text-emerald-400">已自动准备 {refImages.length} 张</span>
              </div>
              <div className={`grid gap-2 ${refImages.length === 2 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                {refImages.map((image, index) => (
                  <div key={index} className="relative aspect-[4/3] overflow-hidden rounded-md border border-white/8 bg-black/40">
                    <img src={image} alt={workflowReferenceLabels?.[index] || '参考素材'} className="h-full w-full object-cover" />
                    <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-2 py-1 text-[10px] text-white">
                      {workflowReferenceLabels?.[index] || `参考素材 ${index + 1}`}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {(payload.kind === 'image' && payload.imageMode === 'image2image' && !(workflowProjectId && workflowStage === 'scene')) && (
            <section className="space-y-3">
              <h3 className="text-base font-semibold text-neutral-200">参考素材</h3>
              <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleFileUpload(e.target.files, 'ref')} />
              <div className="min-h-36 rounded-lg border border-dashed border-white/15 bg-white/[0.025] flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-cyan-400/50 transition-colors" onClick={() => fileInputRef.current?.click()}>
                <Upload size={26} className="text-neutral-500" />
                <div className="text-center">
                  <p className="text-base text-neutral-300">上传参考图片</p>
                  <button type="button" className="mt-1 text-sm text-cyan-300 hover:text-cyan-200" onClick={(event) => { event.stopPropagation(); setLibraryTarget('ref'); }}>从素材仓库选择 · 最多 14 张</button>
                </div>
              </div>
              {refImages.length > 0 && (
                <div className="grid grid-cols-5 gap-2">
                  {refImages.map((image, index) => (
                    <div key={index} className="relative aspect-square rounded-md overflow-hidden group bg-black/40">
                      <img src={image} alt="参考素材" className="w-full h-full object-contain" />
                      <button className="absolute inset-0 bg-black/55 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity" title="移除" onClick={() => setRefImages((items) => items.filter((_, itemIndex) => itemIndex !== index))}><X size={16} /></button>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {(payload.kind === 'video' && payload.videoMode === 'image2video') && (
            <section className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold text-neutral-200">{isDynamicWorkflow ? '静态海报首帧' : '参考素材'}</h3>
                  {isDynamicWorkflow && <p className="mt-1 text-xs text-neutral-500">已自动使用当前静态定稿，也可以替换成素材仓库中的其他静态海报。</p>}
                </div>
                {isDynamicWorkflow && workflowStaticFrame && firstFrame !== workflowStaticFrame && (
                  <button type="button" className="shrink-0 text-xs text-cyan-300 hover:text-cyan-200" onClick={() => restoreWorkflowStaticFrame('first')}>恢复静态定稿</button>
                )}
              </div>
              <input ref={firstFrameRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e.target.files, 'first')} />
              {firstFrame ? (
                <div className="relative min-h-44 max-h-72 rounded-lg overflow-hidden group bg-black/40 flex items-center justify-center">
                  <img src={firstFrame} alt="首帧参考图" className="max-w-full max-h-72 object-contain" />
                  {isDynamicWorkflow && firstFrame === workflowStaticFrame && <span className="absolute bottom-3 left-3 rounded bg-black/70 px-2 py-1 text-[10px] text-cyan-200">当前静态定稿</span>}
                  <button className="absolute top-3 right-3 w-8 h-8 rounded-md bg-black/65 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" title="移除首帧" onClick={() => setFirstFrame('')}><X size={16} /></button>
                </div>
              ) : (
                <div className="min-h-40 rounded-lg border border-dashed border-white/15 bg-white/[0.025] flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-cyan-400/50 transition-colors" onClick={() => firstFrameRef.current?.click()}>
                  <Upload size={27} className="text-neutral-500" />
                  <div className="text-center">
                    <p className="text-base text-neutral-300">上传首帧图片</p>
                    <button type="button" className="mt-1 text-sm text-cyan-300" onClick={(event) => { event.stopPropagation(); setLibraryTarget('first'); }}>从素材仓库选择</button>
                  </div>
                </div>
              )}
            </section>
          )}

          {(payload.kind === 'video' && payload.videoMode === 'keyframes') && (
            <section className="space-y-3">
              <div>
                <h3 className="text-base font-semibold text-neutral-200">{isDynamicWorkflow ? '静态海报首尾帧' : '首尾帧素材'}</h3>
                <p className="mt-1 text-xs leading-5 text-neutral-500">
                  {isDynamicWorkflow
                    ? '默认将当前静态定稿同时作为首帧和尾帧。需要明确的动作落点时，可替换尾帧为另一张静态海报。'
                    : '分别设置视频的开始画面和结束画面。'}
                </p>
              </div>
              <input ref={firstFrameRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e.target.files, 'first')} />
              <input ref={lastFrameRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e.target.files, 'last')} />
              <div className="grid grid-cols-2 gap-3">
                {([['first', '首帧', firstFrame], ['last', '尾帧', lastFrame]] as const).map(([target, label, image]) => (
                  <div key={target} className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs text-neutral-500">{label}</span>
                      <span className="flex items-center gap-2">
                        {isDynamicWorkflow && workflowStaticFrame && image !== workflowStaticFrame && <button type="button" className="text-[11px] text-neutral-400 hover:text-white" onClick={() => restoreWorkflowStaticFrame(target)}>静态定稿</button>}
                        <button type="button" className="text-xs text-cyan-300 hover:text-cyan-200" onClick={() => setLibraryTarget(target)}>仓库选择</button>
                      </span>
                    </div>
                    <div className="relative aspect-video rounded-lg border border-dashed border-white/15 bg-white/[0.025] flex items-center justify-center overflow-hidden cursor-pointer" onClick={() => (target === 'first' ? firstFrameRef : lastFrameRef).current?.click()}>
                      {image ? <img src={image} alt={label} className="w-full h-full object-contain" /> : <Upload size={22} className="text-neutral-600" />}
                      {isDynamicWorkflow && image === workflowStaticFrame && <span className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-[10px] text-cyan-200">当前静态定稿</span>}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-neutral-200">{workflowProjectId && workflowStage === 'scene' ? '场景方案' : '创意描述'}</h3>
                {workflowProjectId && workflowStage === 'scene' && <p className="mt-1 text-xs text-neutral-500">只比较不同机位带来的画面感受，完整关键词统一在下方修改。</p>}
              </div>
              {!(workflowProjectId && workflowStage === 'scene') && (
                <div className="flex items-center gap-2">
                  {previousPrompt && <button className="h-9 px-3 text-xs text-neutral-400 hover:text-white inline-flex items-center gap-1.5" onClick={() => { setPayload((current) => ({ ...current, prompt: previousPrompt })); setPreviousPrompt(''); }}><Undo2 size={13} /> 恢复原文</button>}
                  <button className={`w-9 h-9 rounded-md border flex items-center justify-center ${agentExpanded ? 'border-cyan-400/50 text-cyan-300 bg-cyan-400/10' : 'border-white/10 text-neutral-500 hover:text-neutral-200'}`} title="Agent 设置" onClick={() => setAgentExpanded((value) => !value)}><Settings2 size={15} /></button>
                  <button className="h-9 px-4 rounded-md bg-white/10 hover:bg-white/15 text-sm text-white font-medium inline-flex items-center gap-2 disabled:opacity-40" disabled={isOptimizingPrompt || !payload.prompt.trim()} onClick={optimizePrompt}>
                    {isOptimizingPrompt ? <LoaderCircle size={15} className="animate-spin" /> : <WandSparkles size={15} className="text-cyan-300" />}
                    {isOptimizingPrompt ? '优化中' : 'Agent 优化'}
                  </button>
                </div>
              )}
            </div>
            {workflowProjectId && workflowStage === 'scene' && Boolean(workflowPromptOptions?.length) && (
              <div className="grid grid-cols-3 gap-2">
                {workflowPromptOptions?.map((option, index) => {
                  const summary = sceneOptionSummaries[index];
                  const selected = payload.prompt === option;
                  return (
                    <button
                      key={`${index}-${option}`}
                      type="button"
                      aria-label={`选择场景方案 ${index + 1}：${summary.title}`}
                      aria-pressed={selected}
                      className={`min-h-32 rounded-lg border px-3 py-3 text-left transition-all ${selected ? 'border-cyan-300/70 bg-cyan-400/[0.08] shadow-[0_0_0_1px_rgba(103,232,249,0.12)]' : 'border-white/10 bg-black/25 hover:border-white/25 hover:bg-white/[0.035]'}`}
                      onClick={() => chooseScenePrompt(option)}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className={`text-[9px] ${selected ? 'text-cyan-300' : 'text-neutral-600'}`}>方案 {index + 1}</span>
                        {selected && <span className="rounded-full bg-cyan-300 px-1.5 py-0.5 text-[8px] font-semibold text-[#071012]">已选</span>}
                      </div>
                      <p className={`mt-2 text-xs font-medium ${selected ? 'text-cyan-100' : 'text-neutral-200'}`}>{summary.title}</p>
                      <span className="mt-1.5 inline-flex rounded bg-white/[0.05] px-1.5 py-0.5 text-[9px] text-neutral-400">{summary.camera}</span>
                      <p className="mt-2 text-[10px] leading-[17px] text-neutral-500">{summary.feeling}</p>
                    </button>
                  );
                })}
              </div>
            )}
            {workflowProjectId && workflowStage === 'scene' && (
              <div className="pt-2">
                <h3 className="text-base font-semibold text-neutral-200">关键词修改</h3>
                <p className="mt-1 text-xs text-neutral-500">这里显示当前所选方案的完整关键词，可以直接自由修改。</p>
              </div>
            )}
            {
              <div className="relative">
                <textarea className="w-full min-h-52 rounded-lg border border-white/10 bg-black/45 px-5 py-4 pb-10 text-[15px] leading-7 text-neutral-100 resize-y outline-none placeholder:text-neutral-600 focus:border-cyan-400/50" maxLength={workflowProjectId && workflowStage === 'scene' ? (workflowPromptMaxLength || 180) : 2500} placeholder={workflowProjectId && workflowStage === 'scene' ? '描述主要建筑、空间关系和光线...' : payload.kind === 'video' ? '描述画面内容、角色动作、镜头运动和氛围...' : '描述想要生成的画面、主体、构图和视觉风格...'} value={payload.prompt} onChange={(e) => {
                  const prompt = e.target.value;
                  setPayload((s) => ({ ...s, prompt }));
                  if (workflowProjectId && workflowStage === 'scene') onWorkflowPromptChange?.(prompt);
                }} />
                <span className="absolute left-4 bottom-3 text-xs text-neutral-600">{payload.prompt.length} / {workflowProjectId && workflowStage === 'scene' ? (workflowPromptMaxLength || 180) : 2500}</span>
                <Bot size={15} className="absolute right-4 bottom-3 text-neutral-600" />
              </div>
            }
            <AnimatePresence>
              {agentExpanded && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="grid grid-cols-2 gap-2 rounded-lg border border-white/8 bg-white/[0.025] p-3">
                    <input className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-xs outline-none" placeholder="Agent Base URL" value={agentConfig.baseUrl} onChange={(e) => setAgentConfig((current) => ({ ...current, baseUrl: e.target.value }))} />
                    <input className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-xs outline-none" placeholder="聊天端点" value={agentConfig.path} onChange={(e) => setAgentConfig((current) => ({ ...current, path: e.target.value }))} />
                    <input className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-xs outline-none" placeholder="Agent 模型名称" value={agentConfig.model} onChange={(e) => setAgentConfig((current) => ({ ...current, model: e.target.value }))} />
                    <input className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-xs outline-none" type="password" placeholder="Agent API Key" value={agentConfig.apiKey} onChange={(e) => setAgentConfig((current) => ({ ...current, apiKey: e.target.value }))} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          <section className="space-y-4 pb-2">
            <h3 className="text-base font-semibold text-neutral-200">参数设置</h3>
            <div className="rounded-lg border border-white/8 bg-white/[0.025] p-4 space-y-4">
              <div className="grid grid-cols-[110px_1fr_auto] gap-3 items-center">
                <label className="text-[15px] text-neutral-300">模型</label>
                <select className="h-12 rounded-md border border-white/10 bg-[#141819] px-4 text-[15px] outline-none cursor-pointer" value={activePresetId || ''} onChange={(e) => { if (e.target.value) switchPreset(e.target.value); }}>
                  <option value="">选择模型预设</option>
                  <optgroup label={guidedImageWorkflow ? '推荐模型' : '内置预设'}>{compatiblePresets.filter((preset) => preset.builtIn).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}{preset.recommended ? ' · 推荐' : ''}</option>)}</optgroup>
                  {compatiblePresets.some((preset) => !preset.builtIn) && <optgroup label="我的预设">{compatiblePresets.filter((preset) => !preset.builtIn).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</optgroup>}
                </select>
                <div className="flex gap-1">
                  <button className="w-10 h-10 rounded-md border border-white/10 text-neutral-400 hover:text-white flex items-center justify-center" title="保存为预设" onClick={() => { setShowSaveDialog(true); setPresetName(''); }}><Save size={15} /></button>
                  {activePresetId && !allPresets.find((preset) => preset.id === activePresetId)?.builtIn && <button className="w-10 h-10 rounded-md border border-white/10 text-neutral-400 hover:text-red-400 flex items-center justify-center" title="删除预设" onClick={() => { if (confirm('确定删除该预设？')) deletePreset(activePresetId); }}><Trash2 size={15} /></button>}
                </div>
              </div>
              {(guidedImageWorkflow || isDynamicWorkflow) && selectedPreset?.styleDescription && (
                <div className="ml-[123px] rounded-md border border-cyan-400/15 bg-cyan-400/[0.045] px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    {selectedPreset.recommended && <span className="rounded bg-cyan-300 px-1.5 py-0.5 text-[10px] font-semibold text-[#071012]">推荐</span>}
                    <span className="text-xs font-medium text-cyan-100">{selectedPreset.name}</span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-neutral-400">{selectedPreset.styleDescription}</p>
                </div>
              )}
              {showSaveDialog && (
                <div className="flex gap-2 pl-[123px]">
                  <input className="flex-1 h-10 rounded-md border border-white/10 bg-black/30 px-3 text-sm outline-none" placeholder="预设名称" value={presetName} onChange={(e) => setPresetName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && presetName.trim()) { saveAsPreset(presetName.trim(), modelConfig, [payload.kind]); setShowSaveDialog(false); } if (e.key === 'Escape') setShowSaveDialog(false); }} autoFocus />
                  <button className="px-4 rounded-md bg-white/10 text-sm disabled:opacity-40" disabled={!presetName.trim()} onClick={() => { saveAsPreset(presetName.trim(), modelConfig, [payload.kind]); setShowSaveDialog(false); }}>保存</button>
                  <button className="px-3 text-sm text-neutral-500" onClick={() => setShowSaveDialog(false)}>取消</button>
                </div>
              )}

              {payload.kind === 'image' && (() => {
                const isSeedream = /seedream/i.test(modelConfig.model) || /\/ark-api|volces\.com/.test(modelConfig.baseUrl);
                const isNanoBanana = /gemini-.*-image/i.test(modelConfig.model) && /google-api|googleapis\.com/i.test(modelConfig.baseUrl);
                return (
                  <div className="grid grid-cols-[110px_1fr_1fr] gap-3 items-center">
                    <label className="text-[15px] text-neutral-300">{isNanoBanana ? '尺寸与比例' : '尺寸与数量'}</label>
                    {isSeedream || isNanoBanana ? (
                      <select className="h-12 rounded-md border border-white/10 bg-[#141819] px-4 text-[15px] outline-none" value={/^\d+K$/i.test(payload.size || '') ? payload.size : '2K'} onChange={(e) => setPayload((s) => ({ ...s, size: e.target.value }))}><option value="1K">1K</option><option value="2K">2K 推荐</option><option value="4K">4K</option></select>
                    ) : (
                      <select className="h-12 rounded-md border border-white/10 bg-[#141819] px-4 text-[15px] outline-none" value={payload.size} onChange={(e) => setPayload((s) => ({ ...s, size: e.target.value }))}><option value="1024x1024">1024×1024</option><option value="1024x768">1024×768</option><option value="768x1024">768×1024</option><option value="1536x1024">1536×1024</option><option value="1024x1536">1024×1536</option><option value="2048x2048">2048×2048</option></select>
                    )}
                    {isNanoBanana ? (
                      <select className="h-12 rounded-md border border-white/10 bg-[#141819] px-4 text-[15px] outline-none" value={payload.ratio || '1:1'} onChange={(e) => setPayload((s) => ({ ...s, ratio: e.target.value }))}><option value="1:1">1:1</option><option value="2:3">2:3</option><option value="3:2">3:2</option><option value="3:4">3:4</option><option value="4:3">4:3</option><option value="4:5">4:5</option><option value="5:4">5:4</option><option value="9:16">9:16</option><option value="16:9">16:9</option><option value="21:9">21:9</option></select>
                    ) : (
                      <select className="h-12 rounded-md border border-white/10 bg-[#141819] px-4 text-[15px] outline-none" value={payload.numImages || 1} onChange={(e) => setPayload((s) => ({ ...s, numImages: Number(e.target.value) }))}><option value={1}>1 张</option><option value={2}>2 张</option><option value={3}>3 张</option><option value={4}>4 张</option></select>
                    )}
                  </div>
                );
              })()}
              {payload.kind === 'image' && (payload.numImages || 1) > 1 && <p className="ml-[123px] text-[10px] leading-4 text-amber-300/70">将按所选数量分别计费，并以最多 2 路并发生成；单张失败不会影响其他结果。</p>}

              {payload.kind === 'video' && (
                isJdSeedanceTaskVideo ? (
                  <div className="grid grid-cols-[110px_1fr] gap-3 items-center">
                    <label className="text-[15px] text-neutral-300">视频规格</label>
                    <div className="min-h-12 rounded-md border border-white/8 bg-black/20 px-4 py-3 text-sm leading-6 text-neutral-500">
                      根据输入帧比例自动生成，时长与清晰度由内网模型决定
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-[110px_1fr_1fr_1fr] gap-3 items-center">
                    <label className="text-[15px] text-neutral-300">视频规格</label>
                    <select className="h-12 rounded-md border border-white/10 bg-[#141819] px-4 text-[15px] outline-none" value={payload.durationSec || 5} onChange={(e) => setPayload((s) => ({ ...s, durationSec: Number(e.target.value) }))}><option value={3}>约 3 秒</option><option value={5}>约 5 秒</option><option value={7}>约 7 秒</option><option value={10}>约 10 秒</option><option value={13}>约 13 秒</option><option value={18}>约 18 秒</option></select>
                    {isSeedanceVideo ? <select className="h-12 rounded-md border border-white/10 bg-[#141819] px-4 text-[15px] outline-none" value={seedanceResolution} onChange={(e) => { const resolution = e.target.value as '480p' | '720p'; setPayload((current) => ({ ...current, resolution, size: SEEDANCE_PIXEL_SIZES[resolution][seedanceRatio].replace('×', 'x') })); }}><option value="480p">480p</option><option value="720p">720p</option></select> : <select className="h-12 rounded-md border border-white/10 bg-[#141819] px-4 text-[15px] outline-none" value={payload.size} onChange={(e) => setPayload((current) => ({ ...current, size: e.target.value }))}><option value="1280x720">1280×720</option><option value="720x1280">720×1280</option><option value="1024x1024">1024×1024</option></select>}
                    {isSeedanceVideo ? <select className="h-12 rounded-md border border-white/10 bg-[#141819] px-4 text-[15px] outline-none" value={seedanceRatio} onChange={(e) => { const ratio = e.target.value as typeof SEEDANCE_RATIOS[number]; setPayload((current) => ({ ...current, ratio, size: SEEDANCE_PIXEL_SIZES[seedanceResolution][ratio].replace('×', 'x') })); }}>{SEEDANCE_RATIOS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}</select> : <span className="h-12 rounded-md border border-white/8 bg-black/20 px-4 text-[15px] text-neutral-500 flex items-center">自动比例</span>}
                  </div>
                )
              )}
              {isSeedanceVideo && !isJdSeedanceTaskVideo && <div className="flex justify-end text-xs text-neutral-500">实际像素 <span className="ml-2 font-mono text-cyan-300">{seedancePixelSize}</span></div>}

              <button className="w-full h-12 border-t border-white/8 pt-3 flex items-center justify-between text-[15px] text-neutral-400 hover:text-white" onClick={() => setConfigExpanded((value) => !value)}><span className="flex items-center gap-2"><LinkIcon size={16} />接口配置</span>{configExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
              <AnimatePresence>
                {configExpanded && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden"><div className="grid grid-cols-2 gap-2 pt-1"><input className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-xs outline-none" placeholder="Base URL" value={modelConfig.baseUrl} onChange={(e) => setModelConfig((s) => ({ ...s, baseUrl: e.target.value }))} /><input className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-xs outline-none" placeholder="API Key" type="password" value={modelConfig.apiKey} onChange={(e) => setModelConfig((current) => { const next = { ...current, apiKey: e.target.value }; rememberModelSecrets(next); return next; })} /><input className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-xs outline-none" placeholder="模型名称" value={modelConfig.model} onChange={(e) => setModelConfig((s) => ({ ...s, model: e.target.value }))} /><input className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-xs outline-none" placeholder="图片接口路径" value={modelConfig.imageGeneratePath} onChange={(e) => setModelConfig((s) => ({ ...s, imageGeneratePath: e.target.value }))} /><input className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-xs outline-none" placeholder="视频接口路径" value={modelConfig.videoGeneratePath} onChange={(e) => setModelConfig((s) => ({ ...s, videoGeneratePath: e.target.value }))} /><input className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-xs outline-none" placeholder="任务查询路径" value={modelConfig.taskStatusPath} onChange={(e) => setModelConfig((s) => ({ ...s, taskStatusPath: e.target.value }))} /><input className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-xs outline-none col-span-2" placeholder="imgbb API Key（图生视频可选）" type="password" value={modelConfig.imgbbApiKey || ''} onChange={(e) => setModelConfig((current) => { const next = { ...current, imgbbApiKey: e.target.value }; rememberModelSecrets(next); return next; })} /><p className="col-span-2 px-1 text-[10px] leading-4 text-neutral-600">API Key 会按模型保存在当前浏览器，切换模型后自动恢复；清空输入框即可删除本机记忆。</p></div></motion.div>}
              </AnimatePresence>
            </div>
          </section>
        </div>

        <div className="px-7 py-5 border-t border-white/8 bg-[#0d1010] shrink-0">
          <button className="w-full h-14 rounded-lg bg-gradient-to-r from-cyan-400 to-blue-600 text-white text-base font-semibold flex items-center justify-center gap-2 shadow-lg shadow-blue-950/30 disabled:opacity-45 disabled:cursor-not-allowed" disabled={isGenerating} onClick={onGenerate}>
            {isGenerating ? <LoaderCircle size={18} className="animate-spin" /> : <Sparkles size={18} />}
            {isGenerating ? '生成中...' : `立即生成${payload.kind === 'image' ? '图片' : '视频'}`}
          </button>
        </div>
      </aside>

      {/* 右侧：结果展示 */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* 顶栏 */}
        <div className="h-10 shrink-0 border-b border-[var(--border-soft)] px-5 flex items-center justify-between bg-[var(--bg-elev)]/40">
          <div className="flex items-center gap-4 text-[11px]">
            <span className="text-neutral-400">任务 {stats.total}</span>
            <span className="text-green-400">成功 {stats.ok}</span>
            <span className="text-red-400">失败 {stats.fail}</span>
       </div>
          {latestTask && (
            <div className="text-[11px] text-neutral-500 flex items-center gap-1.5">
              <Clock3 size={12} />
              {TASK_STATUS_TEXT[latestTask.status]} {latestTask.progress > 0 && latestTask.progress < 100 ? `${latestTask.progressIsEstimated ? '预计 ' : ''}${Math.round(latestTask.progress)}%` : ''}
            </div>
          )}
        </div>

        {/* 内容区 - 单列大卡片布局 */}
        <div className="flex-1 min-h-0 overflow-y-auto scroll-area p-5">
          {visibleTasks.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-4 text-neutral-500">
              <div className="w-20 h-20 rounded-full bg-[var(--bg-elev-2)] border border-dashed border-neutral-700 flex items-center justify-center">
                <Sparkles size={28} className="text-neutral-600" />
              </div>
              <p className="text-sm text-neutral-400">暂无生成结果</p>
              <p className="text-xs text-neutral-600">在左侧输入描述并点击"立即生成"开始创作</p>
            </div>
          ) : (
            <div className="space-y-5">
              {visibleTasks.map((task) => {
                const isImageBatch = task.kind === 'image' && (task.batchSize || task.resultUrls.length) > 1;
                return (
                <motion.div key={task.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="panel p-4">
                  {/* 卡片头部 */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 font-mono">{task.model}</span>
                        <span className="text-[10px] text-neutral-500">{task.kind === 'image' ? (task.imageMode === 'image2image' ? '图生图' : '文生图') : (task.videoMode === 'image2video' ? '图生视频' : task.videoMode === 'keyframes' ? '关键��' : '文生视频')}</span>
                        <span className="text-[10px] text-neutral-600">{new Date(task.createdAt).toLocaleString()}</span>
                      </div>
                      <p className="text-xs font-medium mt-1.5 text-neutral-200 leading-relaxed">{task.displayPrompt || task.prompt}</p>
                    </div>
                    <div className="shrink-0 flex items-center gap-1 text-[11px]">
                      {task.status === 'succeeded' && <CheckCircle2 size={13} className="text-green-400" />}
                      {task.status === 'failed' && <AlertTriangle size={13} className="text-red-400" />}
                      {(task.status === 'queued' || task.status === 'running') && <LoaderCircle size={13} className="animate-spin text-blue-400" />}
                      <span className="text-neutral-400">{TASK_STATUS_TEXT[task.status]}</span>
                    </div>
                  </div>

                  {/* 进度条 */}
                  {task.status === 'running' && task.progress > 0 && (
                    <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden mb-3">
                      <div className="h-full bg-[var(--primary)] transition-all rounded-full" style={{ width: `${task.progress}%` }} />
                    </div>
                  )}

                  {task.errorMessage && <p className="text-[11px] text-red-400 mb-3">{task.errorMessage}</p>}

                  {/* 生成中动效 - 卡片内展示区 */}
                  {(task.status === 'queued' || task.status === 'running') && task.resultUrls.length === 0 && (
                    <div className="relative rounded-xl overflow-hidden bg-neutral-900 min-h-[320px] max-h-[560px] flex items-center justify-center">
                      {/* 模糊流光动态背景 */}
                      <div className="absolute inset-0 overflow-hidden">
                        <div className="absolute inset-0 bg-neutral-900/90" />
                        <div className="absolute -inset-[50%] animate-[spin_8s_linear_infinite]">
                          <div className="absolute top-1/4 left-1/4 w-[40%] h-[40%] rounded-full bg-gradient-to-r from-purple-500/30 via-blue-500/20 to-cyan-400/30 blur-3xl" />
                          <div className="absolute bottom-1/4 right-1/4 w-[35%] h-[35%] rounded-full bg-gradient-to-r from-pink-500/25 via-violet-500/20 to-indigo-400/25 blur-3xl" />
                        </div>
                        <div className="absolute -inset-[50%] animate-[spin_12s_linear_infinite_reverse]">
                          <div className="absolute top-1/3 right-1/3 w-[30%] h-[30%] rounded-full bg-gradient-to-br from-emerald-500/20 via-teal-400/15 to-blue-500/20 blur-3xl" />
                        </div>
                      </div>
                      {/* 中心内容 */}
                      <div className="relative flex flex-col items-center gap-4 z-10">
                        <div className="relative w-14 h-14 flex items-center justify-center">
                          <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[var(--primary)] border-r-[var(--primary)]/50 animate-spin" />
                          <div className="absolute inset-1 rounded-full border-2 border-transparent border-b-purple-400/60 border-l-purple-400/30 animate-[spin_1.5s_linear_infinite_reverse]" />
                          <Sparkles size={20} className="text-[var(--primary)] animate-pulse" />
                        </div>
                        <div className="text-center space-y-1.5">
                          <p className="text-sm font-medium text-neutral-200">AI 正在创作中</p>
                          <p className="text-[11px] text-neutral-400">
                            {task.kind === 'video' ? '视频生成可能需要1-3分钟，请耐心等待...' : '图片正在生成，请稍候...'}
                          </p>
                        </div>
                        {task.progress > 0 && task.progress < 100 && (
                          <div className="space-y-1.5">
                            <div className="h-1.5 w-40 overflow-hidden rounded-full bg-neutral-800/80">
                              <motion.div
                                className="h-full rounded-full bg-gradient-to-r from-[var(--primary)] to-purple-400"
                                initial={{ width: 0 }}
                                animate={{ width: `${task.progress}%` }}
                                transition={{ duration: 0.3 }}
                              />
                            </div>
                            <p className="text-center text-[10px] text-neutral-500">{task.progressIsEstimated ? '预计进度 ' : '生成进度 '}{Math.round(task.progress)}%</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 素材展示：批次使用缩略图网格，单张保持大图 */}
                  {task.resultUrls.length > 0 && (
                    <div className={isImageBatch ? 'grid grid-cols-2 gap-2 xl:grid-cols-3' : 'space-y-3'}>
                      {task.resultUrls.map((url, idx) => (
                        <div
                          key={idx}
                          className={`relative group overflow-hidden rounded-lg border border-white/8 bg-neutral-950 ${isImageBatch ? 'aspect-[4/3] cursor-zoom-in' : 'rounded-xl'}`}
                          onClick={() => !isVideoUrl(url) && setPreviewResult({ url, task })}
                        >
                          {!isImageBatch && <div className="absolute inset-0">{isVideoUrl(url) ? <div className="h-full w-full bg-neutral-900" /> : <img src={url} alt="" className="h-full w-full scale-110 object-cover opacity-30 blur-2xl" />}</div>}
                          <div className={`relative flex items-center justify-center ${isImageBatch ? 'h-full w-full' : 'min-h-[320px] max-h-[560px]'}`}>
                            {isVideoUrl(url)
                              ? <video src={url} controls className="max-h-[560px] max-w-full rounded-lg" onClick={(event) => event.stopPropagation()} />
                              : <img src={url} alt={`生成结果 ${idx + 1}`} className={`${isImageBatch ? 'h-full w-full' : 'max-h-[560px] max-w-full rounded-lg'} object-contain`} />}
                          </div>
                          {isImageBatch && <span className="absolute left-2 top-2 rounded bg-black/65 px-2 py-1 text-[10px] text-neutral-300">{idx + 1} / {task.batchSize || task.resultUrls.length}</span>}
                          <div className="absolute right-2 top-2 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                            {!isVideoUrl(url) && <button className="rounded-md bg-black/70 p-2 backdrop-blur-sm hover:bg-black/90" title="查看完整图片" onClick={(event) => { event.stopPropagation(); setPreviewResult({ url, task }); }}><Maximize2 size={14} className="text-white" /></button>}
                            <button
                              className="rounded-md bg-black/70 p-2 backdrop-blur-sm hover:bg-black/90"
                              title="存入素材仓库"
                              onClick={(event) => { event.stopPropagation(); void saveToLibrary(url, task.kind, task.prompt); }}
                            >
                              <Package size={14} className="text-white" />
                            </button>
                            <a href={url} target="_blank" rel="noreferrer" className="rounded-md bg-black/70 p-2 backdrop-blur-sm hover:bg-black/90" onClick={(event) => event.stopPropagation()} title="下载素材">
                              <Download size={14} className="text-white" />
                            </a>
                          </div>
                          {!isVideoUrl(url) && (
                            <div className="absolute inset-x-2 bottom-2 flex translate-y-2 items-center justify-center gap-1.5 rounded-lg bg-black/75 p-1.5 opacity-0 backdrop-blur-md transition-all group-hover:translate-y-0 group-hover:opacity-100">
                              <button className="flex h-8 items-center gap-1 rounded px-2 text-[11px] text-neutral-200 hover:bg-white/10" onClick={(event) => { event.stopPropagation(); openSceneAdjustment({ url, task }); }}><SlidersHorizontal size={12} /> 调整场景</button>
                              <button disabled={isGenerating} className="flex h-8 items-center gap-1 rounded px-2 text-[11px] text-neutral-200 hover:bg-white/10 disabled:opacity-40" onClick={(event) => { event.stopPropagation(); void regenerateSingleResult(task); }}><RefreshCw size={12} /> 重新生成</button>
                              {workflowProjectId && task.workflowProjectId === workflowProjectId && workflowStage === 'scene' && (
                                <button disabled={Boolean(selectingResult)} className="flex h-8 items-center gap-1 rounded bg-white px-2 text-[11px] font-semibold text-black hover:bg-neutral-200 disabled:opacity-50" onClick={(event) => { event.stopPropagation(); void selectWorkflowResult(url, task); }}><CheckCircle2 size={12} /> {selectingResult === url ? '传递中' : '选用'}</button>
                              )}
                            </div>
                          )}
                          {isVideoUrl(url) && workflowProjectId && task.workflowProjectId === workflowProjectId && workflowStage === 'dynamic' && (
                            <button className="absolute bottom-3 left-1/2 flex h-10 -translate-x-1/2 items-center gap-2 rounded-md bg-white px-5 text-sm font-semibold text-black shadow-xl hover:bg-neutral-200 disabled:opacity-60" disabled={Boolean(selectingResult)} onClick={(event) => { event.stopPropagation(); void selectWorkflowResult(url, task); }}><CheckCircle2 size={15} /> {selectingResult === url ? '正在传递...' : '选用此视频并继续'}</button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 底部操作 */}
                  <div className="mt-3 flex items-center justify-between">
                    {task.status === 'failed' ? (
                      <button
                        className="flex items-center gap-1 text-[11px] text-red-400/80 hover:text-red-300 transition-colors"
                        title="删除这条失败记录"
                        onClick={() => deleteFailedTask(task.id)}
                      >
                        <Trash2 size={12} /> 删除记录
                      </button>
                    ) : <span />}
                    <button className="flex items-center gap-1 text-[11px] text-neutral-500 hover:text-[var(--primary)] transition-colors" onClick={() => setPayload((s) => ({ ...s, kind: task.kind, prompt: task.displayPrompt || task.prompt }))}>
                      <RefreshCw size={11} /> 一键同款
                    </button>
                  </div>
                </motion.div>
              );})}
            </div>
          )}
        </div>
      </div>
      <AnimatePresence>
        {previewResult && (
          <motion.div
            className="fixed inset-0 z-[170] flex items-center justify-center bg-black/85 p-8 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setPreviewResult(null)}
          >
            <motion.div className="relative flex h-full w-full max-w-7xl flex-col items-center justify-center" initial={{ scale: 0.97 }} animate={{ scale: 1 }} exit={{ scale: 0.97 }} onClick={(event) => event.stopPropagation()}>
              <img src={previewResult.url} alt="完整图片预览" className="max-h-[calc(100vh-150px)] max-w-full rounded-lg object-contain shadow-2xl" />
              <button className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20" title="关闭预览" onClick={() => setPreviewResult(null)}><X size={18} /></button>
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/10 bg-[#121617]/95 p-2 shadow-2xl">
                <button className="flex h-9 items-center gap-1.5 rounded-md px-3 text-xs text-neutral-200 hover:bg-white/10" onClick={() => { openSceneAdjustment(previewResult); setPreviewResult(null); }}><SlidersHorizontal size={13} /> 调整场景</button>
                <button disabled={isGenerating} className="flex h-9 items-center gap-1.5 rounded-md px-3 text-xs text-neutral-200 hover:bg-white/10 disabled:opacity-40" onClick={() => { const target = previewResult.task; setPreviewResult(null); void regenerateSingleResult(target); }}><RefreshCw size={13} /> 重新生成</button>
                {workflowProjectId && previewResult.task.workflowProjectId === workflowProjectId && workflowStage === 'scene' && <button className="flex h-9 items-center gap-1.5 rounded-md bg-white px-3 text-xs font-semibold text-black hover:bg-neutral-200" onClick={() => void selectWorkflowResult(previewResult.url, previewResult.task)}><CheckCircle2 size={13} /> 选用此场景</button>}
                <span className="px-2 text-[10px] text-neutral-600">点击画面外空白处或按 Esc 关闭</span>
              </div>
            </motion.div>
          </motion.div>
        )}
        {adjustTarget && (
          <motion.div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/80 p-3 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={closeSceneAdjustment}>
            <motion.div className="flex h-[calc(100vh-24px)] w-full max-w-[1680px] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0f1314] shadow-2xl" initial={{ y: 14, scale: 0.99 }} animate={{ y: 0, scale: 1 }} exit={{ y: 14, scale: 0.99 }} onClick={(event) => event.stopPropagation()}>
              <div className="flex shrink-0 items-start justify-between gap-4 border-b border-white/8 px-5 py-4">
                <div><h3 className="text-lg font-semibold text-white">调整当前场景</h3><p className="mt-1 text-xs leading-5 text-neutral-500">可精确涂抹局部区域，也可以直接通过关键词重新调整整张画面。</p></div>
                <button className="flex h-9 w-9 items-center justify-center rounded-md text-neutral-500 hover:bg-white/5 hover:text-white" onClick={closeSceneAdjustment}><X size={17} /></button>
              </div>
              <div className="scroll-area min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
                <div className="grid min-h-full grid-cols-1 gap-4 lg:min-h-[520px] lg:grid-cols-[minmax(0,1fr)_360px]">
                  <SceneRegionEditor
                    sourceUrl={adjustTarget.url}
                    selectionEnabled={adjustMode === 'region'}
                    onSelectionChange={(maskDataUrl, region) => {
                      setAdjustMask(maskDataUrl);
                      setAdjustRegion(region);
                    }}
                  />
                  <div className="scroll-area flex min-h-[500px] flex-col overflow-y-auto rounded-xl border border-white/10 bg-white/[0.025] p-4 lg:min-h-0">
                  <div className="mb-5 grid grid-cols-2 gap-1 rounded-lg border border-white/8 bg-black/30 p-1">
                    <button type="button" className={`h-10 rounded-md text-xs font-medium transition-colors ${adjustMode === 'region' ? 'bg-cyan-300 text-[#071012]' : 'text-neutral-400 hover:bg-white/5 hover:text-white'}`} onClick={() => setAdjustMode('region')}>局部调整</button>
                    <button type="button" className={`h-10 rounded-md text-xs font-medium transition-colors ${adjustMode === 'global' ? 'bg-violet-300 text-[#100b18]' : 'text-neutral-400 hover:bg-white/5 hover:text-white'}`} onClick={() => setAdjustMode('global')}>整体调整</button>
                  </div>
                  {adjustMode === 'region' && (
                    <>
                      <div className="flex items-center gap-2">
                        <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${adjustRegion ? 'bg-cyan-300 text-[#071012]' : 'bg-white/8 text-neutral-400'}`}>1</span>
                        <div><p className="text-sm font-medium text-neutral-200">标记修改区域</p><p className="mt-0.5 text-[10px] text-neutral-500">使用左侧画笔涂抹，可放大到原图 100% 查看细节</p></div>
                      </div>
                      <div className="my-3 ml-3 h-5 w-px bg-white/10" />
                    </>
                  )}
                  <div className="flex items-center gap-2">
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold ${adjustPrompt.trim() ? 'bg-cyan-300 text-[#071012]' : 'bg-white/8 text-neutral-400'}`}>{adjustMode === 'region' ? '2' : '1'}</span>
                    <div><p className="text-sm font-medium text-neutral-200">{adjustMode === 'region' ? '描述局部修改内容' : '描述整体调整方向'}</p><p className="mt-0.5 text-[10px] text-neutral-500">{adjustMode === 'region' ? '只描述选区内需要改变的内容即可' : '无需标记区域，直接描述整张画面的变化'}</p></div>
                  </div>
                  <textarea autoFocus className="mt-4 min-h-36 w-full resize-y rounded-lg border border-white/10 bg-black/35 px-4 py-3 text-sm leading-6 text-white outline-none placeholder:text-neutral-600 focus:border-cyan-400/50" placeholder={adjustMode === 'region' ? '例如：把选中的天空改成日落，增加暖橙色云层' : '例如：整体改成雨后的清晨氛围，降低饱和度，增加空气透视'} value={adjustPrompt} onChange={(event) => setAdjustPrompt(event.target.value)} />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {['改为晴天', '改为黄昏', '增加雨雾', '增强暖光', '增加绿植', '去除杂物'].map((suggestion) => <button key={suggestion} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-neutral-400 hover:border-cyan-400/30 hover:text-cyan-200" onClick={() => setAdjustPrompt((current) => current ? `${current}，${suggestion}` : suggestion)}>{suggestion}</button>)}
                  </div>
                  <div className="mt-auto space-y-3 pt-5">
                    <div className={`rounded-lg border px-3 py-2.5 text-[11px] leading-5 ${adjustMode === 'global' ? 'border-violet-400/20 bg-violet-400/[0.05] text-violet-100/80' : adjustRegion ? 'border-cyan-400/20 bg-cyan-400/[0.05] text-cyan-100/80' : 'border-amber-300/15 bg-amber-300/[0.04] text-amber-100/60'}`}>
                      {adjustMode === 'global' ? '将以当前图片为基础，按照关键词对整张画面进行统一调整。' : adjustRegion ? `已选中${describeEditRegion(adjustRegion)}，可生成调整版本。` : '请先在左侧图片上涂抹需要修改的位置。'}
                    </div>
                    <p className="text-[10px] text-neutral-600">生成结果会作为新版本保留，不覆盖当前图片。</p>
                    <div className="flex gap-2">
                      <button className="h-11 flex-1 rounded-md text-sm text-neutral-400 hover:bg-white/5 hover:text-white" onClick={closeSceneAdjustment}>取消</button>
                      <button disabled={!adjustPrompt.trim() || (adjustMode === 'region' && (!adjustMask || !adjustRegion)) || isGenerating} className="flex h-11 flex-[1.7] items-center justify-center gap-2 rounded-md bg-white px-4 text-sm font-semibold text-black hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-35" onClick={() => void submitSceneAdjustment()}><WandSparkles size={14} /> {isGenerating ? '生成中...' : `生成${adjustMode === 'region' ? '局部' : '整体'}调整版本`}</button>
                    </div>
                  </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      <AssetLibrary
        open={libraryTarget !== null}
        onClose={() => setLibraryTarget(null)}
        onSelectAsset={selectFromLibrary}
        title={libraryTarget === 'last' ? '选择尾帧素材' : libraryTarget === 'first' ? '选择首帧素材' : '选择参考素材'}
        layerClassName="z-[130]"
        defaultFilter="image"
      />
    </div>
  );
};
