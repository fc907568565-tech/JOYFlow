import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Box,
  Camera,
  Check,
  Download,
  Eraser,
  Film,
  Image as ImageIcon,
  Layers3,
  PackageCheck,
  Play,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Type,
  Upload,
  WandSparkles,
} from 'lucide-react';

import { AIStudio } from './AIStudio';
import { SemanticLayerEditor } from './SemanticLayerEditor';
import { addToLibrary, loadLibrary, type LibraryAsset } from '../utils/assetLibrary';
import { analyzePopupSemanticLayers, loadPromptAgentConfig } from '../ai/promptAgent';
import {
  segmentSemanticLayerObjects,
  type SemanticLayerObject,
} from '../utils/semanticLayerSegmentation';
import {
  inspectSolidBackground,
  type SolidBackgroundReport,
} from '../utils/solidBackgroundInspection';
import { renderSpecialtyCutout } from '../utils/specialtyCutout';
import { runSmartCutout } from '../utils/smartCutoutService';
import type { JoyState } from './JoyBridgePanel';
import {
  POPUP_RECIPE_PRESETS,
  buildPopupScenePrompt,
  createPopupProject,
  ensureActivePopupProject,
  patchActivePopupProject,
  type PopupLayout,
  type PopupCutoutSettings,
  type PopupProject,
  type PopupSceneRecipe,
  type PopupStage,
} from '../utils/popupWorkflow';

interface PopupWorkspaceProps {
  revision?: number;
  onEnterJoy: (asset: LibraryAsset, joyState: JoyState | null, projectId: string) => void;
  onOpenVideoExport: (asset: LibraryAsset, backgroundColor: string) => void;
}

const STAGES: Array<{ id: PopupStage; label: string; short: string }> = [
  { id: 'setup', label: '小场景设置', short: '设置' },
  { id: 'scene', label: '场景生成', short: '场景' },
  { id: 'subject', label: '主体植入', short: '主体' },
  { id: 'cutout', label: '背景抠除', short: '抠图' },
  { id: 'compose', label: '弹窗编排', short: '编排' },
  { id: 'motion', label: '可选动画', short: '动画' },
  { id: 'export', label: '交付导出', short: '导出' },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

type CutoutMethod = 'smart' | 'auto' | 'layers' | 'manual';

const fileToDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as string);
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const loadImage = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('图片加载失败'));
  image.src = url;
});

const parseHex = (hex: string) => {
  const normalized = hex.replace('#', '').trim();
  const value = Number.parseInt(normalized.length === 3
    ? normalized.split('').map((part) => `${part}${part}`).join('')
    : normalized, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
};

const drawContained = (
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  centerX: number,
  centerY: number,
  maxWidth: number,
  maxHeight: number,
  chroma?: { color: string; settings: PopupCutoutSettings },
) => {
  const scale = Math.min(maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const x = Math.round(centerX - width / 2);
  const y = Math.round(centerY - height / 2);
  if (!chroma) {
    context.drawImage(image, x, y, width, height);
    return;
  }
  const offscreen = document.createElement('canvas');
  offscreen.width = width;
  offscreen.height = height;
  const offscreenContext = offscreen.getContext('2d', { willReadFrequently: true });
  if (!offscreenContext) return;
  offscreenContext.drawImage(image, 0, 0, width, height);
  try {
    const pixels = offscreenContext.getImageData(0, 0, width, height);
    const target = parseHex(chroma.color);
    const threshold = clamp(chroma.settings.threshold, 0, 220);
    const feather = Math.max(1, chroma.settings.feather);
    const despill = clamp(chroma.settings.despill, 0, 1);
    const dominantChannel = target.g > target.r * 1.18 && target.g > target.b * 1.18
      ? 1
      : target.b > target.r * 1.18 && target.b > target.g * 1.18
        ? 2
        : target.r > target.g * 1.18 && target.r > target.b * 1.18
          ? 0
          : -1;
    for (let index = 0; index < pixels.data.length; index += 4) {
      const dr = pixels.data[index] - target.r;
      const dg = pixels.data[index + 1] - target.g;
      const db = pixels.data[index + 2] - target.b;
      const distance = Math.sqrt(dr * dr + dg * dg + db * db);
      if (distance <= threshold) pixels.data[index + 3] = 0;
      else if (distance < threshold + feather) pixels.data[index + 3] = Math.round(255 * ((distance - threshold) / feather));
      if (dominantChannel >= 0 && despill > 0 && distance < threshold + feather * 1.8) {
        const channelIndex = index + dominantChannel;
        const otherA = pixels.data[index + ((dominantChannel + 1) % 3)];
        const otherB = pixels.data[index + ((dominantChannel + 2) % 3)];
        const neutral = (otherA + otherB) / 2;
        const edgeWeight = 1 - clamp((distance - threshold) / Math.max(1, feather * 1.8), 0, 1);
        pixels.data[channelIndex] = Math.round(pixels.data[channelIndex] * (1 - despill * edgeWeight) + neutral * despill * edgeWeight);
      }
    }
    offscreenContext.putImageData(pixels, 0, 0);
  } catch {
    // Remote images without CORS permission still remain visible; export can be retried after caching in the library.
  }
  context.drawImage(offscreen, x, y);
};

const getAsset = (assets: LibraryAsset[], id?: string) => id ? assets.find((asset) => asset.id === id) || null : null;

// Relay「按钮、字体规范」以 375px 宽画布为基准。按输出画布等比换算，
// 让预览、PNG 与后续 Lottie 首帧保持同一套视觉比例。
const POPUP_STYLE_SPEC = {
  referenceCanvasWidth: 375,
  title: {
    fontSize: 24,
    fontFamily: '"FZLanTingHeiS-Heavy", "FZLanTingHeiS", "方正兰亭黑简体", "PingFang SC", sans-serif',
    fontWeight: 900,
    gradientTop: '#FFFCEC',
    gradientBottom: '#FFEDC7',
  },
  button: {
    width: 202.06,
    height: 40.08,
    radius: 5.01,
    fontSize: 16.7,
    fontFamily: '"PingFang SC", "苹方-简", -apple-system, BlinkMacSystemFont, sans-serif',
    fontWeight: 600,
    textColor: '#FFFFFF',
    gradientLeft: '#FF3C00',
    gradientRight: '#FF0F23',
  },
} as const;

const renderPopupCanvas = async (
  canvas: HTMLCanvasElement,
  project: PopupProject,
  assets: LibraryAsset[],
  options: { decorations?: boolean; applyCutout?: boolean; ignoreSavedCutout?: boolean } = {},
) => {
  const { decorations = true, applyCutout = true, ignoreSavedCutout = false } = options;
  const { layout } = project;
  canvas.width = layout.canvasWidth;
  canvas.height = layout.canvasHeight;
  const context = canvas.getContext('2d');
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);

  const scene = getAsset(assets, project.selectedSceneId);
  const subject = getAsset(assets, project.selectedSubjectId);
  const composite = getAsset(assets, project.selectedCompositeId);
  const cutout = ignoreSavedCutout ? null : getAsset(assets, project.selectedCutoutId);
  const mainAsset = cutout || composite || scene;
  const maxVisualWidth = canvas.width * (decorations ? 0.88 : 0.96) * layout.visualScale;
  const maxVisualHeight = canvas.height * (decorations ? 0.62 : 0.9) * layout.visualScale;
  const centerX = canvas.width * layout.visualX;
  const centerY = canvas.height * layout.visualY;

  if (mainAsset) {
    try {
      const image = await loadImage(mainAsset.url);
      drawContained(
        context,
        image,
        centerX,
        centerY,
        maxVisualWidth,
        maxVisualHeight,
        applyCutout && !cutout
          ? { color: project.sceneRecipe.backgroundColor, settings: project.cutoutSettings }
          : undefined,
      );
    } catch {
      // Keep the preview interactive even if one cached source has expired.
    }
  }
  if (!composite && !cutout && subject) {
    try {
      const image = await loadImage(subject.url);
      drawContained(
        context,
        image,
        centerX,
        centerY + canvas.height * 0.035,
        canvas.width * 0.4 * layout.visualScale,
        canvas.height * 0.42 * layout.visualScale,
      );
    } catch {
      // Ignore a broken optional subject layer.
    }
  }

  if (!decorations) return;
  const specScale = canvas.width / POPUP_STYLE_SPEC.referenceCanvasWidth;
  const titleSize = POPUP_STYLE_SPEC.title.fontSize * specScale * layout.titleScale;
  context.save();
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = `${POPUP_STYLE_SPEC.title.fontWeight} ${titleSize}px ${POPUP_STYLE_SPEC.title.fontFamily}`;
  const titleGradient = context.createLinearGradient(
    0,
    canvas.height * layout.titleY - titleSize * 0.55,
    0,
    canvas.height * layout.titleY + titleSize * 0.55,
  );
  titleGradient.addColorStop(0, POPUP_STYLE_SPEC.title.gradientTop);
  titleGradient.addColorStop(1, POPUP_STYLE_SPEC.title.gradientBottom);
  context.fillStyle = titleGradient;
  context.fillText(layout.titleText, canvas.width / 2, canvas.height * layout.titleY);
  context.restore();

  const buttonWidth = POPUP_STYLE_SPEC.button.width * specScale * layout.buttonScale;
  const buttonHeight = POPUP_STYLE_SPEC.button.height * specScale * layout.buttonScale;
  const buttonX = (canvas.width - buttonWidth) / 2;
  const buttonY = canvas.height * layout.buttonY - buttonHeight / 2;
  context.save();
  const buttonGradient = context.createLinearGradient(buttonX, buttonY, buttonX + buttonWidth, buttonY);
  buttonGradient.addColorStop(0, POPUP_STYLE_SPEC.button.gradientLeft);
  buttonGradient.addColorStop(1, POPUP_STYLE_SPEC.button.gradientRight);
  context.fillStyle = buttonGradient;
  context.beginPath();
  context.roundRect(buttonX, buttonY, buttonWidth, buttonHeight, POPUP_STYLE_SPEC.button.radius * specScale * layout.buttonScale);
  context.fill();
  context.fillStyle = POPUP_STYLE_SPEC.button.textColor;
  context.font = `${POPUP_STYLE_SPEC.button.fontWeight} ${POPUP_STYLE_SPEC.button.fontSize * specScale * layout.buttonScale}px ${POPUP_STYLE_SPEC.button.fontFamily}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(layout.buttonText, canvas.width / 2, canvas.height * layout.buttonY);
  context.restore();
};

const PopupPreview: React.FC<{ project: PopupProject; assets: LibraryAsset[]; className?: string }> = ({
  project,
  assets,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current) void renderPopupCanvas(canvasRef.current, project, assets);
  }, [project, assets]);
  return (
    <div className={`relative overflow-hidden rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_50%_32%,rgba(80,102,180,.2),rgba(6,9,15,.96)_70%)] shadow-2xl ${className}`}>
      <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(45deg,#1b2230_25%,transparent_25%),linear-gradient(-45deg,#1b2230_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#1b2230_75%),linear-gradient(-45deg,transparent_75%,#1b2230_75%)] [background-position:0_0,0_12px,12px_-12px,-12px_0] [background-size:24px_24px]" />
      <canvas ref={canvasRef} className="relative h-full w-full object-contain" />
    </div>
  );
};

const PopupCutoutPreview: React.FC<{
  project: PopupProject;
  assets: LibraryAsset[];
  applyCutout: boolean;
  semanticResultUrl?: string | null;
  semanticProgress?: number;
  semanticLabel?: string;
  className?: string;
}> = ({ project, assets, applyCutout, semanticResultUrl, semanticProgress = 0, semanticLabel = '', className = '' }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    const render = async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      if (!applyCutout) {
        await renderPopupCanvas(canvas, project, assets, { decorations: false, applyCutout: false, ignoreSavedCutout: true });
        return;
      }
      if (semanticResultUrl) {
        const image = await loadImage(semanticResultUrl);
        if (cancelled) return;
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const context = canvas.getContext('2d');
        context?.clearRect(0, 0, canvas.width, canvas.height);
        context?.drawImage(image, 0, 0);
        return;
      }
      if (project.cutoutSettings.backgroundMode === 'auto') {
        canvas.width = 1;
        canvas.height = 1;
        canvas.getContext('2d')?.clearRect(0, 0, 1, 1);
        return;
      }
      const dataUrl = await renderSmartPopupCutout(project, assets);
      if (cancelled) return;
      const image = await loadImage(dataUrl);
      if (cancelled) return;
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      context?.clearRect(0, 0, canvas.width, canvas.height);
      context?.drawImage(image, 0, 0);
    };
    void render().catch(() => undefined);
    return () => { cancelled = true; };
  }, [project, assets, applyCutout, semanticResultUrl]);
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-white/10 bg-[linear-gradient(45deg,#151b26_25%,transparent_25%),linear-gradient(-45deg,#151b26_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#151b26_75%),linear-gradient(-45deg,transparent_75%,#151b26_75%)] [background-position:0_0,0_14px,14px_-14px,-14px_0] [background-size:28px_28px] ${className}`}>
      <canvas ref={canvasRef} className="h-full w-full object-contain" />
      {applyCutout && project.cutoutSettings.backgroundMode === 'auto' && !semanticResultUrl && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#080d14]/72 px-8 text-center backdrop-blur-sm">
          <span className={`flex h-12 w-12 items-center justify-center rounded-2xl ${semanticProgress > 0 ? 'bg-emerald-300/15 text-emerald-300' : 'bg-white/8 text-neutral-400'}`}>
            {semanticProgress > 0 ? <RefreshCw size={21} className="animate-spin" /> : <WandSparkles size={21} />}
          </span>
          <strong className="mt-4 text-sm font-semibold text-white">{semanticProgress > 0 ? semanticLabel : '等待智能抠图'}</strong>
          <p className="mt-2 max-w-[260px] text-xs leading-5 text-neutral-500">
            {semanticProgress > 0 ? `正在处理 ${semanticProgress}%` : '自动识别主体、底座与关联道具，并精修透明边缘。'}
          </p>
          {semanticProgress > 0 && (
            <div className="mt-4 h-1.5 w-44 overflow-hidden rounded-full bg-white/8">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-400 transition-[width] duration-300" style={{ width: `${semanticProgress}%` }} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const cropTransparentCanvas = (source: HTMLCanvasElement, margin = 10, alphaThreshold = 5) => {
  const context = source.getContext('2d', { willReadFrequently: true });
  if (!context) return source;
  const pixels = context.getImageData(0, 0, source.width, source.height);
  let minX = source.width;
  let minY = source.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      if (pixels.data[(y * source.width + x) * 4 + 3] <= alphaThreshold) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < minX || maxY < minY) return source;
  minX = Math.max(0, minX - margin);
  minY = Math.max(0, minY - margin);
  maxX = Math.min(source.width - 1, maxX + margin);
  maxY = Math.min(source.height - 1, maxY + margin);
  const output = document.createElement('canvas');
  output.width = maxX - minX + 1;
  output.height = maxY - minY + 1;
  output.getContext('2d')?.drawImage(source, minX, minY, output.width, output.height, 0, 0, output.width, output.height);
  return output;
};

const renderSmartPopupCutout = async (project: PopupProject, assets: LibraryAsset[]) => {
  const croppedSource = await renderPopupCutoutSource(project, assets);
  const settings = {
    threshold: project.cutoutSettings.threshold,
    feather: project.cutoutSettings.feather,
    shadowCleanup: 20,
    edgeCleanup: Math.round(project.cutoutSettings.despill * 100),
    padding: 6,
    brightness: 0,
    contrast: 0,
    saturation: 0,
    temperature: 0,
  };
  return renderSpecialtyCutout(
    croppedSource,
    settings,
    900,
    1200,
    project.cutoutSettings.backgroundMode === 'manual'
      ? project.cutoutSettings.backgroundColor
      : undefined,
    project.cutoutSettings.backgroundMode === 'auto',
  );
};

const renderPopupCutoutSource = async (project: PopupProject, assets: LibraryAsset[]) => {
  const rawCanvas = document.createElement('canvas');
  await renderPopupCanvas(rawCanvas, project, assets, {
    decorations: false,
    applyCutout: false,
    ignoreSavedCutout: true,
  });
  const croppedSource = cropTransparentCanvas(rawCanvas, 0);
  return croppedSource.toDataURL('image/png');
};

const renderSolidColorPopupCutout = async (
  project: PopupProject,
  assets: LibraryAsset[],
  backgroundColor: string,
  sourceOverride?: string,
) => {
  const source = sourceOverride || await renderPopupCutoutSource(project, assets);
  return renderSpecialtyCutout(
    source,
    {
      threshold: project.cutoutSettings.threshold,
      feather: project.cutoutSettings.feather,
      shadowCleanup: 14,
      edgeCleanup: Math.round(project.cutoutSettings.despill * 100),
      padding: 6,
      brightness: 0,
      contrast: 0,
      saturation: 0,
      temperature: 0,
    },
    900,
    1200,
    backgroundColor,
    false,
  );
};

const SelectField: React.FC<{
  label: string;
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
}> = ({ label, value, options, onChange }) => (
  <label className="block">
    <span className="mb-2 block text-[11px] font-medium tracking-[0.14em] text-neutral-500">{label}</span>
    <select
      value={options.includes(value) ? value : '__custom__'}
      onChange={(event) => event.target.value !== '__custom__' && onChange(event.target.value)}
      className="h-11 w-full rounded-xl border border-white/10 bg-[#111722] px-3 text-sm text-neutral-200 outline-none focus:border-cyan-400/45"
    >
      {options.map((option) => <option key={option} value={option}>{option}</option>)}
      {!options.includes(value) && <option value="__custom__">自定义内容</option>}
    </select>
    <textarea
      value={value}
      onChange={(event) => onChange(event.target.value)}
      rows={label === '场景结构' ? 3 : 2}
      className="mt-2 w-full resize-none rounded-xl border border-white/8 bg-black/25 px-3 py-2.5 text-sm leading-6 text-neutral-300 outline-none focus:border-cyan-400/35"
    />
  </label>
);

const RangeField: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}> = ({ label, value, min, max, step = 1, suffix = '', onChange }) => (
  <label className="block">
    <span className="mb-2 flex items-center justify-between text-xs text-neutral-400">
      <span>{label}</span><strong className="font-mono text-cyan-300">{value}{suffix}</strong>
    </span>
    <input className="w-full accent-cyan-400" type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
  </label>
);

export const PopupWorkspace: React.FC<PopupWorkspaceProps> = ({ revision = 0, onEnterJoy, onOpenVideoExport }) => {
  const [project, setProject] = useState<PopupProject>(() => ensureActivePopupProject());
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [cameraUsesCurrent, setCameraUsesCurrent] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isCutting, setIsCutting] = useState(false);
  const [semanticCutoutUrl, setSemanticCutoutUrl] = useState<string | null>(null);
  const [semanticProgress, setSemanticProgress] = useState(0);
  const [semanticProgressLabel, setSemanticProgressLabel] = useState('');
  const [semanticError, setSemanticError] = useState('');
  const [backgroundReport, setBackgroundReport] = useState<SolidBackgroundReport | null>(null);
  const [solidFallbackUsed, setSolidFallbackUsed] = useState(false);
  const [cutoutMethod, setCutoutMethod] = useState<CutoutMethod>('smart');
  const [layerSourceUrl, setLayerSourceUrl] = useState<string | null>(null);
  const [layerCutoutUrl, setLayerCutoutUrl] = useState<string | null>(null);
  const [layerObjects, setLayerObjects] = useState<SemanticLayerObject[]>([]);
  const [layerError, setLayerError] = useState('');
  const subjectInputRef = useRef<HTMLInputElement>(null);

  const refreshAssets = async () => setAssets(await loadLibrary());
  useEffect(() => { void refreshAssets(); }, []);
  useEffect(() => {
    setProject(ensureActivePopupProject());
    void refreshAssets();
  }, [revision]);

  const updateProject = (patch: Partial<PopupProject>) => {
    const next = patchActivePopupProject(patch);
    if (next) setProject(next);
  };
  const updateRecipe = (patch: Partial<PopupSceneRecipe>) => {
    const recipe = { ...project.sceneRecipe, ...patch };
    updateProject({ sceneRecipe: recipe, scenePrompt: buildPopupScenePrompt(recipe) });
  };
  const updateLayout = (patch: Partial<PopupLayout>) => updateProject({ layout: { ...project.layout, ...patch } });
  const updateCutoutSettings = (patch: Partial<PopupCutoutSettings>) => updateProject({
    cutoutSettings: { ...project.cutoutSettings, ...patch },
    selectedCutoutId: undefined,
  });
  const currentStageIndex = STAGES.findIndex((stage) => stage.id === project.currentStage);
  const selectedScene = getAsset(assets, project.selectedSceneId);
  const selectedSubject = getAsset(assets, project.selectedSubjectId);
  const selectedComposite = getAsset(assets, project.selectedCompositeId);
  const selectedCutout = getAsset(assets, project.selectedCutoutId);
  const motionInput = getAsset(assets, project.motionInputId) || selectedCutout || selectedComposite || selectedSubject || selectedScene;
  const selectedMotion = getAsset(assets, project.selectedMotionId);
  const hasVisual = Boolean(selectedScene || selectedComposite || selectedCutout);

  useEffect(() => {
    const savedCutout = getAsset(assets, project.selectedCutoutId);
    setSemanticCutoutUrl(savedCutout?.url || null);
    setLayerCutoutUrl(null);
    setLayerSourceUrl(null);
    setLayerObjects([]);
    setLayerError('');
    setCutoutMethod(project.cutoutSettings.backgroundMode === 'manual' ? 'manual' : 'smart');
    setSemanticProgress(0);
    setSemanticProgressLabel('');
    setSemanticError('');
    setBackgroundReport(null);
    setSolidFallbackUsed(false);
  }, [project.id, project.selectedSceneId, project.selectedSubjectId, project.selectedCompositeId, project.selectedCutoutId, assets]);

  useEffect(() => {
    if (cutoutMethod !== 'layers' || !hasVisual || layerSourceUrl) return;
    let cancelled = false;
    setSemanticProgress(2);
    setSemanticProgressLabel('正在准备可点选的原始素材');
    void renderPopupCutoutSource(project, assets)
      .then((source) => {
        if (!cancelled) setLayerSourceUrl(source);
      })
      .catch((error) => {
        if (!cancelled) setLayerError(error instanceof Error ? error.message : '原始素材准备失败');
      })
      .finally(() => {
        if (!cancelled) {
          setSemanticProgress(0);
          setSemanticProgressLabel('');
        }
      });
    return () => { cancelled = true; };
  }, [cutoutMethod, hasVisual, layerSourceUrl, project, assets]);

  useEffect(() => {
    if (
      ['compose', 'motion', 'export'].includes(project.currentStage)
      && (project.selectedSceneId || project.selectedCompositeId)
      && !project.selectedCutoutId
    ) {
      updateProject({ currentStage: 'cutout' });
    }
  }, [project.currentStage, project.selectedSceneId, project.selectedCompositeId, project.selectedCutoutId]);

  const startNew = () => {
    const next = createPopupProject();
    setProject(next);
    setCameraUsesCurrent(false);
  };

  const handleSceneSelected = async (asset: LibraryAsset) => {
    await refreshAssets();
    updateProject({
      selectedSceneId: asset.id,
      selectedSubjectId: undefined,
      selectedCompositeId: undefined,
      selectedCutoutId: undefined,
      motionInputId: undefined,
      selectedMotionId: undefined,
      currentStage: 'subject',
    });
  };

  const handleSubjectUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const dataUrl = await fileToDataUrl(file);
    const asset = await addToLibrary({
      url: dataUrl,
      type: 'image',
      prompt: '用户上传的弹窗主体',
      name: file.name,
      projectId: project.id,
      workflowId: 'popup',
      stage: 'popup-subject',
      tags: ['动态弹窗', '上传主体'],
    });
    await refreshAssets();
    updateProject({
      selectedSubjectId: asset.id,
      selectedCompositeId: undefined,
      selectedCutoutId: undefined,
      motionInputId: undefined,
      selectedMotionId: undefined,
      currentStage: 'cutout',
    });
  };

  const selectCutoutMethod = (method: CutoutMethod) => {
    setCutoutMethod(method);
    setSemanticError('');
    setLayerError('');
    if (method === 'manual') updateCutoutSettings({ backgroundMode: 'manual' });
    else if (project.cutoutSettings.backgroundMode !== 'auto') updateCutoutSettings({ backgroundMode: 'auto' });
  };

  const runSemanticLayerCutout = async (sourceOverride?: string, propagateError = false) => {
    setIsCutting(true);
    setLayerError('');
    setSemanticProgress(4);
    setSemanticProgressLabel('正在准备图像理解');
    try {
      const source = sourceOverride || layerSourceUrl || await renderPopupCutoutSource(project, assets);
      if (!layerSourceUrl) setLayerSourceUrl(source);
      setSemanticProgress(8);
      setSemanticProgressLabel('AI 正在识别主体、承载舞台与关联道具');
      const understoodObjects = await analyzePopupSemanticLayers(loadPromptAgentConfig(), source);
      setLayerObjects(understoodObjects);
      setSemanticProgress(28);
      setSemanticProgressLabel(`已理解 ${understoodObjects.length} 个关联对象，正在分割`);
      const dataUrl = await segmentSemanticLayerObjects(source, understoodObjects, ({ percent, label }) => {
        setSemanticProgress(percent);
        setSemanticProgressLabel(label);
      });
      const image = await loadImage(dataUrl);
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      canvas.getContext('2d')?.drawImage(image, 0, 0);
      const compactResult = cropTransparentCanvas(canvas, 8, 8).toDataURL('image/png');
      setLayerCutoutUrl(compactResult);
      setSemanticProgress(0);
      setSemanticProgressLabel('语义分层完成');
      return compactResult;
    } catch (error) {
      const message = error instanceof Error ? error.message : '语义分层暂时不可用';
      setLayerError(message);
      setSemanticProgress(0);
      setSemanticProgressLabel('');
      if (propagateError) throw error;
      return null;
    } finally {
      setIsCutting(false);
    }
  };

  const runSolidBackgroundCutout = async () => {
    setIsCutting(true);
    setSemanticError('');
    setSemanticCutoutUrl(null);
    setSolidFallbackUsed(false);
    setSemanticProgress(4);
    setSemanticProgressLabel('正在检测四角与画面边缘');
    try {
      const source = await renderPopupCutoutSource(project, assets);
      const report = await inspectSolidBackground(source, project.sceneRecipe.backgroundColor);
      setBackgroundReport(report);
      if (!report.pass) {
        setSolidFallbackUsed(true);
        setSemanticProgress(8);
        setSemanticProgressLabel('背景含渐变或投影，自动切换 AI 分层');
        const fallbackResult = await runSemanticLayerCutout(source, true);
        if (!fallbackResult) {
          setSemanticError('背景不符合纯色快抠条件，AI 分层兜底也未完成，请检查语言模型配置或改用手动取色');
          return null;
        }
        setSemanticCutoutUrl(fallbackResult);
        setSemanticProgress(0);
        setSemanticProgressLabel('AI 分层兜底完成');
        return fallbackResult;
      }
      setSemanticProgress(46);
      setSemanticProgressLabel('背景合格，正在快速去除纯色');
      const dataUrl = await renderSolidColorPopupCutout(project, assets, report.detectedColor, source);
      setSemanticCutoutUrl(dataUrl);
      setSemanticProgress(0);
      setSemanticProgressLabel('纯色快抠完成');
      return dataUrl;
    } catch (error) {
      const message = error instanceof Error ? error.message : '背景检测与抠图暂时不可用';
      setSemanticError(message);
      setSemanticProgress(0);
      setSemanticProgressLabel('');
      return null;
    } finally {
      setIsCutting(false);
    }
  };

  const runBiRefNetCutout = async () => {
    setIsCutting(true);
    setSemanticError('');
    setSemanticCutoutUrl(null);
    setSemanticProgress(4);
    setSemanticProgressLabel('正在准备智能抠图');
    try {
      const source = await renderPopupCutoutSource(project, assets);
      const dataUrl = await runSmartCutout(source, ({ percent, label }) => {
        setSemanticProgress(percent);
        setSemanticProgressLabel(label);
      });
      setSemanticCutoutUrl(dataUrl);
      setSemanticProgress(0);
      setSemanticProgressLabel('智能抠图完成');
      return dataUrl;
    } catch (error) {
      const message = error instanceof Error ? error.message : '智能抠图暂时不可用';
      setSemanticError(message);
      setSemanticProgress(0);
      setSemanticProgressLabel('');
      return null;
    } finally {
      setIsCutting(false);
    }
  };

  const saveCutout = async () => {
    setIsCutting(true);
    try {
      const dataUrl = cutoutMethod === 'smart'
        ? semanticCutoutUrl || await runBiRefNetCutout()
        : cutoutMethod === 'layers'
        ? layerCutoutUrl || await runSemanticLayerCutout()
        : cutoutMethod === 'auto'
          ? semanticCutoutUrl || await runSolidBackgroundCutout()
          : await renderSmartPopupCutout(project, assets);
      if (!dataUrl) return;
      const asset = await addToLibrary({
        url: dataUrl,
        type: 'image',
        prompt: '动态弹窗主体与小场景透明抠图结果',
        name: `${project.name}_透明主体.png`,
        projectId: project.id,
        workflowId: 'popup',
        stage: 'popup-cutout',
        parentAssetId: project.selectedCompositeId || project.selectedSceneId,
        tags: ['动态弹窗', '透明主体', '抠图'],
        generationParams: { ...project.cutoutSettings, cutoutMethod, backgroundColor: project.sceneRecipe.backgroundColor },
      });
      await refreshAssets();
      updateProject({
        selectedCutoutId: asset.id,
        motionInputId: undefined,
        selectedMotionId: undefined,
        currentStage: 'compose',
      });
    } finally {
      setIsCutting(false);
    }
  };

  const prepareMotion = async () => {
    setIsPreparing(true);
    try {
      const canvas = document.createElement('canvas');
      await renderPopupCanvas(canvas, project, assets, { decorations: false });
      const dataUrl = canvas.toDataURL('image/png');
      const asset = await addToLibrary({
        url: dataUrl,
        type: 'image',
        prompt: '动态弹窗主体动画首帧',
        name: `${project.name}_动画首帧.png`,
        projectId: project.id,
        workflowId: 'popup',
        stage: 'popup-motion-input',
        parentAssetId: project.selectedCutoutId || project.selectedCompositeId || project.selectedSceneId,
        tags: ['动态弹窗', '动画首帧'],
      });
      await refreshAssets();
      updateProject({ motionInputId: asset.id, currentStage: 'motion' });
    } finally {
      setIsPreparing(false);
    }
  };

  const buildFinalPng = async () => {
    const canvas = document.createElement('canvas');
    await renderPopupCanvas(canvas, project, assets);
    return canvas.toDataURL('image/png');
  };

  const downloadFile = (content: BlobPart, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportPng = async () => {
    const dataUrl = await buildFinalPng();
    const asset = await addToLibrary({
      url: dataUrl,
      type: 'image',
      prompt: project.scenePrompt,
      name: `${project.name}_静态弹窗.png`,
      projectId: project.id,
      workflowId: 'popup',
      stage: 'popup-export',
      tags: ['动态弹窗', '静态交付'],
    });
    await refreshAssets();
    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = asset.name || 'popup.png';
    anchor.click();
  };

  const exportStaticLottie = async () => {
    const dataUrl = await buildFinalPng();
    const { canvasWidth: width, canvasHeight: height } = project.layout;
    const lottie = {
      v: '5.12.2', fr: 30, ip: 0, op: 90, w: width, h: height, nm: project.name, ddd: 0,
      assets: [{ id: 'popup_image', w: width, h: height, u: '', p: dataUrl, e: 1 }],
      layers: [{
        ddd: 0, ind: 1, ty: 2, nm: 'JOYFlow Popup', refId: 'popup_image', sr: 1,
        ks: {
          o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [width / 2, height / 2, 0] },
          a: { a: 0, k: [width / 2, height / 2, 0] }, s: { a: 0, k: [100, 100, 100] },
        },
        ao: 0, ip: 0, op: 90, st: 0, bm: 0,
      }],
    };
    downloadFile(JSON.stringify(lottie), `${project.name}_静态弹窗.json`, 'application/json');
  };

  const exportManifest = () => {
    const manifest = {
      version: 1,
      workflow: 'joyflow-dynamic-popup',
      project: {
        id: project.id,
        name: project.name,
        sceneRecipe: project.sceneRecipe,
        scenePrompt: project.scenePrompt,
        layout: project.layout,
        assets: {
          scene: project.selectedSceneId,
          subject: project.selectedSubjectId,
          composite: project.selectedCompositeId,
          cutout: project.selectedCutoutId,
          motion: project.selectedMotionId,
        },
      },
    };
    downloadFile(JSON.stringify(manifest, null, 2), `${project.name}_交付清单.json`, 'application/json');
  };

  const setupStage = (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(380px,0.92fr)_minmax(520px,1.25fr)] overflow-hidden">
      <div className="scroll-area min-h-0 overflow-y-auto overscroll-contain border-r border-white/8 px-7 py-6">
        <div className="mb-6">
          <span className="text-[10px] font-semibold tracking-[0.2em] text-cyan-400">MICRO SCENE BLUEPRINT</span>
          <h2 className="mt-2 text-2xl font-semibold text-white">先定义承载主体的小场景</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-500">预设负责稳定结构，所有内容仍可自由改写。中央会固定保留约 45% 的主体空间。</p>
        </div>
        <div className="space-y-5">
          <SelectField label="主题" value={project.sceneRecipe.theme} options={POPUP_RECIPE_PRESETS.theme} onChange={(theme) => updateRecipe({ theme })} />
          <SelectField label="场景结构" value={project.sceneRecipe.structure} options={POPUP_RECIPE_PRESETS.structure} onChange={(structure) => updateRecipe({ structure })} />
          <SelectField label="材质风格" value={project.sceneRecipe.materialStyle} options={POPUP_RECIPE_PRESETS.materialStyle} onChange={(materialStyle) => updateRecipe({ materialStyle })} />
          <div className="grid grid-cols-2 gap-3">
            <SelectField label="氛围" value={project.sceneRecipe.mood} options={POPUP_RECIPE_PRESETS.mood} onChange={(mood) => updateRecipe({ mood })} />
            <SelectField label="光线" value={project.sceneRecipe.lighting} options={POPUP_RECIPE_PRESETS.lighting} onChange={(lighting) => updateRecipe({ lighting })} />
          </div>
          <SelectField label="周围元素" value={project.sceneRecipe.surroundingElements} options={POPUP_RECIPE_PRESETS.surroundingElements} onChange={(surroundingElements) => updateRecipe({ surroundingElements })} />
          <label className="block">
            <span className="mb-2 block text-[11px] tracking-[0.14em] text-neutral-500">自由补充</span>
            <textarea value={project.sceneRecipe.freeNotes} onChange={(event) => updateRecipe({ freeNotes: event.target.value })} rows={3} placeholder="可选，例如：奖杯略靠右，左侧留出角色手臂空间" className="w-full resize-none rounded-xl border border-white/10 bg-black/25 px-3 py-3 text-sm leading-6 text-neutral-300 outline-none focus:border-cyan-400/40" />
          </label>
        </div>
      </div>
      <div className="scroll-area min-h-0 overflow-y-auto overscroll-contain px-8 py-6 pb-10">
        <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
          <section className="rounded-2xl border border-white/8 bg-[#10151e] p-5">
            <div className="mb-5 flex items-center gap-2 text-sm font-semibold text-white"><Camera size={17} className="text-cyan-400" /> 机位与抠图背景</div>
            <div className="space-y-5">
              <RangeField label="轻微俯视角" value={project.sceneRecipe.pitch} min={0} max={15} suffix="°" onChange={(pitch) => updateRecipe({ pitch })} />
              <RangeField label="水平偏转" value={project.sceneRecipe.yaw} min={-30} max={30} suffix="°" onChange={(yaw) => updateRecipe({ yaw })} />
              <RangeField label="焦段" value={project.sceneRecipe.focalLength} min={28} max={85} suffix=" mm" onChange={(focalLength) => updateRecipe({ focalLength })} />
              <div className="rounded-xl border border-fuchsia-300/15 bg-fuchsia-300/[0.045] px-3 py-3">
                <div className="flex items-center justify-between text-sm text-neutral-400">
                  <span>固定纯色抠图背景</span>
                  <span className="flex items-center gap-2 font-mono text-xs text-neutral-300">
                    <input type="color" value={project.sceneRecipe.backgroundColor} onChange={(event) => updateRecipe({ backgroundColor: event.target.value })} className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent" />
                    {project.sceneRecipe.backgroundColor}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <p className="text-[10px] leading-4 text-neutral-600">推荐保持纯品红，生成指令会禁止渐变、纹理和背景投影。</p>
                  {project.sceneRecipe.backgroundColor.toLowerCase() !== '#ff00ff' && (
                    <button type="button" onClick={() => updateRecipe({ backgroundColor: '#ff00ff' })} className="shrink-0 rounded-md border border-fuchsia-300/15 px-2 py-1 text-[10px] text-fuchsia-200/70 hover:text-fuchsia-100">恢复推荐色</button>
                  )}
                </div>
              </div>
            </div>
          </section>
          <section className="rounded-2xl border border-white/8 bg-[#10151e] p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">最终生成指令</div>
                <p className="mt-1 text-xs text-neutral-500">可以直接修改，不受字段结构限制。</p>
              </div>
              <button onClick={() => updateProject({ scenePrompt: buildPopupScenePrompt(project.sceneRecipe) })} className="flex h-8 items-center gap-1.5 rounded-lg border border-white/10 px-2.5 text-xs text-neutral-400 hover:text-white"><RefreshCw size={12} /> 根据设置重建</button>
            </div>
            <textarea value={project.scenePrompt} onChange={(event) => updateProject({ scenePrompt: event.target.value })} className="mt-4 min-h-[390px] w-full resize-y rounded-xl border border-cyan-400/18 bg-black/35 px-4 py-4 text-[13px] leading-6 text-neutral-300 outline-none focus:border-cyan-400/45" />
          </section>
        </div>
        <button onClick={() => updateProject({ currentStage: 'scene' })} className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-400 to-blue-600 text-sm font-semibold text-white shadow-lg shadow-blue-950/40 hover:brightness-110">
          <Sparkles size={17} /> 进入场景生成 <ArrowRight size={16} />
        </button>
      </div>
    </div>
  );

  const sceneStage = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 border-b border-white/8 bg-[#0c1119] px-5 py-3">
        <div className="mr-auto">
          <strong className="text-sm text-white">微缩场景生成</strong>
          <span className="ml-2 text-xs text-neutral-500">支持一次生成多张，点击结果后选用</span>
        </div>
        <button onClick={() => updateProject({ currentStage: 'setup' })} className="flex h-9 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs text-neutral-300"><SlidersHorizontal size={13} /> 修改结构与机位</button>
        {selectedScene && (
          <label className="flex h-9 items-center gap-2 rounded-lg border border-white/10 px-3 text-xs text-neutral-300">
            <input type="checkbox" checked={cameraUsesCurrent} onChange={(event) => setCameraUsesCurrent(event.target.checked)} className="accent-cyan-400" />
            以已选场景为参考重构机位
          </label>
        )}
        {selectedScene && (
          <button onClick={() => updateProject({ scenePrompt: buildPopupScenePrompt(project.sceneRecipe, true), sceneRevision: project.sceneRevision + 1 })} className="flex h-9 items-center gap-1.5 rounded-lg bg-cyan-400/12 px-3 text-xs font-medium text-cyan-300"><Camera size={13} /> 应用新机位</button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <AIStudio
          key={`${project.id}:${project.sceneRevision}`}
          workflowProjectId={`${project.id}:scene:${project.sceneRevision}`}
          workflowStage="scene"
          workflowRatio="1:1"
          workflowSize="1024x1024"
          workflowPrompt={project.scenePrompt}
          workflowPromptMaxLength={1600}
          workflowReferenceImages={cameraUsesCurrent && selectedScene ? [selectedScene.url] : []}
          workflowReferenceLabels={cameraUsesCurrent && selectedScene ? ['当前小场景，仅调整机位'] : []}
          onWorkflowPromptChange={(scenePrompt) => updateProject({ scenePrompt })}
          onSelectResult={(asset) => void handleSceneSelected(asset)}
        />
      </div>
    </div>
  );

  const subjectStage = (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(480px,1.25fr)_minmax(360px,0.75fr)] overflow-hidden">
      <div className="flex min-h-0 items-center justify-center bg-black/35 p-8">
        {selectedScene ? (
          <div className="relative max-h-full max-w-[780px] overflow-hidden rounded-[28px] border border-white/10 bg-black shadow-2xl">
            <img src={selectedScene.url} alt="已选小场景" className="max-h-[70vh] w-full object-contain" />
            <div className="pointer-events-none absolute inset-[25%] rounded-[42%] border border-dashed border-cyan-300/60 bg-cyan-300/5" />
            <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/60 px-4 py-2 text-xs text-cyan-200 backdrop-blur">约 45% 主体植入区</span>
          </div>
        ) : <div className="text-neutral-500">请先选择一张场景图</div>}
      </div>
      <div className="scroll-area min-h-0 overflow-y-auto overscroll-contain border-l border-white/8 px-7 py-7">
        <span className="text-[10px] font-semibold tracking-[0.2em] text-purple-400">SUBJECT</span>
        <h2 className="mt-2 text-2xl font-semibold text-white">选择主体植入方式</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-500">JOY 会进入角色控制器；其他主体可直接上传透明 PNG，并在下一步调整大小和位置。</p>
        <div className="mt-7 space-y-3">
          <button disabled={!selectedScene} onClick={() => selectedScene && onEnterJoy(selectedScene, project.joyState as JoyState | null, project.id)} className="group flex w-full items-center gap-4 rounded-2xl border border-purple-400/25 bg-purple-400/8 p-5 text-left hover:border-purple-300/45 disabled:opacity-40">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-400/15 text-purple-300"><Box size={22} /></span>
            <span className="min-w-0 flex-1"><strong className="block text-sm text-white">植入 JOY 角色</strong><small className="mt-1 block text-xs leading-5 text-neutral-500">设置动作、表情、角度和位置，再返回弹窗编排</small></span>
            <ArrowRight size={16} className="text-neutral-600 group-hover:text-white" />
          </button>
          <button disabled={!selectedScene} onClick={() => subjectInputRef.current?.click()} className="group flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.025] p-5 text-left hover:border-cyan-300/35 disabled:opacity-40">
            <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300"><Upload size={21} /></span>
            <span className="min-w-0 flex-1"><strong className="block text-sm text-white">上传自己的主体</strong><small className="mt-1 block text-xs leading-5 text-neutral-500">推荐透明 PNG；首版支持主体叠放和整体缩放</small></span>
            <ArrowRight size={16} className="text-neutral-600 group-hover:text-white" />
          </button>
          <input ref={subjectInputRef} hidden type="file" accept="image/png,image/webp,image/jpeg" onChange={(event) => void handleSubjectUpload(event)} />
          <button disabled={!selectedScene} onClick={() => updateProject({ selectedCutoutId: undefined, currentStage: 'cutout' })} className="flex w-full items-center justify-between rounded-xl border border-white/8 px-4 py-3 text-xs text-neutral-500 hover:text-neutral-200 disabled:opacity-40">
            暂不植入主体，直接抠除场景背景 <ArrowRight size={14} />
          </button>
        </div>
        <button onClick={() => updateProject({ currentStage: 'scene' })} className="mt-8 flex items-center gap-2 text-xs text-neutral-500 hover:text-white"><ArrowLeft size={14} /> 返回重新选择场景</button>
      </div>
    </div>
  );

  const cutoutStage = (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(520px,1.2fr)_minmax(360px,0.8fr)] overflow-hidden">
      <div className="min-h-0 overflow-y-auto bg-black/35 p-6">
        <div className="mx-auto flex h-full min-h-[480px] max-w-[980px] flex-col">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div>
              <span className="text-[10px] font-semibold tracking-[0.2em] text-emerald-400">BACKGROUND REMOVAL</span>
              <h2 className="mt-1.5 text-xl font-semibold text-white">确认背景抠除效果</h2>
            </div>
            <span className="text-xs text-neutral-500">透明区域使用棋盘格显示</span>
          </div>
          {cutoutMethod === 'layers' ? (
            <SemanticLayerEditor
              sourceUrl={layerSourceUrl}
              resultUrl={layerCutoutUrl}
              objects={layerObjects}
              disabled={isCutting}
              progress={semanticProgress}
              progressLabel={semanticProgressLabel}
            />
          ) : (
            <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
              <div className="flex min-h-0 flex-col">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-neutral-400"><span className="h-2 w-2 rounded-full bg-neutral-500" /> 原始素材</div>
                <PopupCutoutPreview project={project} assets={assets} applyCutout={false} className="min-h-0 flex-1" />
              </div>
              <div className="flex min-h-0 flex-col">
                <div className="mb-2 flex items-center gap-2 text-xs font-medium text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400" /> 透明结果预览</div>
                <PopupCutoutPreview
                  project={project}
                  assets={assets}
                  applyCutout
                  semanticResultUrl={cutoutMethod === 'smart' || cutoutMethod === 'auto' ? semanticCutoutUrl : null}
                  semanticProgress={semanticProgress}
                  semanticLabel={semanticProgressLabel}
                  className="min-h-0 flex-1 ring-1 ring-emerald-400/15"
                />
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="scroll-area min-h-0 overflow-y-auto overscroll-contain border-l border-white/8 px-7 py-7">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300"><Eraser size={20} /></span>
          <div><h2 className="text-xl font-semibold text-white">智能抠图</h2><p className="mt-1 text-xs text-neutral-500">自动保留主体、小舞台与关联道具</p></div>
        </div>
        <div className="mt-7 space-y-6 rounded-2xl border border-white/8 bg-[#10151e] p-5">
          <div>
            <span className="mb-2 block text-xs text-neutral-400">处理方式</span>
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/8 bg-black/25 p-1">
              <button
                type="button"
                onClick={() => selectCutoutMethod('smart')}
                className={`h-9 rounded-md text-xs font-medium ${cutoutMethod === 'smart' ? 'bg-emerald-300 text-[#06130f]' : 'text-neutral-500 hover:text-white'}`}
              >
                智能抠图
              </button>
              <button
                type="button"
                onClick={() => selectCutoutMethod('manual')}
                className={`h-9 rounded-md text-xs font-medium ${cutoutMethod === 'manual' ? 'bg-white/12 text-white' : 'text-neutral-500 hover:text-white'}`}
              >
                手动取色
              </button>
            </div>
            <p className="mt-2 text-[10px] leading-4 text-neutral-600">智能模式使用与独立抠图工具相同的完整组合策略，不需要调整模型参数。</p>
          </div>
          {cutoutMethod === 'smart' ? (
            <div className="space-y-3">
              <div className="rounded-xl border border-emerald-300/15 bg-emerald-300/[0.055] p-4">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-300/12 text-emerald-200"><WandSparkles size={17} /></span>
                  <div>
                    <strong className="text-sm font-semibold text-emerald-50">自动识别完整前景组合</strong>
                    <p className="mt-1.5 text-[11px] leading-5 text-emerald-100/45">同时保留核心主体、承载底座和强关联道具，再精修透明边缘与白边。</p>
                  </div>
                </div>
              </div>
              <button
                type="button"
                disabled={isCutting || !hasVisual}
                onClick={() => void runBiRefNetCutout()}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-emerald-300/25 bg-emerald-300/10 text-sm font-semibold text-emerald-200 hover:bg-emerald-300/15 disabled:opacity-40"
              >
                {isCutting ? <RefreshCw size={16} className="animate-spin" /> : <WandSparkles size={16} />}
                {isCutting ? `${semanticProgressLabel || '正在智能抠图'} ${semanticProgress || ''}${semanticProgress ? '%' : ''}` : semanticCutoutUrl ? '重新智能抠图' : '智能抠图'}
              </button>
              <p className="text-[10px] leading-4 text-neutral-600">固定输出 700 × 700 透明 PNG。首次使用若模型尚未缓存，准备时间会稍长。</p>
              {semanticError && <p className="rounded-lg border border-red-400/15 bg-red-400/8 px-3 py-2 text-[11px] leading-5 text-red-300">智能抠图失败：{semanticError}</p>}
            </div>
          ) : (
            <>
              <label className="flex items-center justify-between text-sm text-neutral-400">
                背景取样色
                <span className="flex items-center gap-2 font-mono text-xs text-neutral-300">
                  <input
                    type="color"
                    value={project.cutoutSettings.backgroundColor}
                    onChange={(event) => updateCutoutSettings({ backgroundColor: event.target.value })}
                    className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent"
                  />
                  {project.cutoutSettings.backgroundColor}
                </span>
              </label>
              <RangeField label="抠除范围" value={project.cutoutSettings.threshold} min={10} max={90} onChange={(threshold) => updateCutoutSettings({ threshold })} />
              <RangeField label="边缘柔化" value={project.cutoutSettings.feather} min={2} max={28} onChange={(feather) => updateCutoutSettings({ feather })} />
              <RangeField label="边缘去色" value={project.cutoutSettings.despill} min={0} max={1} step={0.05} onChange={(despill) => updateCutoutSettings({ despill })} />
            </>
          )}
        </div>
        <div className="mt-4 rounded-xl border border-cyan-300/12 bg-cyan-300/5 px-4 py-3 text-xs leading-5 text-cyan-50/55">
          {cutoutMethod === 'smart'
            ? '系统会自动保留主体、底座与强关联道具，并输出统一尺寸的透明素材。确认预览无误后再进入弹窗编排。'
            : '手动模式用于智能结果不理想的特殊图片：先调整抠除范围，再用边缘柔化和边缘去色清理色边。'}
        </div>
        <button
          disabled={isCutting || !hasVisual}
          onClick={() => void saveCutout()}
          className="mt-5 flex h-13 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-cyan-500 text-sm font-semibold text-[#061513] shadow-lg shadow-emerald-950/35 disabled:opacity-40"
        >
          <Eraser size={16} /> {isCutting ? '正在生成透明素材...' : '确认抠图并进入弹窗编排'}
        </button>
        <button onClick={() => updateProject({ currentStage: 'subject' })} className="mt-5 flex items-center gap-2 text-xs text-neutral-500 hover:text-white"><ArrowLeft size={14} /> 返回主体植入</button>
      </div>
    </div>
  );

  const composeStage = (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(480px,1.15fr)_minmax(390px,0.85fr)] overflow-hidden">
      <div className="flex min-h-0 items-center justify-center bg-black/35 p-7">
        <PopupPreview project={project} assets={assets} className="aspect-[4/5] h-full max-h-[76vh]" />
      </div>
      <div className="scroll-area min-h-0 overflow-y-auto overscroll-contain border-l border-white/8 px-7 py-6">
        <div className="mb-6">
          <span className="text-[10px] font-semibold tracking-[0.2em] text-cyan-400">POPUP COMPOSER</span>
          <h2 className="mt-2 text-2xl font-semibold text-white">弹窗编排</h2>
          <p className="mt-2 text-sm leading-6 text-neutral-500">标题和按钮保持统一视觉规范，你只需要修改文案、位置和大小。</p>
        </div>
        <section className="rounded-2xl border border-white/8 bg-[#10151e] p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white"><Type size={16} className="text-amber-300" /> 标题</div>
          <div className="mb-4 flex flex-wrap gap-2 text-[11px] text-neutral-400">
            <span className="rounded-md border border-white/8 bg-black/20 px-2 py-1">方正兰亭黑简体 · Heavy</span>
            <span className="rounded-md border border-white/8 bg-black/20 px-2 py-1">24px 规范字号</span>
            <span className="rounded-md border border-white/8 bg-[linear-gradient(180deg,#FFFCEC,#FFEDC7)] px-2 py-1 font-semibold text-[#5d3a28]">#FFFCEC → #FFEDC7</span>
          </div>
          <input value={project.layout.titleText} onChange={(event) => updateLayout({ titleText: event.target.value.slice(0, 16) })} className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-amber-300/40" />
          <div className="mt-4 grid grid-cols-2 gap-4">
            <RangeField label="上下位置" value={Math.round(project.layout.titleY * 100)} min={7} max={28} suffix="%" onChange={(value) => updateLayout({ titleY: value / 100 })} />
            <RangeField label="标题大小" value={project.layout.titleScale} min={0.65} max={1.35} step={0.05} onChange={(titleScale) => updateLayout({ titleScale })} />
          </div>
        </section>
        <section className="mt-3 rounded-2xl border border-white/8 bg-[#10151e] p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white"><ImageIcon size={16} className="text-cyan-300" /> 主体场景</div>
          <div className="space-y-4">
            <RangeField label="水平位置" value={Math.round(project.layout.visualX * 100)} min={25} max={75} suffix="%" onChange={(value) => updateLayout({ visualX: value / 100 })} />
            <RangeField label="上下位置" value={Math.round(project.layout.visualY * 100)} min={28} max={70} suffix="%" onChange={(value) => updateLayout({ visualY: value / 100 })} />
            <RangeField label="整体大小" value={project.layout.visualScale} min={0.45} max={1.1} step={0.05} onChange={(visualScale) => updateLayout({ visualScale })} />
          </div>
        </section>
        <section className="mt-3 rounded-2xl border border-white/8 bg-[#10151e] p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-white"><Play size={16} className="text-purple-300" /> 按钮</div>
          <div className="mb-4 flex flex-wrap gap-2 text-[11px] text-neutral-400">
            <span className="rounded-md border border-white/8 bg-black/20 px-2 py-1">苹方-简 · Semibold · 16.7px</span>
            <span className="rounded-md bg-[linear-gradient(90deg,#FF3C00,#FF0F23)] px-2 py-1 font-semibold text-white">#FF3C00 → #FF0F23</span>
            <span className="rounded-md border border-white/8 bg-black/20 px-2 py-1">白色文字 · 5px 圆角</span>
          </div>
          <input value={project.layout.buttonText} onChange={(event) => updateLayout({ buttonText: event.target.value.slice(0, 10) })} className="h-11 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-sm text-white outline-none focus:border-purple-300/40" />
          <div className="mt-4 grid grid-cols-2 gap-4">
            <RangeField label="上下位置" value={Math.round(project.layout.buttonY * 100)} min={68} max={94} suffix="%" onChange={(value) => updateLayout({ buttonY: value / 100 })} />
            <RangeField label="按钮大小" value={project.layout.buttonScale} min={0.7} max={1.3} step={0.05} onChange={(buttonScale) => updateLayout({ buttonScale })} />
          </div>
        </section>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button onClick={() => updateProject({ currentStage: 'export' })} className="flex h-12 items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/[0.035] text-sm font-semibold text-white"><Download size={15} /> 静态交付</button>
          <button disabled={isPreparing || !hasVisual} onClick={() => void prepareMotion()} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-purple-500 to-blue-600 text-sm font-semibold text-white disabled:opacity-40"><Film size={15} /> {isPreparing ? '准备首帧...' : '制作动态主体'}</button>
        </div>
        <button onClick={() => updateProject({ currentStage: 'cutout' })} className="mt-4 flex items-center gap-2 text-xs text-neutral-500 hover:text-white"><Eraser size={13} /> 返回重新调整抠图</button>
      </div>
    </div>
  );

  const motionStage = (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-3 border-b border-white/8 bg-[#0c1119] px-5 py-3">
        <button onClick={() => updateProject({ currentStage: 'compose' })} className="flex h-9 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs text-neutral-300"><ArrowLeft size={13} /> 返回编排</button>
        <div className="mr-auto"><strong className="text-sm text-white">可选：让主体场景动起来</strong><span className="ml-2 text-xs text-neutral-500">静态素材也可以直接跳过</span></div>
        <button onClick={() => updateProject({ currentStage: 'export' })} className="h-9 rounded-lg border border-white/10 px-3 text-xs text-neutral-300">跳过动画</button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {motionInput ? (
          <AIStudio
            workflowProjectId={`${project.id}:motion`}
            workflowStage="dynamic"
            workflowInputAsset={motionInput}
            workflowRatio="4:5"
            workflowPrompt="保持微缩场景、主体结构、材质、颜色与构图一致；主体做简洁清晰的营销动效，镜头稳定，不新增文字、按钮、人物或页面背景，背景保持均匀纯色便于抠图。"
            onSelectResult={async (asset) => {
              await refreshAssets();
              updateProject({ selectedMotionId: asset.id, currentStage: 'export' });
            }}
          />
        ) : <div className="flex h-full items-center justify-center text-neutral-500">缺少动画首帧，请返回编排步骤</div>}
      </div>
    </div>
  );

  const exportStage = (
    <div className="grid min-h-0 flex-1 grid-cols-[minmax(460px,1fr)_minmax(420px,0.85fr)] overflow-hidden">
      <div className="flex min-h-0 items-center justify-center bg-black/35 p-7">
        <PopupPreview project={project} assets={assets} className="aspect-[4/5] h-full max-h-[76vh]" />
      </div>
      <div className="scroll-area min-h-0 overflow-y-auto overscroll-contain border-l border-white/8 px-8 py-8">
        <span className="text-[10px] font-semibold tracking-[0.2em] text-emerald-400">DELIVERY</span>
        <h2 className="mt-2 text-2xl font-semibold text-white">导出与交付</h2>
        <p className="mt-2 text-sm leading-6 text-neutral-500">首版支持完整静态弹窗 PNG、静态 Lottie 和交付清单。动态主体使用现有转格式工具完成抠底与 Lottie 转换。</p>
        <div className="mt-7 space-y-3">
          <button onClick={() => void exportPng()} className="flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.025] p-5 text-left hover:border-cyan-300/35">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300"><ImageIcon size={20} /></span>
            <span className="flex-1"><strong className="block text-sm text-white">导出透明 PNG</strong><small className="mt-1 block text-xs text-neutral-500">包含标题、主体小场景与按钮</small></span><Download size={16} />
          </button>
          <button onClick={() => void exportStaticLottie()} className="flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.025] p-5 text-left hover:border-purple-300/35">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-purple-400/10 text-purple-300"><WandSparkles size={20} /></span>
            <span className="flex-1"><strong className="block text-sm text-white">导出静态 Lottie</strong><small className="mt-1 block text-xs text-neutral-500">保留透明画布，适合静态弹窗交付</small></span><Download size={16} />
          </button>
          {selectedMotion && (
            <button onClick={() => onOpenVideoExport(selectedMotion, project.sceneRecipe.backgroundColor)} className="flex w-full items-center gap-4 rounded-2xl border border-blue-400/25 bg-blue-400/8 p-5 text-left hover:border-blue-300/45">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-400/12 text-blue-300"><Film size={20} /></span>
              <span className="flex-1"><strong className="block text-sm text-white">动态主体抠底并转 Lottie</strong><small className="mt-1 block text-xs text-neutral-500">已自动带入 {project.sceneRecipe.backgroundColor} 抠图色</small></span><ArrowRight size={16} />
            </button>
          )}
          <button onClick={exportManifest} className="flex w-full items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.025] p-5 text-left hover:border-emerald-300/35">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-400/10 text-emerald-300"><PackageCheck size={20} /></span>
            <span className="flex-1"><strong className="block text-sm text-white">导出交付清单</strong><small className="mt-1 block text-xs text-neutral-500">记录场景关键词、布局和素材关系</small></span><Download size={16} />
          </button>
        </div>
        <div className="mt-6 rounded-xl border border-amber-300/15 bg-amber-300/5 px-4 py-3 text-xs leading-5 text-amber-100/65">
          动态弹窗的“标题与按钮作为独立可编辑 Lottie 图层”会作为下一版增强；当前动态主体先进入现有转格式工具，静态完整弹窗已可直接交付。
        </div>
        <button onClick={() => updateProject({ currentStage: 'compose' })} className="mt-6 flex items-center gap-2 text-xs text-neutral-500 hover:text-white"><ArrowLeft size={14} /> 返回继续调整</button>
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#080c12]">
      <div className="flex h-[72px] shrink-0 items-center gap-4 border-b border-white/8 bg-[#0c1119]/95 px-5">
        <div className="min-w-[210px]">
          <div className="flex items-center gap-2 text-sm font-semibold text-white"><Sparkles size={15} className="text-purple-400" /> {project.name}</div>
          <div className="mt-1 text-[10px] tracking-[0.15em] text-neutral-600">DYNAMIC MARKETING POPUP</div>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-1">
          {STAGES.map((stage, index) => {
            const completed = index < currentStageIndex;
            const active = stage.id === project.currentStage;
            const canOpen = index <= currentStageIndex || (stage.id === 'export' && hasVisual);
            return (
              <React.Fragment key={stage.id}>
                {index > 0 && <span className={`h-px min-w-3 flex-1 ${completed || active ? 'bg-cyan-400/45' : 'bg-white/8'}`} />}
                <button disabled={!canOpen} onClick={() => canOpen && updateProject({ currentStage: stage.id })} className={`flex shrink-0 items-center gap-2 rounded-lg px-2.5 py-2 text-xs transition ${active ? 'bg-cyan-400/10 text-cyan-300' : completed ? 'text-neutral-300' : 'text-neutral-600'} disabled:cursor-not-allowed`} title={stage.label}>
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] ${active ? 'border-cyan-300 bg-cyan-300 text-[#041118]' : completed ? 'border-cyan-400/50 text-cyan-300' : 'border-white/10'}`}>{completed ? <Check size={12} /> : String(index + 1).padStart(2, '0')}</span>
                  <span className="hidden 2xl:inline">{stage.short}</span>
                </button>
              </React.Fragment>
            );
          })}
        </div>
        <button onClick={startNew} className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs text-neutral-400 hover:text-white"><Plus size={14} /> 新建弹窗</button>
      </div>
      {project.currentStage === 'setup' && setupStage}
      {project.currentStage === 'scene' && sceneStage}
      {project.currentStage === 'subject' && subjectStage}
      {project.currentStage === 'cutout' && cutoutStage}
      {project.currentStage === 'compose' && composeStage}
      {project.currentStage === 'motion' && motionStage}
      {project.currentStage === 'export' && exportStage}
    </div>
  );
};
