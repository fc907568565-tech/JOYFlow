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
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

import {
  DEFAULT_MODEL_CONFIG,
  DEFAULT_PAYLOAD,
  TASK_STATUS_TEXT,
  type GeneratePayload,
  type GenerateTask,
  type ModelConfig,
} from '../ai/types';
import { pollTaskUntilDone, submitGenerateTask } from '../ai/client';
import { presetSupportsKind, useModelPresets } from '../ai/presets';
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
  const [scenePromptMode, setScenePromptMode] = useState<'structured' | 'full'>('structured');
  const [scenePromptBlocks, setScenePromptBlocks] = useState<ScenePromptBlock[]>(() =>
    parseScenePromptBlocks(workflowPrompt || '')
  );
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

  const { allPresets, activePresetId, switchPreset, saveAsPreset, deletePreset } =
    useModelPresets(setModelConfig);

  const compatiblePresets = useMemo(
    () => allPresets.filter((preset) => presetSupportsKind(preset, payload.kind)),
    [allPresets, payload.kind]
  );

  const visibleTasks = useMemo(() => {
    if (!workflowProjectId) return tasks;
    const expectedKind = workflowStage === 'dynamic' ? 'video' : 'image';
    return tasks.filter((task) => task.workflowProjectId === workflowProjectId && task.kind === expectedKind);
  }, [tasks, workflowProjectId, workflowStage]);
  const latestTask = visibleTasks[0] ?? null;
  const isSeedanceVideo = payload.kind === 'video' && /seedance/i.test(modelConfig.model);
  const seedanceResolution = payload.resolution || '720p';
  const seedanceRatio = SEEDANCE_RATIOS.includes(payload.ratio as typeof SEEDANCE_RATIOS[number])
    ? payload.ratio as typeof SEEDANCE_RATIOS[number]
    : '16:9';
  const seedancePixelSize = SEEDANCE_PIXEL_SIZES[seedanceResolution][seedanceRatio];
  const workflowReferencesKey = (workflowReferenceImages || []).join('|');

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
    if (!workflowProjectId || workflowStage !== 'scene') return;
    setScenePromptBlocks(parseScenePromptBlocks(workflowPrompt || ''));
    setScenePromptMode('structured');
  }, [workflowProjectId, workflowStage]);

  useEffect(() => {
    if (workflowProjectId && workflowStage === 'scene') {
      if (scenePresetInitializedRef.current !== workflowProjectId) {
        scenePresetInitializedRef.current = workflowProjectId;
        if (activePresetId !== '__doubao_seedream__') switchPreset('__doubao_seedream__');
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

  const onGenerate = async () => {
    const error = validateConfig();
    if (error) { alert(error); return; }

    // 根据模式只传递相关的图片数据，避免混入不相关内容
    let finalRefImages: string[] = [];
    let finalFirstFrame: string | undefined;
    let finalLastFrame: string | undefined;

    if (payload.kind === 'video') {
      if (payload.videoMode === 'image2video') {
        finalFirstFrame = firstFrame || undefined;
      } else if (payload.videoMode === 'keyframes') {
        finalFirstFrame = firstFrame || undefined;
        finalLastFrame = lastFrame || undefined;
      }
      // text2video: 不传任何图片
    } else {
      if (payload.imageMode === 'image2image') {
        finalRefImages = [...refImages];
      }
      // text2image: 不传参考图
    }

    const editablePrompt = payload.prompt.trim();
    const submittedPrompt = workflowPromptTemplate
      ? `${workflowPromptTemplate.prefix}${editablePrompt}${workflowPromptTemplate.suffix}`
      : editablePrompt;
    const finalPayload: GeneratePayload = {
      ...payload,
      prompt: submittedPrompt,
      negativePrompt: undefined,
      referenceImages: finalRefImages,
      firstFrame: finalFirstFrame,
      lastFrame: finalLastFrame,
    };

    console.log('[AI-Generate] start, config:', modelConfig.baseUrl, modelConfig.model);
    console.log('[AI-Generate] payload:', finalPayload);
    setIsGenerating(true);

    // 先创建一个 running 状态的占位任务，让动效立即展示
    const placeholderId = `task_${Date.now()}`;
    const placeholderTask: GenerateTask = {
      id: placeholderId,
      workflowProjectId,
      kind: finalPayload.kind,
      imageMode: finalPayload.imageMode,
      videoMode: finalPayload.videoMode,
      prompt: finalPayload.prompt,
      displayPrompt: workflowPromptTemplate ? editablePrompt : undefined,
      model: modelConfig.model,
      createdAt: Date.now(),
      status: 'running',
      progress: 0,
      resultUrls: [],
    };
    setTasks((prev) => [placeholderTask, ...prev]);

    try {
      const first = await submitGenerateTask(modelConfig, finalPayload);
      // 用真实 taskId 更新占位任务
      const realId = first.taskId || placeholderId;
      setTasks((prev) =>
        updateTask(prev, placeholderId, {
          id: realId,
          status: first.status,
          progress: first.progress,
          resultUrls: first.urls,
          errorMessage: first.errorMessage,
          rawLastResponse: first.raw,
        })
      );

      if ((first.status === 'running' || first.status === 'queued') && first.taskId) {
        const finalResult = await pollTaskUntilDone(modelConfig, first.taskId, (tick) => {
          setTasks((prev) =>
            updateTask(prev, realId, {
              status: tick.status, progress: tick.progress,
              resultUrls: tick.urls, errorMessage: tick.errorMessage, rawLastResponse: tick.raw,
            })
          );
        });
        setTasks((prev) =>
          updateTask(prev, realId, {
            status: finalResult.status, progress: finalResult.progress,
            resultUrls: finalResult.urls, errorMessage: finalResult.errorMessage, rawLastResponse: finalResult.raw,
          })
        );
      }
    } catch (e: any) {
      console.error('[AI-Error] generate failed:', e);
      setTasks((prev) =>
        updateTask(prev, placeholderId, {
          status: 'failed',
          progress: 100,
          errorMessage: e?.message || '请求失败',
        })
      );
    } finally {
      setIsGenerating(false);
    }
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
        tags: [workflowStage === 'dynamic' ? '动态图鉴' : '图鉴场景'],
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

  const commitScenePromptBlocks = (nextBlocks: ScenePromptBlock[]) => {
    const prompt = composeScenePrompt(nextBlocks);
    if (prompt.length > 180) return;
    setScenePromptBlocks(nextBlocks);
    setPayload((current) => ({ ...current, prompt }));
    onWorkflowPromptChange?.(prompt);
  };

  const chooseScenePrompt = (prompt: string) => {
    setPayload((current) => ({ ...current, prompt }));
    setScenePromptBlocks(parseScenePromptBlocks(prompt));
    setScenePromptMode('structured');
    onWorkflowPromptChange?.(prompt);
  };

  const addFreeformSceneBlock = (seed = '') => {
    const existingIndex = scenePromptBlocks.findIndex((block) => block.freeform);
    if (existingIndex >= 0) {
      const current = scenePromptBlocks[existingIndex];
      const text = [cleanSceneClause(current.text), seed].filter(Boolean).join('，');
      commitScenePromptBlocks(scenePromptBlocks.map((block, index) =>
        index === existingIndex ? { ...block, text } : block
      ));
      return;
    }
    commitScenePromptBlocks([
      ...scenePromptBlocks,
      {
        id: `scene-freeform-${Date.now()}`,
        label: '自由想法',
        text: seed,
        freeform: true,
      },
    ]);
  };

  return (
    <div className="flex-1 flex overflow-hidden">
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
              <h2 className="text-2xl font-semibold text-white">{workflowProjectId ? (workflowStage === 'dynamic' ? '动态图鉴' : '场景生成') : payload.kind === 'image' ? '图片生成' : '视频生成'}</h2>
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
              <h3 className="text-base font-semibold text-neutral-200">参考素材</h3>
              <input ref={firstFrameRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e.target.files, 'first')} />
              {firstFrame ? (
                <div className="relative min-h-44 max-h-72 rounded-lg overflow-hidden group bg-black/40 flex items-center justify-center">
                  <img src={firstFrame} alt="首帧参考图" className="max-w-full max-h-72 object-contain" />
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
              <h3 className="text-base font-semibold text-neutral-200">首尾帧素材</h3>
              <input ref={firstFrameRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e.target.files, 'first')} />
              <input ref={lastFrameRef} type="file" accept="image/*" className="hidden" onChange={(e) => handleFileUpload(e.target.files, 'last')} />
              <div className="grid grid-cols-2 gap-3">
                {([['first', '首帧', firstFrame], ['last', '尾帧', lastFrame]] as const).map(([target, label, image]) => (
                  <div key={target} className="space-y-2">
                    <div className="flex items-center justify-between"><span className="text-xs text-neutral-500">{label}</span><button className="text-xs text-cyan-300" onClick={() => setLibraryTarget(target)}>仓库选择</button></div>
                    <div className="aspect-video rounded-lg border border-dashed border-white/15 bg-white/[0.025] flex items-center justify-center overflow-hidden cursor-pointer" onClick={() => (target === 'first' ? firstFrameRef : lastFrameRef).current?.click()}>
                      {image ? <img src={image} alt={label} className="w-full h-full object-contain" /> : <Upload size={22} className="text-neutral-600" />}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-neutral-200">{workflowProjectId && workflowStage === 'scene' ? '场景描述' : '创意描述'}</h3>
                {workflowProjectId && workflowStage === 'scene' && <p className="mt-1 text-xs text-neutral-500">按语义分块修改，也可以随时切换到完整描述。</p>}
              </div>
              {workflowProjectId && workflowStage === 'scene' ? (
                <div className="flex rounded-md border border-white/10 bg-black/30 p-1">
                  <button
                    type="button"
                    className={`h-8 rounded px-3 text-xs ${scenePromptMode === 'structured' ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-neutral-200'}`}
                    onClick={() => {
                      setScenePromptBlocks(parseScenePromptBlocks(payload.prompt));
                      setScenePromptMode('structured');
                    }}
                  >
                    分块编辑
                  </button>
                  <button
                    type="button"
                    className={`h-8 rounded px-3 text-xs ${scenePromptMode === 'full' ? 'bg-white/10 text-white' : 'text-neutral-500 hover:text-neutral-200'}`}
                    onClick={() => setScenePromptMode('full')}
                  >
                    完整描述
                  </button>
                </div>
              ) : (
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
                {workflowPromptOptions?.map((option, index) => (
                  <button
                    key={`${index}-${option}`}
                    type="button"
                    className={`min-h-20 rounded-md border px-3 py-2.5 text-left text-xs leading-5 transition-colors ${payload.prompt === option ? 'border-cyan-400/60 bg-cyan-400/10 text-cyan-100' : 'border-white/10 bg-white/[0.025] text-neutral-400 hover:border-white/20 hover:text-neutral-200'}`}
                    onClick={() => chooseScenePrompt(option)}
                  >
                    <span className="mb-1 block text-[10px] text-neutral-600">方案 {index + 1}</span>
                    {option}
                  </button>
                ))}
              </div>
            )}
            {workflowProjectId && workflowStage === 'scene' && scenePromptMode === 'structured' ? (
              <div className="space-y-3">
                <div className="space-y-2">
                  {scenePromptBlocks.map((block, index) => (
                    <div key={block.id} className={`rounded-lg border p-3 ${block.freeform ? 'border-cyan-400/25 bg-cyan-400/[0.035]' : 'border-white/10 bg-black/35'}`}>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className={`text-[11px] font-medium ${block.freeform ? 'text-cyan-300' : 'text-neutral-500'}`}>{block.label}</span>
                        <button
                          type="button"
                          title={`删除${block.label}`}
                          className="flex h-6 w-6 items-center justify-center rounded text-neutral-600 hover:bg-white/5 hover:text-red-300"
                          onClick={() => commitScenePromptBlocks(scenePromptBlocks.filter((_, blockIndex) => blockIndex !== index))}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                      <textarea
                        rows={block.freeform ? 2 : 1}
                        className="w-full resize-y bg-transparent text-sm leading-6 text-neutral-100 outline-none placeholder:text-neutral-650"
                        placeholder={block.freeform ? '写下任何想突破现有结构的创意…' : `修改${block.label}…`}
                        value={block.text}
                        onChange={(event) => commitScenePromptBlocks(scenePromptBlocks.map((item, blockIndex) =>
                          blockIndex === index ? { ...item, text: event.target.value } : item
                        ))}
                      />
                    </div>
                  ))}
                </div>

                <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.015] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs text-neutral-300">想加入更自由的创意？</p>
                      <p className="mt-1 text-[10px] text-neutral-600">自由想法会原样并入描述，不受上方结构限制。</p>
                    </div>
                    <button
                      type="button"
                      className="inline-flex h-8 items-center gap-1.5 rounded-md border border-white/10 px-3 text-xs text-neutral-300 hover:border-cyan-400/30 hover:text-cyan-200"
                      onClick={() => addFreeformSceneBlock()}
                    >
                      <Plus size={13} /> 添加自由想法
                    </button>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {['雨后湿润感', '清晨薄雾', '黄昏暖光', '更大胆的留白'].map((idea) => (
                      <button
                        key={idea}
                        type="button"
                        className="rounded-full border border-white/8 px-2.5 py-1 text-[10px] text-neutral-500 hover:border-cyan-400/30 hover:text-cyan-200"
                        onClick={() => addFreeformSceneBlock(idea)}
                      >
                        ＋ {idea}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between px-1 text-[10px] text-neutral-600">
                  <span className="inline-flex items-center gap-1.5"><AlignLeft size={11} /> 自动合成为一段完整描述</span>
                  <span>{payload.prompt.length} / 180</span>
                </div>
              </div>
            ) : (
              <div className="relative">
                <textarea className="w-full min-h-52 rounded-lg border border-white/10 bg-black/45 px-5 py-4 pb-10 text-[15px] leading-7 text-neutral-100 resize-y outline-none placeholder:text-neutral-600 focus:border-cyan-400/50" maxLength={workflowProjectId && workflowStage === 'scene' ? 180 : 2500} placeholder={workflowProjectId && workflowStage === 'scene' ? '描述主要建筑、空间关系和光线...' : payload.kind === 'video' ? '描述画面内容、角色动作、镜头运动和氛围...' : '描述想要生成的画面、主体、构图和视觉风格...'} value={payload.prompt} onChange={(e) => {
                  const prompt = e.target.value;
                  setPayload((s) => ({ ...s, prompt }));
                  if (workflowProjectId && workflowStage === 'scene') onWorkflowPromptChange?.(prompt);
                }} />
                <span className="absolute left-4 bottom-3 text-xs text-neutral-600">{payload.prompt.length} / {workflowProjectId && workflowStage === 'scene' ? 180 : 2500}</span>
                <Bot size={15} className="absolute right-4 bottom-3 text-neutral-600" />
              </div>
            )}
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
                  <optgroup label="内置预设">{compatiblePresets.filter((preset) => preset.builtIn).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</optgroup>
                  {compatiblePresets.some((preset) => !preset.builtIn) && <optgroup label="我的预设">{compatiblePresets.filter((preset) => !preset.builtIn).map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</optgroup>}
                </select>
                <div className="flex gap-1">
                  <button className="w-10 h-10 rounded-md border border-white/10 text-neutral-400 hover:text-white flex items-center justify-center" title="保存为预设" onClick={() => { setShowSaveDialog(true); setPresetName(''); }}><Save size={15} /></button>
                  {activePresetId && !allPresets.find((preset) => preset.id === activePresetId)?.builtIn && <button className="w-10 h-10 rounded-md border border-white/10 text-neutral-400 hover:text-red-400 flex items-center justify-center" title="删除预设" onClick={() => { if (confirm('确定删除该预设？')) deletePreset(activePresetId); }}><Trash2 size={15} /></button>}
                </div>
              </div>
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

              {payload.kind === 'video' && (
                <div className="grid grid-cols-[110px_1fr_1fr_1fr] gap-3 items-center">
                  <label className="text-[15px] text-neutral-300">视频规格</label>
                  <select className="h-12 rounded-md border border-white/10 bg-[#141819] px-4 text-[15px] outline-none" value={payload.durationSec || 5} onChange={(e) => setPayload((s) => ({ ...s, durationSec: Number(e.target.value) }))}><option value={3}>约 3 秒</option><option value={5}>约 5 秒</option><option value={7}>约 7 秒</option><option value={10}>约 10 秒</option><option value={13}>约 13 秒</option><option value={18}>约 18 秒</option></select>
                  {isSeedanceVideo ? <select className="h-12 rounded-md border border-white/10 bg-[#141819] px-4 text-[15px] outline-none" value={seedanceResolution} onChange={(e) => { const resolution = e.target.value as '480p' | '720p'; setPayload((current) => ({ ...current, resolution, size: SEEDANCE_PIXEL_SIZES[resolution][seedanceRatio].replace('×', 'x') })); }}><option value="480p">480p</option><option value="720p">720p</option></select> : <select className="h-12 rounded-md border border-white/10 bg-[#141819] px-4 text-[15px] outline-none" value={payload.size} onChange={(e) => setPayload((current) => ({ ...current, size: e.target.value }))}><option value="1280x720">1280×720</option><option value="720x1280">720×1280</option><option value="1024x1024">1024×1024</option></select>}
                  {isSeedanceVideo ? <select className="h-12 rounded-md border border-white/10 bg-[#141819] px-4 text-[15px] outline-none" value={seedanceRatio} onChange={(e) => { const ratio = e.target.value as typeof SEEDANCE_RATIOS[number]; setPayload((current) => ({ ...current, ratio, size: SEEDANCE_PIXEL_SIZES[seedanceResolution][ratio].replace('×', 'x') })); }}>{SEEDANCE_RATIOS.map((ratio) => <option key={ratio} value={ratio}>{ratio}</option>)}</select> : <span className="h-12 rounded-md border border-white/8 bg-black/20 px-4 text-[15px] text-neutral-500 flex items-center">自动比例</span>}
                </div>
              )}
              {isSeedanceVideo && <div className="flex justify-end text-xs text-neutral-500">实际像素 <span className="ml-2 font-mono text-cyan-300">{seedancePixelSize}</span></div>}

              <button className="w-full h-12 border-t border-white/8 pt-3 flex items-center justify-between text-[15px] text-neutral-400 hover:text-white" onClick={() => setConfigExpanded((value) => !value)}><span className="flex items-center gap-2"><LinkIcon size={16} />接口配置</span>{configExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</button>
              <AnimatePresence>
                {configExpanded && <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden"><div className="grid grid-cols-2 gap-2 pt-1"><input className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-xs outline-none" placeholder="Base URL" value={modelConfig.baseUrl} onChange={(e) => setModelConfig((s) => ({ ...s, baseUrl: e.target.value }))} /><input className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-xs outline-none" placeholder="API Key" type="password" value={modelConfig.apiKey} onChange={(e) => setModelConfig((s) => ({ ...s, apiKey: e.target.value }))} /><input className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-xs outline-none" placeholder="模型名称" value={modelConfig.model} onChange={(e) => setModelConfig((s) => ({ ...s, model: e.target.value }))} /><input className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-xs outline-none" placeholder="图片接口路径" value={modelConfig.imageGeneratePath} onChange={(e) => setModelConfig((s) => ({ ...s, imageGeneratePath: e.target.value }))} /><input className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-xs outline-none" placeholder="视频接口路径" value={modelConfig.videoGeneratePath} onChange={(e) => setModelConfig((s) => ({ ...s, videoGeneratePath: e.target.value }))} /><input className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-xs outline-none" placeholder="任务查询路径" value={modelConfig.taskStatusPath} onChange={(e) => setModelConfig((s) => ({ ...s, taskStatusPath: e.target.value }))} /><input className="h-10 rounded-md border border-white/10 bg-black/30 px-3 text-xs outline-none col-span-2" placeholder="imgbb API Key（图生视频可选）" type="password" value={modelConfig.imgbbApiKey || ''} onChange={(e) => setModelConfig((s) => ({ ...s, imgbbApiKey: e.target.value }))} /></div></motion.div>}
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
              {TASK_STATUS_TEXT[latestTask.status]} {latestTask.progress > 0 && latestTask.progress < 100 ? `${latestTask.progress}%` : ''}
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
              {visibleTasks.map((task) => (
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
                          <div className="w-40 h-1.5 bg-neutral-800/80 rounded-full overflow-hidden">
                            <motion.div
                              className="h-full bg-gradient-to-r from-[var(--primary)] to-purple-400 rounded-full"
                              initial={{ width: 0 }}
                              animate={{ width: `${task.progress}%` }}
                              transition={{ duration: 0.3 }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* 素材展示 - 大尺寸完整展示 */}
                  {task.resultUrls.length > 0 && (
                    <div className="space-y-3">
                      {task.resultUrls.map((url, idx) => (
                        <div key={idx} className="relative group rounded-xl overflow-hidden bg-neutral-900">
                          {/* 模糊背景层*/}
                          <div className="absolute inset-0">
                            {isVideoUrl(url) ? (
                              <div className="w-full h-full bg-neutral-900" />
                            ) : (
                              <img src={url} alt="" className="w-full h-full object-cover blur-2xl opacity-30 scale-110" />
                            )}
                          </div>
                          {/* 实际内容 */}
                          <div className="relative flex items-center justify-center min-h-[320px] max-h-[560px]">
                            {isVideoUrl(url) ? (
                              <video src={url} controls className="max-w-full max-h-[560px] rounded-lg" />
                            ) : (
                              <img src={url} alt="result" className="max-w-full max-h-[560px] object-contain rounded-lg" />
                            )}
                          </div>
                          {workflowProjectId && task.workflowProjectId === workflowProjectId && task.kind === (workflowStage === 'dynamic' ? 'video' : 'image') && (
                            <button
                              className="absolute bottom-3 left-1/2 -translate-x-1/2 h-10 px-5 rounded-md bg-white text-black text-sm font-semibold shadow-xl hover:bg-neutral-200 disabled:opacity-60 flex items-center gap-2"
                              disabled={Boolean(selectingResult)}
                              onClick={() => void selectWorkflowResult(url, task)}
                            >
                              <CheckCircle2 size={15} /> {selectingResult === url ? '正在传递...' : workflowStage === 'dynamic' ? '选用此视频并继续' : '选用此场景'}
                            </button>
                          )}
                          {/* 悬浮操作按钮 */}
                          <div className="absolute top-3 right-3 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              className="bg-black/60 backdrop-blur-sm rounded-full p-2 hover:bg-black/80 transition-colors"
                              title="存入素材仓库"
                              onClick={() => saveToLibrary(url, task.kind, task.prompt)}
                            >
                              <Package size={14} className="text-white" />
                            </button>
                            <a href={url} target="_blank" rel="noreferrer" className="bg-black/60 backdrop-blur-sm rounded-full p-2 hover:bg-black/80 transition-colors">
                              <Download size={14} className="text-white" />
                            </a>
                          </div>
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
              ))}
            </div>
          )}
        </div>
      </div>
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
