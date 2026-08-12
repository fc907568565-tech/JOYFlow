import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Gift,
  History,
  Image as ImageIcon,
  KeyRound,
  LoaderCircle,
  Package,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from 'lucide-react';
import { pollTaskUntilDone, submitGenerateTask } from '../ai/client';
import { isCoreImagePreset, presetSupportsKind, rememberModelSecrets, useModelPresets, withRememberedModelSecrets } from '../ai/presets';
import { DEFAULT_MODEL_CONFIG, type ModelConfig } from '../ai/types';
import { addToLibrary, loadLibrary, type LibraryAsset } from '../utils/assetLibrary';
import { SpecialtyCutoutWorkspace } from './SpecialtyCutoutWorkspace';
import { SpecialtyAnimationWorkspace } from './SpecialtyAnimationWorkspace';
import { SceneRegionEditor, type SceneEditRegion } from './SceneRegionEditor';
import {
  createSpecialtyProject,
  deleteSpecialtyProject,
  loadActiveSpecialtyProject,
  loadSpecialtyProjectHistory,
  saveSpecialtyProject,
  type SpecialtyItem,
  type SpecialtyProject,
} from '../utils/specialtyWorkflow';

const STYLE_REFERENCE_URLS = [
  `${import.meta.env.BASE_URL}specialty-style/style-icons.png`,
  `${import.meta.env.BASE_URL}specialty-style/style-scene.png`,
];

const SPECIALTY_MODEL_CONFIG_STORAGE_KEY = 'joyflow_specialty_model_configs_v1';

const loadSpecialtyModelConfigs = (): Record<string, ModelConfig> => {
  try {
    const raw = localStorage.getItem(SPECIALTY_MODEL_CONFIG_STORAGE_KEY);
    return raw ? JSON.parse(raw) as Record<string, ModelConfig> : {};
  } catch {
    return {};
  }
};

const saveSpecialtyModelConfigs = (configs: Record<string, ModelConfig>) => {
  try {
    localStorage.setItem(SPECIALTY_MODEL_CONFIG_STORAGE_KEY, JSON.stringify(configs));
  } catch {
    // Privacy-restricted browsers may block storage; the current session still works.
  }
};

const fileToDataUrl = (file: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const materializeReferenceImage = async (source: string): Promise<string> => {
  if (/^data:image\//i.test(source)) return source;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`参考图读取失败 (HTTP ${response.status})`);
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('添加的参考文件不是有效图片');
  return fileToDataUrl(blob);
};

const buildSpecialtyPrompt = (name: string, hasObjectReference: boolean, hasStyleAnchor = false) => `
生成一个独立的中国地方特产游戏道具图标，物品名称为【${name}】。
3D卡通休闲游戏图标，3D哑光质感，卡通渲染，边缘柔和且没有尖锐棱角，统一等距视角，色彩明快高级，高饱和度，造型有张力，Q萌、可爱、精致、圆润、拟物质感，中式国风物件。
图1与图2只用于参考整体3D游戏道具风格、材质、色彩与造型语言，不复制其中的具体物品、文字、界面和场景。${hasStyleAnchor ? '图3是本次任务生成的整组风格基准，必须沿用其中统一的镜头高度、透视、材质粗糙度、色彩浓度、主光方向、阴影软硬和主体视觉尺寸。' : ''}${hasObjectReference ? `图${hasStyleAnchor ? '4' : '3'}只用于确认该特产的真实外形、结构和关键识别特征，不参考摄影背景与画面风格。` : ''}
画面中只出现一个完整的【${name}】，主体视觉边界占画布宽高约68%至74%，主体底部落在画面高度82%左右，视觉尺寸必须与同组其他道具一致。统一采用轻微俯视的等距三分之四视角、相同焦段、左上方柔和主光与克制的浅灰接触阴影。主体居中，不切边，不添加其他道具，不出现人物、文字、Logo、边框、卡片或装饰图案。纯白色背景，正方形构图，方便后续抠图制作透明素材。
`.trim();

const buildStyleAnchorPrompt = (names: string[]) => {
  const visibleNames = names.slice(0, 12);
  const columns = visibleNames.length <= 4 ? 2 : visibleNames.length <= 9 ? 3 : 4;
  return `
为同一套中国地方特产游戏道具建立一张整组风格基准图，包含：${visibleNames.map((name) => `【${name}】`).join('、')}。
严格使用${columns}列等宽网格，每个格子只放一个完整道具，不出现文字、编号、边框或界面。所有道具必须采用完全一致的3D卡通拟物风格、轻微俯视等距三分之四视角、相同焦段、材质粗糙度、轮廓圆润程度、色彩浓度、左上方柔和主光和浅灰接触阴影。
每个道具在各自格子中占据相同视觉比例，边界约占格子宽高70%，基线对齐，不能有明显大小差异。纯白背景，元素互不重叠、不切边。图1与图2只用于统一参考风格语言，不复制其具体内容。
这张图仅作为后续单体生成的统一风格基准，优先保证整组的一致性、可辨识度与规范感。
`.trim();
};

const newItem = (name: string): SpecialtyItem => ({
  id: `specialty_item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  name,
  candidateAssetIds: [],
  status: 'idle',
});

interface SpecialtyWorkspaceProps {
  onOpenVideoExport: (asset: LibraryAsset) => void;
}

export const SpecialtyWorkspace: React.FC<SpecialtyWorkspaceProps> = ({ onOpenVideoExport }) => {
  const [project, setProject] = useState<SpecialtyProject>(() => (
    loadActiveSpecialtyProject() || createSpecialtyProject()
  ));
  const [modelConfig, setModelConfig] = useState<ModelConfig>(DEFAULT_MODEL_CONFIG);
  const [savedModelConfigs, setSavedModelConfigs] = useState<Record<string, ModelConfig>>(loadSpecialtyModelConfigs);
  const [configExpanded, setConfigExpanded] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [assetMap, setAssetMap] = useState<Map<string, LibraryAsset>>(new Map());
  const [generating, setGenerating] = useState(false);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<SpecialtyProject[]>(() => loadSpecialtyProjectHistory());
  const [generationPhase, setGenerationPhase] = useState('');
  const [adjustTarget, setAdjustTarget] = useState<{ itemId: string; asset: LibraryAsset } | null>(null);
  const [adjustMode, setAdjustMode] = useState<'region' | 'global'>('region');
  const [adjustPrompt, setAdjustPrompt] = useState('');
  const [adjustMask, setAdjustMask] = useState('');
  const [adjustRegion, setAdjustRegion] = useState<SceneEditRegion | null>(null);
  const [adjusting, setAdjusting] = useState(false);
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const styleDataRef = useRef<string[] | null>(null);
  const { allPresets, activePresetId, switchPreset } = useModelPresets(setModelConfig);

  const imagePresets = useMemo(
    () => allPresets.filter((preset) => presetSupportsKind(preset, 'image') && isCoreImagePreset(preset)),
    [allPresets]
  );
  const selectedModelPreset = imagePresets.find((preset) => preset.id === project.modelPresetId)
    || imagePresets.find((preset) => preset.id === activePresetId);

  const finishedCount = project.items.filter((item) => item.status === 'succeeded').length;
  const selectedCount = project.items.filter((item) => item.selectedAssetId).length;
  const allSelected = project.items.length > 0 && selectedCount === project.items.length;
  const useStyleAnchor = project.useStyleAnchor !== false;
  const styleAnchorAsset = project.styleAnchorAssetId ? assetMap.get(project.styleAnchorAssetId) : undefined;

  useEffect(() => {
    let cancelled = false;
    void loadLibrary().then((assets) => {
      if (!cancelled) setAssetMap(new Map(assets.map((asset) => [asset.id, asset])));
    });
    return () => { cancelled = true; };
  }, [project.id]);

  useEffect(() => {
    const desired = imagePresets.find((preset) => preset.id === project.modelPresetId)
      || imagePresets.find((preset) => preset.id === '__doubao_seedream_45__')
      || imagePresets[0];
    if (!desired) return;
    if (activePresetId !== desired.id) switchPreset(desired.id);
    setModelConfig(savedModelConfigs[desired.id] || withRememberedModelSecrets(desired.config));
  }, [activePresetId, imagePresets, project.id, project.modelPresetId, savedModelConfigs, switchPreset]);

  useEffect(() => {
    saveSpecialtyModelConfigs(savedModelConfigs);
  }, [savedModelConfigs]);

  const updateModelConfig = (patch: Partial<ModelConfig>) => {
    const next = { ...modelConfig, ...patch };
    setModelConfig(next);
    if ('apiKey' in patch || 'imgbbApiKey' in patch) rememberModelSecrets(next);
    setSavedModelConfigs((current) => ({ ...current, [project.modelPresetId]: next }));
  };

  const selectModelPreset = (presetId: string) => {
    const preset = imagePresets.find((item) => item.id === presetId);
    if (!preset) return;
    switchPreset(presetId);
    setModelConfig(savedModelConfigs[presetId] || withRememberedModelSecrets(preset.config));
    updateProject((current) => ({ ...current, modelPresetId: presetId }));
  };

  const updateProject = (updater: (current: SpecialtyProject) => SpecialtyProject) => {
    setProject((current) => {
      const next = saveSpecialtyProject(updater(current));
      setHistory(loadSpecialtyProjectHistory());
      return next;
    });
  };

  const updateItem = (itemId: string, updater: (item: SpecialtyItem) => SpecialtyItem) => {
    updateProject((current) => ({
      ...current,
      items: current.items.map((item) => item.id === itemId ? updater(item) : item),
    }));
  };

  const addNames = () => {
    const incoming = nameInput
      .split(/[，,、;；\n]+/)
      .map((name) => name.trim())
      .filter(Boolean);
    if (!incoming.length) return;
    updateProject((current) => {
      const existing = new Set(current.items.map((item) => item.name.toLowerCase()));
      const additions = incoming
        .filter((name) => !existing.has(name.toLowerCase()))
        .map((name) => {
          existing.add(name.toLowerCase());
          return newItem(name);
        });
      return { ...current, items: [...current.items, ...additions] };
    });
    setNameInput('');
  };

  const chooseReference = async (files: FileList | null) => {
    const file = files?.[0];
    const itemId = uploadTargetId;
    if (!file || !itemId) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      const item = project.items.find((entry) => entry.id === itemId);
      if (!item) return;
      const asset = await addToLibrary({
        url: dataUrl,
        type: 'image',
        name: `${item.name} 结构参考`,
        prompt: `${item.name} 特产外形结构参考`,
        thumbnail: dataUrl,
        projectId: project.id,
        workflowId: project.id,
        stage: 'specialty-reference',
        selected: true,
        status: 'reference',
        tags: ['特产道具', '结构参考'],
      });
      setAssetMap((current) => new Map(current).set(asset.id, asset));
      updateItem(itemId, (current) => ({ ...current, referenceAssetId: asset.id }));
    } catch {
      alert('参考图读取失败，请重新选择');
    } finally {
      setUploadTargetId(null);
      if (referenceInputRef.current) referenceInputRef.current.value = '';
    }
  };

  const loadStyleReferences = async () => {
    if (styleDataRef.current) return styleDataRef.current;
    const data = await Promise.all(STYLE_REFERENCE_URLS.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('固定风格参考图读取失败');
      return fileToDataUrl(await response.blob());
    }));
    styleDataRef.current = data;
    return data;
  };

  const generateStyleAnchor = async (
    config: ModelConfig,
    styleReferences: string[],
  ): Promise<LibraryAsset> => {
    const prompt = buildStyleAnchorPrompt(project.items.map((item) => item.name));
    const first = await submitGenerateTask(config, {
      kind: 'image',
      imageMode: 'image2image',
      prompt,
      size: '2K',
      ratio: '1:1',
      numImages: 1,
      referenceImages: styleReferences,
    });
    const result = first.taskId && first.status !== 'succeeded' && config.taskStatusPath
      ? await pollTaskUntilDone(config, first.taskId)
      : first;
    if (result.status === 'failed' || result.urls.length === 0) {
      throw new Error(result.errorMessage || '整组风格基准生成失败');
    }
    const asset = await addToLibrary({
      url: result.urls[0],
      type: 'image',
      name: `${project.name} · 整组风格基准`,
      prompt,
      thumbnail: result.urls[0],
      projectId: project.id,
      workflowId: project.id,
      stage: 'specialty-style-anchor',
      model: config.model,
      generationParams: { size: '2K', ratio: '1:1', itemNames: project.items.map((item) => item.name) },
      selected: true,
      status: 'reference',
      tags: ['特产道具', '整组风格基准', '一致性参考'],
    });
    setAssetMap((current) => new Map(current).set(asset.id, asset));
    updateProject((current) => ({
      ...current,
      styleAnchorAssetId: asset.id,
      styleAnchorSignature: current.items.map((item) => item.name.trim()).join('|'),
    }));
    return asset;
  };

  const generateItem = async (
    item: SpecialtyItem,
    config: ModelConfig,
    styleReferences: string[],
    candidateCount: number,
    styleAnchor?: LibraryAsset,
  ) => {
    updateItem(item.id, (current) => ({
      ...current,
      status: 'running',
      errorMessage: undefined,
      candidateAssetIds: [],
      selectedAssetId: undefined,
      outputAssetId: undefined,
      cutoutSettings: undefined,
      animationVideoAssetId: undefined,
      animationPrompt: undefined,
      animationSourceAssetId: undefined,
    }));
    try {
      const objectReferenceUrl = item.referenceAssetId ? assetMap.get(item.referenceAssetId)?.url : undefined;
      const objectReference = objectReferenceUrl
        ? await materializeReferenceImage(objectReferenceUrl)
        : undefined;
      const styleAnchorReference = styleAnchor?.url
        ? await materializeReferenceImage(styleAnchor.url)
        : undefined;
      const referenceImages = [
        ...styleReferences,
        ...(styleAnchorReference ? [styleAnchorReference] : []),
        ...(objectReference ? [objectReference] : []),
      ];
      const candidateAssetIds: string[] = [];
      const addedAssets: LibraryAsset[] = [];
      for (let index = 0; index < candidateCount; index += 1) {
        const first = await submitGenerateTask(config, {
          kind: 'image',
          imageMode: 'image2image',
          prompt: buildSpecialtyPrompt(item.name, Boolean(objectReference), Boolean(styleAnchorReference)),
          size: '2K',
          ratio: '1:1',
          numImages: 1,
          referenceImages,
        });
        const result = first.taskId && first.status !== 'succeeded' && config.taskStatusPath
          ? await pollTaskUntilDone(config, first.taskId)
          : first;
        if (result.status === 'failed' || result.urls.length === 0) {
          throw new Error(result.errorMessage || '模型未返回图片');
        }
        for (const url of result.urls.slice(0, 1)) {
          const asset = await addToLibrary({
            url,
            type: 'image',
            name: `${item.name} 候选 ${candidateAssetIds.length + 1}`,
            prompt: buildSpecialtyPrompt(item.name, Boolean(objectReference), Boolean(styleAnchorReference)),
            thumbnail: url,
            projectId: project.id,
            workflowId: project.id,
            stage: 'specialty-candidate',
            parentAssetId: item.referenceAssetId,
            model: config.model,
            generationParams: { size: '2K', ratio: '1:1', itemName: item.name, styleAnchorAssetId: styleAnchor?.id },
            selected: false,
            status: 'candidate',
            tags: ['特产道具', item.name, '待抠图'],
          });
          candidateAssetIds.push(asset.id);
          addedAssets.push(asset);
        }
      }
      setAssetMap((current) => {
        const next = new Map(current);
        addedAssets.forEach((asset) => next.set(asset.id, asset));
        return next;
      });
      updateItem(item.id, (current) => ({
        ...current,
        status: 'succeeded',
        candidateAssetIds,
        selectedAssetId: candidateAssetIds.length === 1 ? candidateAssetIds[0] : undefined,
        outputAssetId: undefined,
        cutoutSettings: undefined,
        animationVideoAssetId: undefined,
        animationPrompt: undefined,
        animationSourceAssetId: undefined,
      }));
    } catch (error: any) {
      updateItem(item.id, (current) => ({
        ...current,
        status: 'failed',
        errorMessage: error?.message || '生成失败',
      }));
    }
  };

  const generateAll = async (onlyItem?: SpecialtyItem) => {
    const queue = onlyItem ? [onlyItem] : project.items;
    if (!queue.length || generating) return;
    const config = modelConfig;
    if (!config.baseUrl.trim() || !config.model.trim() || !config.imageGeneratePath.trim()) {
      setConfigExpanded(true);
      alert('请先完整填写模型接口配置');
      return;
    }
    if ((/seedream/i.test(config.model) || /ark-api|volces\.com/i.test(config.baseUrl)) && !config.apiKey.trim()) {
      setConfigExpanded(true);
      alert('请先在接口配置中填写自己的 API Key');
      return;
    }
    setGenerating(true);
    setGenerationPhase('正在准备固定风格参考');
    try {
      const styleReferences = await loadStyleReferences();
      const currentSignature = project.items.map((item) => item.name.trim()).join('|');
      let activeStyleAnchor = useStyleAnchor && project.styleAnchorSignature === currentSignature
        ? styleAnchorAsset
        : undefined;
      const needsNewAnchor = useStyleAnchor
        && !onlyItem
        && project.items.length > 1
        && (!activeStyleAnchor || project.styleAnchorSignature !== currentSignature);
      if (needsNewAnchor) {
        setGenerationPhase('正在建立整组风格基准');
        activeStyleAnchor = await generateStyleAnchor(config, styleReferences);
      }
      setGenerationPhase(onlyItem ? `正在生成 ${onlyItem.name}` : '正在生成统一规格的单体道具');
      let cursor = 0;
      const worker = async () => {
        while (cursor < queue.length) {
          const item = queue[cursor];
          cursor += 1;
          await generateItem(item, config, styleReferences, project.candidateCount, activeStyleAnchor);
        }
      };
      await Promise.all(Array.from({ length: Math.min(2, queue.length) }, () => worker()));
    } catch (error: any) {
      alert(error?.message || '批量生成失败');
    } finally {
      setGenerating(false);
      setGenerationPhase('');
    }
  };

  const closeAdjustment = () => {
    if (adjusting) return;
    setAdjustTarget(null);
    setAdjustPrompt('');
    setAdjustMask('');
    setAdjustRegion(null);
    setAdjustMode('region');
  };

  const openAdjustment = (itemId: string, asset: LibraryAsset) => {
    setAdjustTarget({ itemId, asset });
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
    return `道具${vertical}${horizontal}的标记区域`;
  };

  const submitSpecialtyAdjustment = async () => {
    const isRegion = adjustMode === 'region';
    if (!adjustTarget || !adjustPrompt.trim() || adjusting || (isRegion && (!adjustMask || !adjustRegion))) return;
    const item = project.items.find((entry) => entry.id === adjustTarget.itemId);
    if (!item) return;
    if (!modelConfig.baseUrl.trim() || !modelConfig.model.trim() || !modelConfig.imageGeneratePath.trim()) {
      alert('请先完整填写当前模型的接口配置');
      return;
    }
    setAdjusting(true);
    try {
      const instruction = adjustPrompt.trim();
      const prompt = isRegion
        ? `仅修改${describeEditRegion(adjustRegion!)}：${instruction}。严格保持标记区域之外的道具造型、材质、颜色、光照、阴影、主体尺寸、居中位置和纯白背景不变；修改边缘必须自然并与原图风格完全一致。`
        : `以当前【${item.name}】道具图为基础进行整体调整：${instruction}。必须保持这是同一个道具，延续原有3D卡通拟物风格、等距视角、主体尺寸、居中位置、左上方柔和主光和纯白背景，不添加文字、边框或其他物品。`;
      const anchorReference = useStyleAnchor && styleAnchorAsset?.url
        ? [await materializeReferenceImage(styleAnchorAsset.url)]
        : [];
      const first = await submitGenerateTask(modelConfig, {
        kind: 'image',
        imageMode: 'image2image',
        prompt,
        size: '2K',
        ratio: '1:1',
        numImages: 1,
        referenceImages: [adjustTarget.asset.url, ...anchorReference],
        editMask: isRegion ? adjustMask : undefined,
      });
      const result = first.taskId && first.status !== 'succeeded' && modelConfig.taskStatusPath
        ? await pollTaskUntilDone(modelConfig, first.taskId)
        : first;
      if (result.status === 'failed' || !result.urls.length) throw new Error(result.errorMessage || '模型未返回调整图片');
      const asset = await addToLibrary({
        url: result.urls[0],
        type: 'image',
        name: `${item.name} ${isRegion ? '局部' : '整体'}调整`,
        prompt,
        thumbnail: result.urls[0],
        projectId: project.id,
        workflowId: project.id,
        stage: 'specialty-adjustment',
        parentAssetId: adjustTarget.asset.id,
        model: modelConfig.model,
        generationParams: { mode: adjustMode, instruction, styleAnchorAssetId: styleAnchorAsset?.id },
        selected: true,
        status: 'candidate',
        tags: ['特产道具', item.name, isRegion ? '局部调整' : '整体调整', '待抠图'],
      });
      setAssetMap((current) => new Map(current).set(asset.id, asset));
      updateItem(item.id, (current) => ({
        ...current,
        status: 'succeeded',
        candidateAssetIds: [...current.candidateAssetIds, asset.id],
        selectedAssetId: asset.id,
        outputAssetId: undefined,
        cutoutSettings: undefined,
        animationVideoAssetId: undefined,
        animationPrompt: undefined,
        animationSourceAssetId: undefined,
      }));
      setAdjustTarget(null);
      setAdjustPrompt('');
      setAdjustMask('');
      setAdjustRegion(null);
      setAdjustMode('region');
    } catch (error: any) {
      alert(error?.message || '道具调整失败');
    } finally {
      setAdjusting(false);
    }
  };

  const startNewProject = () => {
    if (project.items.length && !confirm('新建任务会保留当前任务到历史记录，是否继续？')) return;
    const next = createSpecialtyProject();
    setProject(next);
    setNameInput('');
    setHistory(loadSpecialtyProjectHistory());
  };

  const resumeProject = (saved: SpecialtyProject) => {
    const next = saveSpecialtyProject(saved);
    setProject(next);
    setHistoryOpen(false);
  };

  const removeHistoryProject = (saved: SpecialtyProject) => {
    if (!confirm(`确定删除任务“${saved.name}”吗？\n素材仓库中的图片会保留。`)) return;
    const deletedActive = deleteSpecialtyProject(saved.id);
    if (deletedActive) setProject(createSpecialtyProject());
    setHistory(loadSpecialtyProjectHistory());
  };

  if ((project.stage || 'generate') === 'cutout') {
    return (
      <SpecialtyCutoutWorkspace
        project={project}
        onProjectChange={(next) => {
          const saved = saveSpecialtyProject(next);
          setProject(saved);
          setHistory(loadSpecialtyProjectHistory());
        }}
        onBack={() => updateProject((current) => ({ ...current, stage: 'generate' }))}
        onAnimate={(preparedProject) => {
          const saved = saveSpecialtyProject({ ...preparedProject, stage: 'animate' });
          setProject(saved);
          setHistory(loadSpecialtyProjectHistory());
        }}
      />
    );
  }

  if (project.stage === 'animate') {
    return (
      <SpecialtyAnimationWorkspace
        project={project}
        onProjectChange={(next) => {
          const saved = saveSpecialtyProject(next);
          setProject(saved);
          setHistory(loadSpecialtyProjectHistory());
        }}
        onBack={() => updateProject((current) => ({ ...current, stage: 'cutout' }))}
        onOpenVideoExport={onOpenVideoExport}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 bg-[#090b0c] text-white">
      <input
        ref={referenceInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void chooseReference(event.target.files)}
      />

      <aside className="flex w-[390px] shrink-0 flex-col border-r border-white/8 bg-[#0d1010]">
        <div className="border-b border-white/8 px-6 py-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase text-emerald-300">Specialty Props</p>
              <h2 className="mt-1 text-xl font-semibold">特产道具生产</h2>
            </div>
            <div className="flex gap-2">
              <button className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-neutral-400 hover:text-white" title="历史任务" onClick={() => { setHistory(loadSpecialtyProjectHistory()); setHistoryOpen(true); }}><History size={15} /></button>
              <button className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-neutral-400 hover:text-white" title="新建任务" onClick={startNewProject}><Plus size={16} /></button>
            </div>
          </div>
          <input
            className="mt-4 h-10 w-full border-b border-white/10 bg-transparent text-sm text-neutral-200 outline-none focus:border-emerald-400/60"
            value={project.name}
            onChange={(event) => updateProject((current) => ({ ...current, name: event.target.value }))}
          />
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-neutral-200">生成模型</label>
              <span className="text-[11px] text-neutral-600">仅显示图片模型</span>
            </div>
            <select
              className="h-11 w-full rounded-md border border-white/10 bg-[#15191a] px-3 text-sm outline-none focus:border-emerald-400/50"
              value={project.modelPresetId}
              onChange={(event) => selectModelPreset(event.target.value)}
            >
              {imagePresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}{preset.recommended ? ' · 推荐' : ''}</option>)}
            </select>
            {selectedModelPreset?.styleDescription && (
              <div className="mt-2 rounded-md border border-emerald-400/15 bg-emerald-400/[0.045] px-3 py-2.5">
                <div className="flex items-center gap-2">
                  {selectedModelPreset.recommended && <span className="rounded bg-emerald-300 px-1.5 py-0.5 text-[10px] font-semibold text-[#07110d]">推荐</span>}
                  <span className="text-xs font-medium text-emerald-100">{selectedModelPreset.name}</span>
                </div>
                <p className="mt-1 text-xs leading-5 text-neutral-400">{selectedModelPreset.styleDescription}</p>
              </div>
            )}
            <div className="mt-3 overflow-hidden rounded-md border border-white/10 bg-[#111516]">
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-3 text-left hover:bg-white/[0.025]"
                onClick={() => setConfigExpanded((current) => !current)}
                aria-expanded={configExpanded}
              >
                <KeyRound size={15} className="text-emerald-300" />
                <span className="text-sm font-medium text-neutral-200">接口配置</span>
                <span className={`ml-auto rounded-full px-2 py-1 text-[10px] ${modelConfig.apiKey.trim() ? 'bg-emerald-400/10 text-emerald-300' : 'bg-amber-400/10 text-amber-300'}`}>
                  {modelConfig.apiKey.trim() ? 'API Key 已填写' : '需要填写 API Key'}
                </span>
                <ChevronDown size={14} className={`text-neutral-500 transition-transform ${configExpanded ? 'rotate-180' : ''}`} />
              </button>

              {configExpanded && (
                <div className="space-y-3 border-t border-white/8 px-3 py-4">
                  <label className="block">
                    <span className="mb-1.5 block text-xs text-neutral-500">API Key</span>
                    <input
                      type="password"
                      autoComplete="off"
                      className="h-10 w-full rounded-md border border-white/10 bg-black/30 px-3 text-xs text-neutral-200 outline-none placeholder:text-neutral-700 focus:border-emerald-400/50"
                      value={modelConfig.apiKey}
                      onChange={(event) => updateModelConfig({ apiKey: event.target.value })}
                      placeholder="填写你自己的 API Key"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1.5 block text-xs text-neutral-500">Base URL</span>
                      <input
                        className="h-10 w-full rounded-md border border-white/10 bg-black/30 px-3 text-xs text-neutral-200 outline-none focus:border-emerald-400/50"
                        value={modelConfig.baseUrl}
                        onChange={(event) => updateModelConfig({ baseUrl: event.target.value })}
                        placeholder="/ark-api"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-xs text-neutral-500">模型名称</span>
                      <input
                        className="h-10 w-full rounded-md border border-white/10 bg-black/30 px-3 text-xs text-neutral-200 outline-none focus:border-emerald-400/50"
                        value={modelConfig.model}
                        onChange={(event) => updateModelConfig({ model: event.target.value })}
                        placeholder="模型 ID"
                      />
                    </label>
                  </div>

                  <label className="block">
                    <span className="mb-1.5 block text-xs text-neutral-500">图片生成接口路径</span>
                    <input
                      className="h-10 w-full rounded-md border border-white/10 bg-black/30 px-3 text-xs text-neutral-200 outline-none focus:border-emerald-400/50"
                      value={modelConfig.imageGeneratePath}
                      onChange={(event) => updateModelConfig({ imageGeneratePath: event.target.value })}
                      placeholder="/api/v3/images/generations"
                    />
                  </label>

                  <p className="text-[11px] leading-5 text-neutral-600">
                    配置会按当前模型保存在这个浏览器中，不会写入项目代码，也不会与其他使用者共享。
                  </p>
                </div>
              )}
            </div>
            <p className="mt-2 text-[11px] leading-5 text-neutral-600">切换模型不会清空道具清单与已有结果。</p>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <label className="text-sm font-medium text-neutral-200">固定风格参考</label>
              <span className="text-[11px] text-emerald-300">已自动应用 2 张</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {STYLE_REFERENCE_URLS.map((url, index) => (
                <div key={url} className="relative aspect-[4/3] overflow-hidden rounded-md border border-white/10 bg-black">
                  <img src={url} alt={`固定风格参考 ${index + 1}`} className="h-full w-full object-cover" />
                  <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-2 py-1 text-[10px]">风格 {index + 1}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-md border border-emerald-400/15 bg-emerald-400/[0.035] p-4">
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="checkbox"
                checked={useStyleAnchor}
                className="mt-0.5 h-4 w-4 accent-emerald-400"
                onChange={(event) => updateProject((current) => ({ ...current, useStyleAnchor: event.target.checked }))}
              />
              <span>
                <span className="block text-sm font-medium text-emerald-100">整组风格基准</span>
                <span className="mt-1 block text-[11px] leading-5 text-neutral-500">批量生成前先制作一张全组概念图，再作为每个单体的共同参考。会多消耗 1 次生图，但能明显统一尺寸、机位、材质和光影。</span>
              </span>
            </label>
            {styleAnchorAsset && (
              <div className="mt-3 flex items-center gap-3 rounded-md border border-white/8 bg-black/25 p-2">
                <img src={styleAnchorAsset.thumbnail || styleAnchorAsset.url} alt="整组风格基准" className="h-16 w-16 rounded bg-white object-contain" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-neutral-300">当前任务已建立风格基准</p>
                  <p className="mt-1 text-[10px] text-neutral-600">清单不变时会自动复用</p>
                </div>
                <button disabled={generating} className="rounded border border-white/10 px-2 py-1.5 text-[10px] text-neutral-500 hover:text-white disabled:opacity-40" onClick={() => updateProject((current) => ({ ...current, styleAnchorAssetId: undefined, styleAnchorSignature: undefined }))}>下次重建</button>
              </div>
            )}
          </section>

          <section>
            <label className="mb-2 block text-sm font-medium text-neutral-200">特产道具名称</label>
            <div className="flex gap-2">
              <input
                className="h-11 min-w-0 flex-1 rounded-md border border-white/10 bg-[#15191a] px-3 text-sm outline-none focus:border-emerald-400/50"
                value={nameInput}
                placeholder="输入一个或多个名称"
                onChange={(event) => setNameInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); addNames(); }
                }}
              />
              <button className="flex h-11 w-11 items-center justify-center rounded-md bg-white text-black hover:bg-neutral-200" title="添加道具" onClick={addNames}><Plus size={17} /></button>
            </div>
            <p className="mt-2 text-xs leading-5 text-neutral-600">支持逗号、顿号或换行批量添加。完整关键词模板由系统自动拼接。</p>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-neutral-200">每项候选</label>
              <span className="text-[11px] text-neutral-600">候选越多耗时越长</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[1, 2].map((count) => (
                <button key={count} className={`h-10 rounded-md border text-sm ${project.candidateCount === count ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200' : 'border-white/10 text-neutral-400 hover:text-white'}`} onClick={() => updateProject((current) => ({ ...current, candidateCount: count }))}>{count} 个版本</button>
              ))}
            </div>
          </section>
        </div>

        <div className="border-t border-white/8 p-5">
          <button disabled={generating || project.items.length === 0} className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-gradient-to-r from-emerald-400 to-cyan-500 text-sm font-semibold text-[#071312] disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void generateAll()}>
            {generating ? <LoaderCircle size={17} className="animate-spin" /> : <Sparkles size={17} />}
            {generating ? generationPhase || '正在批量生成' : `生成整组道具 ${project.items.length ? `(${project.items.length})` : ''}`}
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/8 px-6">
          <div>
            <p className="text-sm font-medium">01 道具清单与批量生成</p>
            <p className="mt-1 text-xs text-neutral-600">先统一整组风格基准，再独立生成清晰单体，避免物品混合与尺寸漂移</p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-neutral-500">共 {project.items.length}</span>
            <span className="text-emerald-300">完成 {finishedCount}</span>
            <span className="text-cyan-300">选定 {selectedCount}</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {project.items.length === 0 ? (
            <div className="flex min-h-[520px] flex-col items-center justify-center rounded-lg border border-dashed border-white/10 text-neutral-600">
              <Gift size={42} />
              <p className="mt-4 text-base text-neutral-300">先添加需要生产的特产道具</p>
              <p className="mt-2 text-sm">例如：京八件、蝴蝶酥、雪花膏、醒狮钥匙扣</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              {project.items.map((item) => {
                const reference = item.referenceAssetId ? assetMap.get(item.referenceAssetId) : undefined;
                const candidates = item.candidateAssetIds.map((id) => assetMap.get(id)).filter(Boolean) as LibraryAsset[];
                return (
                  <article key={item.id} className="overflow-hidden rounded-lg border border-white/10 bg-[#101415]">
                    <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold">{item.name}</h3>
                        <p className="mt-1 text-[11px] text-neutral-600">{reference ? '已附加结构参考图' : '使用固定风格参考'}</p>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs ${reference ? 'border-emerald-400/30 text-emerald-300' : 'border-white/10 text-neutral-500 hover:text-white'}`}
                          disabled={generating}
                          onClick={() => { setUploadTargetId(item.id); referenceInputRef.current?.click(); }}
                        >
                          <Upload size={12} /> {reference ? '更换参考' : '添加参考'}
                        </button>
                        <button className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-neutral-600 hover:text-red-300" title="移除道具" disabled={generating} onClick={() => updateProject((current) => ({ ...current, items: current.items.filter((entry) => entry.id !== item.id) }))}><X size={14} /></button>
                      </div>
                    </div>

                    <div className="p-4">
                      {item.status === 'running' ? (
                        <div className="flex min-h-64 flex-col items-center justify-center rounded-md bg-black/30 text-neutral-500">
                          <LoaderCircle size={24} className="animate-spin text-emerald-300" />
                          <p className="mt-3 text-sm">正在生成 {item.name}</p>
                        </div>
                      ) : candidates.length ? (
                        <div className={`grid gap-3 ${candidates.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                          {candidates.map((asset) => {
                            const selected = item.selectedAssetId === asset.id;
                            return (
                              <div
                                key={asset.id}
                                role="button"
                                tabIndex={0}
                                className={`group relative aspect-square cursor-pointer overflow-hidden rounded-md border bg-white ${selected ? 'border-emerald-400 ring-2 ring-emerald-400/25' : 'border-white/10 hover:border-white/30'}`}
                                onClick={() => updateItem(item.id, (current) => ({ ...current, selectedAssetId: asset.id, outputAssetId: undefined, cutoutSettings: undefined, animationVideoAssetId: undefined, animationPrompt: undefined, animationSourceAssetId: undefined }))}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') updateItem(item.id, (current) => ({ ...current, selectedAssetId: asset.id, outputAssetId: undefined, cutoutSettings: undefined, animationVideoAssetId: undefined, animationPrompt: undefined, animationSourceAssetId: undefined }));
                                }}
                              >
                                <img src={asset.url} alt={`${item.name} 候选`} className="h-full w-full object-contain" />
                                <button
                                  className="absolute right-2 top-2 flex h-8 items-center gap-1.5 rounded-md bg-black/72 px-2.5 text-[11px] text-white opacity-0 shadow-lg backdrop-blur transition-opacity group-hover:opacity-100 focus:opacity-100"
                                  onClick={(event) => { event.stopPropagation(); openAdjustment(item.id, asset); }}
                                >
                                  <SlidersHorizontal size={12} /> 调整
                                </button>
                                <span className={`absolute bottom-2 right-2 flex h-7 items-center gap-1 rounded-md px-2 text-[11px] ${selected ? 'bg-emerald-400 text-black' : 'bg-black/70 text-white'}`}>{selected && <Check size={12} />}{selected ? '已选用' : '选择'}</span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex min-h-64 flex-col items-center justify-center rounded-md border border-dashed border-white/8 bg-black/20 text-neutral-600">
                          {reference ? <img src={reference.url} alt={`${item.name} 结构参考`} className="mb-3 h-28 w-28 rounded-md object-contain" /> : <ImageIcon size={28} />}
                          <p className="mt-2 text-sm">等待生成</p>
                        </div>
                      )}

                      {item.status === 'failed' && <p className="mt-3 rounded-md bg-red-500/8 px-3 py-2 text-xs text-red-300">{item.errorMessage || '生成失败'}</p>}
                      <div className="mt-3 flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-[11px] text-neutral-600"><Package size={12} /> 候选结果自动保存在仓库</span>
                        <button disabled={generating} className="flex h-8 items-center gap-1.5 rounded-md border border-white/10 px-3 text-xs text-neutral-400 hover:text-white disabled:opacity-40" onClick={() => void generateAll(item)}><RefreshCw size={12} /> {candidates.length ? '重新生成' : '单独生成'}</button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex h-16 shrink-0 items-center justify-between border-t border-white/8 bg-[#0d1010] px-6">
          <p className="text-xs text-neutral-600">所有结果保留原始分辨率；抠图时再统一规范为透明背景 700 × 700 px。</p>
          <button
            disabled={!allSelected}
            className="flex h-10 items-center gap-2 rounded-md bg-cyan-400 px-5 text-sm font-semibold text-[#061315] disabled:bg-transparent disabled:text-neutral-500 disabled:ring-1 disabled:ring-white/10 disabled:opacity-35"
            onClick={() => updateProject((current) => ({ ...current, stage: 'cutout' }))}
          >
            {allSelected ? <Check size={15} /> : <LoaderCircle size={15} />} {allSelected ? '进入抠图与 700 × 700 规范' : `还需选择 ${project.items.length - selectedCount} 项`}
          </button>
        </div>
      </main>

      {adjustTarget && (
        <div className="fixed inset-0 z-[165] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm" onClick={closeAdjustment}>
          <div className="flex h-[calc(100vh-24px)] w-full max-w-[1600px] flex-col overflow-hidden rounded-xl border border-white/12 bg-[#0f1314] shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/8 px-5">
              <div>
                <h3 className="text-lg font-semibold">调整道具素材</h3>
                <p className="mt-1 text-xs text-neutral-500">{project.items.find((item) => item.id === adjustTarget.itemId)?.name} · 新结果会作为候选版本保留，不覆盖当前图片</p>
              </div>
              <button aria-label="关闭调整" title="关闭调整" disabled={adjusting} className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-neutral-400 hover:text-white disabled:opacity-40" onClick={closeAdjustment}><X size={16} /></button>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_370px] gap-4 p-4">
              <SceneRegionEditor
                sourceUrl={adjustTarget.asset.url}
                selectionEnabled={adjustMode === 'region'}
                onSelectionChange={(mask, region) => { setAdjustMask(mask); setAdjustRegion(region); }}
              />
              <aside className="min-h-0 overflow-y-auto rounded-lg border border-white/8 bg-[#111617] p-5">
                <div className="grid grid-cols-2 gap-1 rounded-md border border-white/8 bg-black/30 p-1">
                  <button className={`h-10 rounded text-xs font-medium ${adjustMode === 'region' ? 'bg-cyan-300 text-[#071012]' : 'text-neutral-400 hover:bg-white/5 hover:text-white'}`} onClick={() => setAdjustMode('region')}>局部调整</button>
                  <button className={`h-10 rounded text-xs font-medium ${adjustMode === 'global' ? 'bg-violet-300 text-[#120c17]' : 'text-neutral-400 hover:bg-white/5 hover:text-white'}`} onClick={() => setAdjustMode('global')}>整体调整</button>
                </div>

                <div className="mt-5 space-y-4">
                  {adjustMode === 'region' && (
                    <div className={`rounded-md border px-3 py-3 text-xs leading-5 ${adjustRegion ? 'border-cyan-400/20 bg-cyan-400/[0.05] text-cyan-100/80' : 'border-amber-300/15 bg-amber-300/[0.04] text-amber-100/60'}`}>
                      {adjustRegion ? '已标记需要修改的区域。模型会尽量保持区域外的道具不变。' : '先在左侧原尺寸图片上涂抹需要修改的位置。'}
                    </div>
                  )}
                  <label className="block">
                    <span className="mb-2 block text-sm font-medium text-neutral-200">{adjustMode === 'region' ? '描述局部修改内容' : '描述整体调整方向'}</span>
                    <textarea
                      autoFocus
                      className="min-h-44 w-full resize-y rounded-md border border-white/10 bg-black/35 px-4 py-3 text-sm leading-6 outline-none placeholder:text-neutral-600 focus:border-cyan-400/50"
                      placeholder={adjustMode === 'region' ? '例如：把包装顶部的蝴蝶结改成红色，其他部分保持不变' : '例如：整体减少塑料感，改成细腻哑光陶瓷材质，保持造型和尺寸不变'}
                      value={adjustPrompt}
                      onChange={(event) => setAdjustPrompt(event.target.value)}
                    />
                  </label>
                  <div className="rounded-md border border-white/8 bg-black/20 px-3 py-3 text-[11px] leading-5 text-neutral-500">
                    {adjustMode === 'region'
                      ? '局部编辑效果取决于当前模型是否支持遮罩；不支持时仍会通过位置描述约束修改范围。'
                      : '整体调整会保留原道具、主体尺寸、机位和纯白背景，只改变你描述的视觉属性。'}
                  </div>
                  <button
                    disabled={adjusting || !adjustPrompt.trim() || (adjustMode === 'region' && (!adjustMask || !adjustRegion))}
                    className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-white text-sm font-semibold text-black hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-35"
                    onClick={() => void submitSpecialtyAdjustment()}
                  >
                    {adjusting ? <LoaderCircle size={15} className="animate-spin" /> : <WandSparkles size={15} />}
                    {adjusting ? '正在生成调整版本' : `生成${adjustMode === 'region' ? '局部' : '整体'}调整版本`}
                  </button>
                </div>
              </aside>
            </div>
          </div>
        </div>
      )}

      {historyOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm" onClick={() => setHistoryOpen(false)}>
          <div className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-white/12 bg-[#101314]" onClick={(event) => event.stopPropagation()}>
            <div className="flex h-16 items-center justify-between border-b border-white/8 px-5">
              <div><h3 className="text-lg font-semibold">特产道具历史任务</h3><p className="mt-1 text-xs text-neutral-600">候选图片保存在素材仓库，删除任务不会删除素材</p></div>
              <button className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-neutral-400" onClick={() => setHistoryOpen(false)}><X size={16} /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-5">
              {history.map((saved) => (
                <div key={saved.id} className={`flex items-center gap-4 rounded-md border p-4 ${saved.id === project.id ? 'border-emerald-400/35 bg-emerald-400/[0.05]' : 'border-white/8'}`}>
                  <button className="min-w-0 flex-1 text-left" onClick={() => resumeProject(saved)}>
                    <p className="truncate text-sm font-medium">{saved.name}</p>
                    <p className="mt-1 text-xs text-neutral-600">{saved.items.length} 项 · 已选定 {saved.items.filter((item) => item.selectedAssetId).length} 项 · {new Date(saved.updatedAt).toLocaleString()}</p>
                  </button>
                  <button className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-neutral-500 hover:border-red-400/30 hover:text-red-300" title="删除任务" onClick={() => removeHistoryProject(saved)}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
