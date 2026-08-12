import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, ArrowRight, BookOpen, Camera, Check, Crop, Download, Film, History, Image as ImageIcon, LoaderCircle, MapPin, RotateCcw, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { AIStudio } from './AIStudio';
import { PosterPostProcessStage } from './PosterPostProcessStage';
import { addToLibrary, loadLibrary, type LibraryAsset } from '../utils/assetLibrary';
import { BUILT_IN_PRESETS } from '../ai/presets';
import {
  describeAtlasSceneOptions,
  describeAtlasTextSceneOptions,
  GPT55_PROMPT_AGENT_CONFIG,
  loadPromptAgentConfig,
  savePromptAgentConfig,
} from '../ai/promptAgent';
import {
  clearActiveAtlasProject,
  createAtlasProject,
  deleteAtlasProject,
  loadActiveAtlasProject,
  loadAtlasProjectHistory,
  saveActiveAtlasProject,
  type AtlasProject,
  type AtlasCameraView,
  type AtlasCropRect,
  type AtlasSceneSourceMode,
  type AtlasSceneStrategy,
  type AtlasStage,
} from '../utils/atlasWorkflow';
import type { PosterPostProcessSettings } from '../utils/posterPostProcess';

interface AtlasWorkspaceProps {
  revision?: number;
  onEnterJoy: (asset: LibraryAsset, joyState: Record<string, unknown> | null, projectId: string) => void;
}

const STEPS: Array<{ id: AtlasStage; label: string }> = [
  { id: 'setup', label: '初始设置' },
  { id: 'scene', label: '场景生成' },
  { id: 'joy', label: '角色植入' },
  { id: 'static', label: '静态海报' },
  { id: 'post', label: '海报后期' },
  { id: 'dynamic', label: '动态海报' },
  { id: 'export', label: '导出' },
];

const RATIO_SIZES: Record<string, [number, number]> = {
  '16:9': [1280, 720],
  '4:3': [1112, 834],
  '1:1': [1024, 1024],
  '3:4': [834, 1112],
  '9:16': [720, 1280],
};

const SCENE_GENERATION_SIZES: Record<string, [number, number]> = {
  '16:9': [1536, 1024],
  '4:3': [1024, 768],
  '1:1': [1024, 1024],
  '3:4': [768, 1024],
  '9:16': [1024, 1536],
};

const DYNAMIC_RATIO_SIZES: Record<string, [number, number]> = {
  '16:9': [1280, 720],
  '4:3': [1112, 834],
  '1:1': [960, 960],
  '3:4': [834, 1112],
  '9:16': [720, 1280],
};

const STYLE_REFERENCE_URLS = [
  `${import.meta.env.BASE_URL}atlas-style/codex-clipboard-ce7b628b-0a0a-4074-81c5-bbe2db1cbf4e.png`,
  `${import.meta.env.BASE_URL}atlas-style/codex-clipboard-e21e30d0-0b91-4e8c-bacf-84df73d03b05.png`,
];

const fileToDataUrl = (file: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const cropImageDataUrl = (source: string, crop: AtlasCropRect): Promise<string> => new Promise((resolve, reject) => {
  const image = new Image();
  image.onload = () => {
    const sourceX = Math.round(image.naturalWidth * crop.x);
    const sourceY = Math.round(image.naturalHeight * crop.y);
    const sourceWidth = Math.max(1, Math.round(image.naturalWidth * crop.width));
    const sourceHeight = Math.max(1, Math.round(image.naturalHeight * crop.height));
    const scale = Math.min(1, 1600 / sourceWidth, 1600 / sourceHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(sourceWidth * scale));
    canvas.height = Math.max(1, Math.round(sourceHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      reject(new Error('无法处理裁切区域'));
      return;
    }
    context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);
    resolve(canvas.toDataURL('image/jpeg', 0.92));
  };
  image.onerror = () => reject(new Error('场景图片读取失败'));
  image.src = source;
});

const DEFAULT_CROP: AtlasCropRect = { x: 0.1, y: 0.1, width: 0.8, height: 0.8 };
const DEFAULT_CAMERA: AtlasCameraView = { rotation: 0, tilt: 0, zoom: 50 };

const CAMERA_PRESETS: Array<{ label: string; value: AtlasCameraView }> = [
  { label: '正面', value: { rotation: 0, tilt: 0, zoom: 50 } },
  { label: '左侧', value: { rotation: -35, tilt: 0, zoom: 52 } },
  { label: '右侧', value: { rotation: 35, tilt: 0, zoom: 52 } },
  { label: '低机位', value: { rotation: 15, tilt: -18, zoom: 58 } },
];

type CropResizeHandle = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw';
type CropDragState = {
  mode: 'create' | 'move' | 'resize';
  handle?: CropResizeHandle;
  startX: number;
  startY: number;
  initial: AtlasCropRect;
};

const CROP_HANDLES: Array<{ id: CropResizeHandle; className: string; cursor: string; label: string }> = [
  { id: 'nw', className: '-left-1.5 -top-1.5 h-3 w-3', cursor: 'nwse-resize', label: '调整左上角' },
  { id: 'n', className: 'left-1/2 -top-1 h-2 w-6 -translate-x-1/2', cursor: 'ns-resize', label: '调整上边框' },
  { id: 'ne', className: '-right-1.5 -top-1.5 h-3 w-3', cursor: 'nesw-resize', label: '调整右上角' },
  { id: 'e', className: 'top-1/2 -right-1 h-6 w-2 -translate-y-1/2', cursor: 'ew-resize', label: '调整右边框' },
  { id: 'se', className: '-bottom-1.5 -right-1.5 h-3 w-3', cursor: 'nwse-resize', label: '调整右下角' },
  { id: 's', className: 'left-1/2 -bottom-1 h-2 w-6 -translate-x-1/2', cursor: 'ns-resize', label: '调整下边框' },
  { id: 'sw', className: '-bottom-1.5 -left-1.5 h-3 w-3', cursor: 'nesw-resize', label: '调整左下角' },
  { id: 'w', className: 'top-1/2 -left-1 h-6 w-2 -translate-y-1/2', cursor: 'ew-resize', label: '调整左边框' },
];

const resolveSceneStrategy = (camera: AtlasCameraView): AtlasSceneStrategy => (
  camera.zoom >= 70 ? 'landmark' : Math.abs(camera.rotation) >= 8 || Math.abs(camera.tilt) >= 8 ? 'recompose' : 'local'
);

const describeCameraView = (camera: AtlasCameraView) => {
  const rotation = Math.abs(camera.rotation) < 5
    ? '保持原照片的正面方向'
    : camera.rotation < 0
      ? `摄像机向场景左侧环绕约${Math.abs(camera.rotation)}度`
      : `摄像机向场景右侧环绕约${camera.rotation}度`;
  const tilt = Math.abs(camera.tilt) < 4
    ? '平视机位'
    : camera.tilt < 0
      ? `约${Math.abs(camera.tilt)}度低机位仰视`
      : `约${camera.tilt}度高机位俯视`;
  const zoom = camera.zoom < 34 ? '广角全景' : camera.zoom < 67 ? '中景' : '近景';
  return `${rotation}，${tilt}，${zoom}`;
};

const describeCameraViewCompact = (camera: AtlasCameraView) => {
  const rotation = Math.abs(camera.rotation) < 5
    ? '正面'
    : `${camera.rotation < 0 ? '左侧' : '右侧'} ${Math.abs(camera.rotation)}°`;
  const tilt = Math.abs(camera.tilt) < 4
    ? '平视'
    : `${camera.tilt < 0 ? '低机位' : '高机位'} ${Math.abs(camera.tilt)}°`;
  const zoom = camera.zoom < 34 ? '全景' : camera.zoom < 67 ? '中景' : '近景';
  return `${rotation} · ${tilt} · ${zoom}`;
};

const buildAtlasPromptTemplate = (
  locationName: string,
  camera: AtlasCameraView = DEFAULT_CAMERA,
  ratio = '3:4',
  sourceMode: AtlasSceneSourceMode = 'reference',
  sceneConcept = '',
) => {
  const locationNote = locationName.trim();
  return sourceMode === 'prompt'
    ? {
    prefix: `生成一张卡通游戏海报。用户的核心场景设想是【${sceneConcept.trim() || locationName || '创意场景'}】${locationName ? `，场景名称或地点为【${locationName}】` : ''}。第1、2张图片只用于参考3D卡通拟物的视觉风格，不参考其中的场景内容、人物、文字和构图。3D哑光质感，C4D，blender，Q萌，圆润，简洁造型，色彩清新，高饱和度，细腻材质，柔和自然光影。用户选定的具体画面方案为：`,
    suffix: `。忠实呈现用户描述的核心主体、氛围和空间关系，允许补充合理的环境细节，但不得加入无关地标、品牌、人物或文字。以场景本身的美感、视觉重心、构图节奏和层次完整为最高优先，不要为了后续角色刻意制造大片空地或留白。高清简洁，色彩搭配高级简约。不要出现文字、Logo或水印。画面比例${ratio}`,
    }
    : {
      prefix: `生成一张卡通游戏角色海报。第1张图片是完整场景参考，是场景身份、建筑结构、景物关系和空间布局的最高优先级依据；结果必须明确表现同一个场景。${locationNote ? `用户补充的场景备注为【${locationNote}】，备注仅用于辅助理解，若与图片内容冲突必须以图片为准。` : '用户没有填写场景备注，请完全依据参考图片理解场景，不要猜测或补充具体地名。'}目标摄像机视角为：${describeCameraView(camera)}。请依据该参数推演同一场景的新机位画面，而不是复刻原照片构图。允许在原拍摄位置附近前移、侧移或转动镜头，但不得改造建筑、移动或替换景物、交换空间关系、加入新地标，或重新组合成另一个场景。未展示区域只做符合原结构的保守延伸。第2、3张图片只用于参考3D卡通拟物的视觉风格，不参考其中的场景内容、人物、文字和构图。3D哑光质感，C4D，blender，Q萌，圆润，简洁造型，色彩清新，高饱和度，细腻材质，柔和自然光影。具体取景为：`,
      suffix: `。严格保留原参考照片的场景辨识度、建筑特征和景物空间关系。以场景本身的美感、视觉重心、构图节奏和层次完整为最高优先，不要为了后续角色刻意制造大片空地或留白。高清简洁，色彩搭配高级简约。不要出现文字、Logo或水印。画面比例${ratio}`,
    };
};

const buildFallbackSceneOptions = (
  locationName: string,
  strategy: AtlasSceneStrategy,
  camera: AtlasCameraView,
) => {
  const location = locationName.trim() || '参考图片中的场景';
  const view = describeCameraViewCompact(camera);
  const strategyText = strategy === 'recompose'
    ? '从原拍摄点附近轻微侧移'
    : strategy === 'landmark'
      ? '靠近最具辨识度的主体'
      : '基本保持原照片方向并适度推进';
  const sideView = camera.rotation <= 0 ? '从右前方小幅侧移的中景' : '从左前方小幅侧移的中景';
  const heightView = camera.tilt <= 0 ? '略升高机位俯视的广角取景' : '略降低机位观察的近景';
  return [
    `以${location}的主要建筑或地标为主体，${strategyText}，采用${view}，保留真实前中后景关系与自然光线，视觉重心落在场景最具辨识度的位置。`,
    `采用${sideView}观察${location}，将主体放在画面侧部，前景承接原有道路或自然景物形成引导，中景突出主体空间，远景保留环境层次。`,
    `采用${heightView}呈现${location}，主体落点与前两个方案错开，严格沿用参考图中的建筑、树木和道路关系，以前中后景的纵深呼应作为视觉重点。`,
  ];
};

const buildFallbackTextSceneOptions = (sceneConcept: string, locationName: string) => {
  const concept = sceneConcept.trim().replace(/\s+/g, ' ').slice(0, 90);
  const location = locationName.trim() ? `，围绕${locationName.trim()}` : '';
  return [
    `以“${concept}”为核心${location}，采用平视中广角建立完整环境，主体位于画面视觉中心，前景作为轻微引导，中景承载主要空间，远景交代环境与自然光线。`,
    `保留“${concept}”的核心氛围${location}，改用侧向低机位中景，主体落在画面一侧，利用近处物件形成前景纵深，中远景逐步展开，光线突出空间层次。`,
    `围绕“${concept}”重新组织画面${location}，采用略高机位的开阔景别，主体与环境形成对角关系，前中后景清楚分层，让整体氛围和视觉节奏更舒展。`,
  ];
};

export const AtlasWorkspace: React.FC<AtlasWorkspaceProps> = ({ revision = 0, onEnterJoy }) => {
  const [project, setProject] = useState<AtlasProject | null>(() => loadActiveAtlasProject());
  const [projectName, setProjectName] = useState('');
  const [ratio, setRatio] = useState('3:4');
  const [dynamicEnabled, setDynamicEnabled] = useState(true);
  const [sceneSourceMode, setSceneSourceMode] = useState<AtlasSceneSourceMode>('reference');
  const [sceneConcept, setSceneConcept] = useState('');
  const [locationName, setLocationName] = useState('');
  const [sceneReferenceDataUrl, setSceneReferenceDataUrl] = useState('');
  const [sceneReferenceDragging, setSceneReferenceDragging] = useState(false);
  const [sceneCrop, setSceneCrop] = useState<AtlasCropRect>(DEFAULT_CROP);
  const [sceneCamera, setSceneCamera] = useState<AtlasCameraView>(DEFAULT_CAMERA);
  const [sceneAgentConfig, setSceneAgentConfig] = useState(() => loadPromptAgentConfig());
  const [preparingScene, setPreparingScene] = useState(false);
  const [prepareError, setPrepareError] = useState('');
  const sceneReferenceInputRef = useRef<HTMLInputElement>(null);
  const cropFrameRef = useRef<HTMLDivElement>(null);
  const cropDragRef = useRef<CropDragState | null>(null);
  const [sceneReferenceAsset, setSceneReferenceAsset] = useState<LibraryAsset | null>(null);
  const [sceneAsset, setSceneAsset] = useState<LibraryAsset | null>(null);
  const [compositeAsset, setCompositeAsset] = useState<LibraryAsset | null>(null);
  const [postProcessedAsset, setPostProcessedAsset] = useState<LibraryAsset | null>(null);
  const [videoAsset, setVideoAsset] = useState<LibraryAsset | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [projectHistory, setProjectHistory] = useState<AtlasProject[]>(() => loadAtlasProjectHistory());
  const [historyPreviews, setHistoryPreviews] = useState<Record<string, { url: string; type: LibraryAsset['type'] }>>({});

  useEffect(() => {
    setProject(loadActiveAtlasProject());
  }, [revision]);

  useEffect(() => {
    savePromptAgentConfig(sceneAgentConfig);
  }, [sceneAgentConfig]);

  useEffect(() => {
    if (!project) return;
    let cancelled = false;
    void loadLibrary().then((assets) => {
      if (cancelled) return;
      const referenceAsset = project.sceneReferenceId
        ? assets.find((asset) => asset.id === project.sceneReferenceId) || null
        : null;
      setSceneReferenceAsset(referenceAsset);
      if (project.currentStage === 'setup' && referenceAsset) {
        setSceneReferenceDataUrl(referenceAsset.url);
      }
      setSceneAsset(project.selectedSceneId
        ? assets.find((asset) => asset.id === project.selectedSceneId) || null
        : null);
      setCompositeAsset(project.selectedCompositeId
        ? assets.find((asset) => asset.id === project.selectedCompositeId) || null
        : null);
      setPostProcessedAsset(project.selectedPostProcessedId
        ? assets.find((asset) => asset.id === project.selectedPostProcessedId) || null
        : null);
      setVideoAsset(project.selectedVideoId
        ? assets.find((asset) => asset.id === project.selectedVideoId) || null
        : null);
    });
    return () => { cancelled = true; };
  }, [project?.sceneReferenceId, project?.selectedSceneId, project?.selectedCompositeId, project?.selectedPostProcessedId, project?.selectedVideoId]);

  useEffect(() => {
    if (!project || project.currentStage !== 'setup') return;
    setProjectName(project.name || '');
    setSceneSourceMode(project.sceneSourceMode || (project.sceneConcept && !project.sceneReferenceId ? 'prompt' : 'reference'));
    setSceneConcept(project.sceneConcept || '');
    setLocationName(project.locationName || '');
    setRatio(project.outputRatio || '3:4');
    setDynamicEnabled(project.dynamicEnabled);
    setSceneCrop(project.sceneCrop || DEFAULT_CROP);
    setSceneCamera(project.sceneCamera || DEFAULT_CAMERA);
    setPrepareError('');
  }, [project?.id, project?.currentStage]);

  const createProject = async () => {
    const usesReference = sceneSourceMode === 'reference';
    if (usesReference && !sceneReferenceDataUrl) {
      setPrepareError('请先上传一张场景参考图');
      return;
    }
    if (!usesReference && sceneConcept.trim().length < 6) {
      setPrepareError('请用至少 6 个字描述想要的场景画面');
      return;
    }
    const effectiveLocation = usesReference
      ? locationName.trim()
      : locationName.trim()
        || sceneConcept.trim().replace(/[，。！？、,.!?].*$/, '').slice(0, 30)
        || '创意场景';
    setPreparingScene(true);
    setPrepareError('');
    const [outputWidth, outputHeight] = RATIO_SIZES[ratio] || RATIO_SIZES['1:1'];
    try {
      const seedreamConfig = BUILT_IN_PRESETS.find((preset) => preset.id === '__doubao_seedream__')?.config;
      if (!seedreamConfig) throw new Error('未找到 Seedream 模型配置');
      const sceneStrategy = resolveSceneStrategy(sceneCamera);
      let sceneDescriptionOptions: string[];
      let sceneAnalysisSource: 'ai' | 'fallback' = 'ai';
      let sceneAnalysisError = '';
      try {
        if (usesReference) {
          const croppedReference = await cropImageDataUrl(sceneReferenceDataUrl, sceneCrop);
          sceneDescriptionOptions = await describeAtlasSceneOptions(
            sceneAgentConfig,
            seedreamConfig,
            croppedReference,
            effectiveLocation,
            sceneStrategy,
            sceneCamera,
          );
        } else {
          sceneDescriptionOptions = await describeAtlasTextSceneOptions(
            sceneAgentConfig,
            seedreamConfig,
            sceneConcept,
            effectiveLocation,
            ratio,
          );
        }
      } catch (analysisError) {
        console.warn('[Atlas] 场景 AI 分析不可用，使用本地基础方案继续：', analysisError);
        sceneAnalysisSource = 'fallback';
        sceneAnalysisError = analysisError instanceof Error ? analysisError.message : String(analysisError);
        sceneDescriptionOptions = usesReference
          ? buildFallbackSceneOptions(effectiveLocation, sceneStrategy, sceneCamera)
          : buildFallbackTextSceneOptions(sceneConcept, locationName);
      }
      const sceneDescription = sceneDescriptionOptions[0] || '';
      const baseProject = project?.currentStage === 'setup'
        ? saveActiveAtlasProject({
          ...project,
          name: projectName.trim() || project.name,
          currentStage: 'scene',
          sceneSourceMode,
          sceneConcept: usesReference ? undefined : sceneConcept.trim(),
          locationName: effectiveLocation,
          sceneDescription,
          sceneDescriptionOptions,
          sceneAnalysisSource,
          sceneAnalysisModel: sceneAgentConfig.model.trim(),
          sceneAnalysisError: sceneAnalysisError || undefined,
          sceneStrategy,
          sceneCrop,
          sceneCamera,
          sceneReferenceId: usesReference ? project.sceneReferenceId : undefined,
          outputRatio: ratio,
          outputWidth,
          outputHeight,
          dynamicEnabled,
          selectedSceneId: undefined,
          selectedCompositeId: undefined,
          selectedPostProcessedId: undefined,
          selectedVideoId: undefined,
          postProcessSettings: undefined,
          postProcessCompleted: false,
          joyState: undefined,
        })
        : createAtlasProject({
          name: projectName,
          outputRatio: ratio,
          outputWidth,
          outputHeight,
          dynamicEnabled,
          sceneSourceMode,
          sceneConcept: usesReference ? undefined : sceneConcept,
          locationName: effectiveLocation,
          sceneDescription,
          sceneDescriptionOptions,
          sceneAnalysisSource,
          sceneAnalysisModel: sceneAgentConfig.model.trim(),
          sceneAnalysisError: sceneAnalysisError || undefined,
          sceneStrategy,
          sceneCrop,
          sceneCamera,
        });
      let next = baseProject;
      if (usesReference) {
        const referenceAsset = sceneReferenceAsset?.url === sceneReferenceDataUrl
          ? sceneReferenceAsset
          : await addToLibrary({
            url: sceneReferenceDataUrl,
            type: 'image',
            prompt: effectiveLocation ? `${effectiveLocation} · 完整场景参考图` : '完整场景参考图',
            thumbnail: sceneReferenceDataUrl,
            projectId: baseProject.id,
            workflowId: baseProject.id,
            stage: 'reference',
            selected: true,
            status: 'approved',
            tags: ['角色海报场景参考', 'image-to-image', sceneStrategy],
          });
        next = saveActiveAtlasProject({ ...baseProject, sceneReferenceId: referenceAsset.id });
        setSceneReferenceAsset(referenceAsset);
      } else {
        next = saveActiveAtlasProject({ ...baseProject, sceneReferenceId: undefined });
        setSceneReferenceAsset(null);
      }
      setProject(next);
      setProjectHistory(loadAtlasProjectHistory());
    } catch (error: any) {
      setPrepareError(error?.name === 'AbortError' ? '场景分析超时，请重试' : error?.message || '场景分析失败');
    } finally {
      setPreparingScene(false);
    }
  };

  const selectScene = (asset: LibraryAsset) => {
    if (!project) return;
    const next = saveActiveAtlasProject({
      ...project,
      selectedSceneId: asset.id,
      selectedCompositeId: undefined,
      selectedPostProcessedId: undefined,
      selectedVideoId: undefined,
      postProcessSettings: undefined,
      postProcessCompleted: false,
      joyState: undefined,
      currentStage: 'joy',
    });
    setProject(next);
    setSceneAsset(asset);
    onEnterJoy(asset, null, project.id);
  };

  const updateSceneDescription = (sceneDescription: string) => {
    if (!project) return;
    setProject(saveActiveAtlasProject({ ...project, sceneDescription }));
  };

  const selectDynamicVideo = (asset: LibraryAsset) => {
    if (!project || asset.type !== 'video') return;
    const next = saveActiveAtlasProject({
      ...project,
      selectedVideoId: asset.id,
      currentStage: 'export',
    });
    setProject(next);
    setVideoAsset(asset);
  };

  const commitPostProcess = (asset: LibraryAsset, settings: PosterPostProcessSettings) => {
    if (!project) return;
    const next = saveActiveAtlasProject({
      ...project,
      selectedPostProcessedId: asset.id,
      selectedVideoId: undefined,
      postProcessSettings: settings,
      postProcessCompleted: true,
      currentStage: project.dynamicEnabled ? 'dynamic' : 'export',
    });
    setProject(next);
    setPostProcessedAsset(asset);
    setVideoAsset(null);
  };

  const continueWithOriginalPoster = (settings: PosterPostProcessSettings) => {
    if (!project) return;
    const next = saveActiveAtlasProject({
      ...project,
      selectedPostProcessedId: undefined,
      selectedVideoId: undefined,
      postProcessSettings: settings,
      postProcessCompleted: true,
      currentStage: project.dynamicEnabled ? 'dynamic' : 'export',
    });
    setProject(next);
    setPostProcessedAsset(null);
    setVideoAsset(null);
  };

  const goToStage = (stage: AtlasStage) => {
    if (!project) return;
    if (
      stage === 'scene' ||
      (stage === 'joy' && project.selectedSceneId) ||
      (stage === 'static' && project.selectedCompositeId) ||
      (stage === 'post' && project.selectedCompositeId) ||
      (stage === 'dynamic' && project.selectedCompositeId && project.dynamicEnabled && project.postProcessCompleted) ||
      (stage === 'export' && (project.selectedVideoId || (!project.dynamicEnabled && project.selectedCompositeId && project.postProcessCompleted)))
    ) {
      setProject(saveActiveAtlasProject({ ...project, currentStage: stage }));
    }
  };

  const returnToSetup = () => {
    if (!project) return;
    setProjectName(project.name || '');
    setSceneSourceMode(project.sceneSourceMode || (project.sceneConcept && !project.sceneReferenceId ? 'prompt' : 'reference'));
    setSceneConcept(project.sceneConcept || '');
    setLocationName(project.locationName || '');
    setSceneReferenceDataUrl(sceneReferenceAsset?.url || '');
    setSceneCrop(project.sceneCrop || DEFAULT_CROP);
    setSceneCamera(project.sceneCamera || DEFAULT_CAMERA);
    setRatio(project.outputRatio || '3:4');
    setDynamicEnabled(project.dynamicEnabled);
    setPrepareError('');
    setProject(saveActiveAtlasProject({ ...project, currentStage: 'setup' }));
  };

  const startNewProject = () => {
    clearActiveAtlasProject();
    setProject(null);
    setSceneReferenceAsset(null);
    setSceneAsset(null);
    setCompositeAsset(null);
    setPostProcessedAsset(null);
    setVideoAsset(null);
    setProjectName('');
    setSceneSourceMode('reference');
    setSceneConcept('');
    setLocationName('');
    setSceneReferenceDataUrl('');
    setSceneCrop(DEFAULT_CROP);
    setSceneCamera(DEFAULT_CAMERA);
    setPrepareError('');
    setRatio('3:4');
    setDynamicEnabled(true);
    setProjectHistory(loadAtlasProjectHistory());
  };

  const chooseSceneReference = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setPrepareError('请选择图片文件');
      return;
    }
    try {
      setSceneReferenceDataUrl(await fileToDataUrl(file));
      setSceneCrop(DEFAULT_CROP);
      setPrepareError('');
    } catch {
      setPrepareError('图片读取失败，请重新选择');
    } finally {
      if (sceneReferenceInputRef.current) sceneReferenceInputRef.current.value = '';
    }
  };

  const dropSceneReference = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setSceneReferenceDragging(false);
    void chooseSceneReference(event.dataTransfer.files);
  };

  const cropPoint = (event: React.PointerEvent<HTMLElement>) => {
    const bounds = cropFrameRef.current?.getBoundingClientRect();
    if (!bounds) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)),
    };
  };

  const startCrop = (event: React.PointerEvent<HTMLElement>) => {
    const point = cropPoint(event);
    cropDragRef.current = { mode: 'create', startX: point.x, startY: point.y, initial: sceneCrop };
    event.currentTarget.setPointerCapture(event.pointerId);
    setSceneCrop({ x: point.x, y: point.y, width: 0.01, height: 0.01 });
  };

  const startMoveCrop = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const point = cropPoint(event);
    cropDragRef.current = { mode: 'move', startX: point.x, startY: point.y, initial: sceneCrop };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const startResizeCrop = (handle: CropResizeHandle, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const point = cropPoint(event);
    cropDragRef.current = { mode: 'resize', handle, startX: point.x, startY: point.y, initial: sceneCrop };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const moveCrop = (event: React.PointerEvent<HTMLElement>) => {
    const drag = cropDragRef.current;
    if (!drag) return;
    const point = cropPoint(event);
    if (drag.mode === 'create') {
      setSceneCrop({
        x: Math.min(drag.startX, point.x),
        y: Math.min(drag.startY, point.y),
        width: Math.max(0.01, Math.abs(point.x - drag.startX)),
        height: Math.max(0.01, Math.abs(point.y - drag.startY)),
      });
      return;
    }
    if (drag.mode === 'move') {
      const x = Math.max(0, Math.min(1 - drag.initial.width, drag.initial.x + point.x - drag.startX));
      const y = Math.max(0, Math.min(1 - drag.initial.height, drag.initial.y + point.y - drag.startY));
      setSceneCrop({ ...drag.initial, x, y });
      return;
    }

    const minimumSize = 0.08;
    const handle = drag.handle || 'se';
    let left = drag.initial.x;
    let top = drag.initial.y;
    let right = drag.initial.x + drag.initial.width;
    let bottom = drag.initial.y + drag.initial.height;
    if (handle.includes('w')) left = Math.min(point.x, right - minimumSize);
    if (handle.includes('e')) right = Math.max(point.x, left + minimumSize);
    if (handle.includes('n')) top = Math.min(point.y, bottom - minimumSize);
    if (handle.includes('s')) bottom = Math.max(point.y, top + minimumSize);
    left = Math.max(0, left);
    top = Math.max(0, top);
    right = Math.min(1, right);
    bottom = Math.min(1, bottom);
    setSceneCrop({ x: left, y: top, width: right - left, height: bottom - top });
  };

  const finishCrop = () => {
    cropDragRef.current = null;
    setSceneCrop((current) => current.width < 0.08 || current.height < 0.08 ? DEFAULT_CROP : current);
  };

  const openProjectHistory = async () => {
    const projects = loadAtlasProjectHistory();
    setProjectHistory(projects);
    setHistoryOpen(true);
    const assets = await loadLibrary();
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]));
    const previews: Record<string, { url: string; type: LibraryAsset['type'] }> = {};
    projects.forEach((item) => {
      const assetId = item.selectedVideoId || item.selectedPostProcessedId || item.selectedCompositeId || item.selectedSceneId || item.sceneReferenceId;
      const asset = assetId ? assetMap.get(assetId) : null;
      if (asset) previews[item.id] = { url: asset.url, type: asset.type };
    });
    setHistoryPreviews(previews);
  };

  const resumeProject = (savedProject: AtlasProject) => {
    const next = saveActiveAtlasProject(savedProject);
    setSceneReferenceAsset(null);
    setSceneAsset(null);
    setCompositeAsset(null);
    setPostProcessedAsset(null);
    setVideoAsset(null);
    setProject(next);
    setProjectHistory(loadAtlasProjectHistory());
    setHistoryOpen(false);
  };

  const removeProject = (projectToDelete: AtlasProject) => {
    if (!confirm(`确定删除任务“${projectToDelete.name}”吗？\n\n素材仓库中的图片和视频会保留。`)) return;
    const deletedActive = deleteAtlasProject(projectToDelete.id);
    setHistoryPreviews((current) => {
      const next = { ...current };
      delete next[projectToDelete.id];
      return next;
    });
    setProjectHistory(loadAtlasProjectHistory());
    if (!deletedActive) return;
    setProject(null);
    setSceneReferenceAsset(null);
    setSceneAsset(null);
    setCompositeAsset(null);
    setPostProcessedAsset(null);
    setVideoAsset(null);
    setProjectName('');
    setSceneSourceMode('reference');
    setSceneConcept('');
    setLocationName('');
    setSceneReferenceDataUrl('');
    setSceneCrop(DEFAULT_CROP);
    setSceneCamera(DEFAULT_CAMERA);
    setRatio('3:4');
    setDynamicEnabled(true);
    setPrepareError('');
  };

  const historyDialog = historyOpen && (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/75 p-5 backdrop-blur-sm" onClick={() => setHistoryOpen(false)}>
      <div className="flex max-h-[82vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-white/12 bg-[#101314] shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/8 px-5">
          <div>
            <h3 className="text-lg font-semibold text-white">历史任务</h3>
            <p className="mt-0.5 text-xs text-neutral-500">旧任务与输出会保留，生成记录只显示当前任务</p>
          </div>
          <button className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-neutral-400 hover:bg-white/5 hover:text-white" title="关闭" onClick={() => setHistoryOpen(false)}><X size={17} /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {projectHistory.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center gap-3 text-neutral-600">
              <History size={28} />
              <p className="text-sm">还没有历史任务</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {projectHistory.map((item) => {
                const preview = historyPreviews[item.id];
                const stageLabel = STEPS.find((step) => step.id === item.currentStage)?.label || '任务设置';
                return (
                  <div key={item.id} className="relative">
                  <button className={`grid min-h-32 w-full grid-cols-[118px_minmax(0,1fr)] gap-4 rounded-md border p-3 pr-12 text-left transition-colors ${project?.id === item.id ? 'border-cyan-400/45 bg-cyan-400/[0.06]' : 'border-white/8 bg-white/[0.025] hover:border-white/18 hover:bg-white/[0.04]'}`} onClick={() => resumeProject(item)}>
                    <div className="flex h-28 items-center justify-center overflow-hidden rounded bg-black/55">
                      {preview?.type === 'video'
                        ? <video src={preview.url} muted preload="metadata" className="h-full w-full object-contain" />
                        : preview
                          ? <img src={preview.url} alt="任务预览" className="h-full w-full object-contain" />
                          : <BookOpen size={24} className="text-neutral-700" />}
                    </div>
                    <div className="min-w-0 py-1">
                      <p className="truncate text-sm font-medium text-white">{item.name}</p>
                      <p className="mt-2 text-xs text-cyan-300/80">{stageLabel}</p>
                      <p className="mt-1 text-xs text-neutral-500">{item.locationName || '未添加场景备注'}</p>
                      <p className="mt-3 text-[11px] text-neutral-600">{new Date(item.updatedAt).toLocaleString()}</p>
                      {project?.id === item.id && <span className="mt-2 inline-block text-[10px] text-emerald-400">当前任务</span>}
                    </div>
                  </button>
                  <button
                    type="button"
                    title="删除任务"
                    aria-label={`删除任务 ${item.name}`}
                    className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-[#101314]/90 text-neutral-500 hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-300"
                    onClick={() => removeProject(item)}
                  >
                    <Trash2 size={14} />
                  </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const downloadOutput = (asset: LibraryAsset | null) => {
    if (!asset) return;
    let href = asset.url;
    if (!href.startsWith('data:') && !href.startsWith('blob:')) {
      try {
        const parsed = new URL(href, window.location.href);
        href = parsed.origin === window.location.origin
          ? parsed.href
          : `/download-asset?u=${encodeURIComponent(parsed.href)}`;
      } catch {
        href = asset.url;
      }
    }
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `atlas-${project?.id || Date.now()}.${asset.type === 'video' ? 'mp4' : 'png'}`;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  if (!project || project.currentStage === 'setup') {
    return (
      <div className="flex-1 min-h-0 flex flex-col bg-[#090b0c]">
        {project && (
          <div className="h-[72px] shrink-0 border-b border-white/8 bg-[#0d1010] px-6 flex items-center gap-6">
            <div className="min-w-[190px]">
              <p className="truncate text-sm font-semibold text-white">{project.name}</p>
              <p className="mt-1 text-[11px] text-neutral-500">{project.outputRatio} · {project.outputWidth} x {project.outputHeight} · 自动保存</p>
            </div>
            <div className="flex flex-1 items-center justify-center gap-2">
              {STEPS.map((step, index) => {
                const active = step.id === 'setup';
                const reachable = step.id === 'setup'
                  || step.id === 'scene'
                  || (step.id === 'joy' && Boolean(project.selectedSceneId))
                  || (step.id === 'static' && Boolean(project.selectedCompositeId))
                  || (step.id === 'post' && Boolean(project.selectedCompositeId))
                  || (step.id === 'dynamic' && Boolean(project.selectedCompositeId) && project.dynamicEnabled && Boolean(project.postProcessCompleted))
                  || (step.id === 'export' && Boolean(project.selectedVideoId || (!project.dynamicEnabled && project.selectedCompositeId && project.postProcessCompleted)));
                return (
                  <React.Fragment key={step.id}>
                    {index > 0 && <div className={`h-px w-8 ${index === 1 ? 'bg-cyan-400/50' : 'bg-white/10'}`} />}
                    <button
                      className={`flex items-center gap-2 text-xs ${active ? 'text-white' : reachable ? 'text-cyan-300' : 'text-neutral-600'} ${reachable ? 'cursor-pointer' : 'cursor-default'}`}
                      onClick={() => step.id !== 'setup' && reachable && goToStage(step.id)}
                    >
                      <span className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] ${active ? 'border-cyan-400 bg-cyan-400/10 text-cyan-200' : reachable ? 'border-cyan-400/40 text-cyan-300' : 'border-white/10'}`}>
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      {step.label}
                    </button>
                  </React.Fragment>
                );
              })}
            </div>
            <div className="flex items-center gap-3">
              <button className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-white" onClick={() => void openProjectHistory()}>
                <History size={13} /> 历史任务
              </button>
              <button className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-white" onClick={startNewProject}>
                <RotateCcw size={13} /> 新建任务
              </button>
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-10">
          <div className="mx-auto max-w-3xl">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white/5">
              <BookOpen size={21} className="text-cyan-300" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-white">{project ? '调整角色海报任务' : '创建角色海报任务'}</h2>
              <p className="mt-1 text-sm text-neutral-500">{project ? '当前分析结果和关键词已保留；回看不会自动重新分析' : '设置一次，后续素材和步骤自动传递'}</p>
            </div>
            <button className="ml-auto flex h-10 items-center gap-2 rounded-md border border-white/10 px-4 text-sm text-neutral-300 hover:bg-white/5 hover:text-white" onClick={() => void openProjectHistory()}>
              <History size={15} /> 历史任务{projectHistory.length > 0 ? ` ${projectHistory.length}` : ''}
            </button>
          </div>

          <div className="space-y-6 border-y border-white/8 py-7">
            <label className="block">
              <span className="mb-2 block text-sm text-neutral-300">任务名称</span>
              <input
                className="h-12 w-full rounded-md border border-white/10 bg-[#111516] px-4 text-[15px] text-white outline-none focus:border-cyan-400/60"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="例如：JOY 夏日露营角色海报"
              />
            </label>

            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="text-sm text-neutral-300">场景输入方式</span>
                <span className="text-xs text-neutral-600">选择一种即可开始</span>
              </div>
              <div className="mb-4 grid grid-cols-2 gap-2 rounded-md border border-white/8 bg-black/20 p-1.5">
                <button
                  type="button"
                  className={`flex h-11 items-center justify-center gap-2 rounded text-sm transition-colors ${sceneSourceMode === 'reference' ? 'bg-white/10 text-white shadow-sm' : 'text-neutral-500 hover:text-neutral-300'}`}
                  onClick={() => { setSceneSourceMode('reference'); setPrepareError(''); }}
                >
                  <ImageIcon size={16} /> 上传参考图
                </button>
                <button
                  type="button"
                  className={`flex h-11 items-center justify-center gap-2 rounded text-sm transition-colors ${sceneSourceMode === 'prompt' ? 'bg-cyan-400/10 text-cyan-200 shadow-sm' : 'text-neutral-500 hover:text-neutral-300'}`}
                  onClick={() => { setSceneSourceMode('prompt'); setPrepareError(''); }}
                >
                  <Sparkles size={16} /> 文字描述场景
                </button>
              </div>

              {sceneSourceMode === 'reference' ? (
                <>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-sm text-neutral-300">场景参考图</span>
                    <span className="text-xs text-neutral-600">用于识别选址与构图</span>
                  </div>
                  <input
                    ref={sceneReferenceInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => void chooseSceneReference(event.target.files)}
                  />
                  <div
                    className={`relative flex min-h-52 w-full items-center justify-center overflow-hidden rounded-md border border-dashed bg-[#111516] transition-colors ${sceneReferenceDragging ? 'border-cyan-300 bg-cyan-400/[0.06] ring-2 ring-cyan-300/20' : 'border-white/15'}`}
                    onDragEnter={(event) => { event.preventDefault(); setSceneReferenceDragging(true); }}
                    onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setSceneReferenceDragging(true); }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setSceneReferenceDragging(false);
                    }}
                    onDrop={dropSceneReference}
                  >
                    {sceneReferenceDataUrl ? (
                      <div ref={cropFrameRef} className="relative inline-block max-w-full">
                        <img src={sceneReferenceDataUrl} alt="场景参考" className="block max-h-80 max-w-full select-none object-contain" draggable={false} />
                        <div
                          className="absolute inset-0 z-10 cursor-crosshair touch-none"
                          onPointerDown={startCrop}
                          onPointerMove={moveCrop}
                          onPointerUp={finishCrop}
                          onPointerCancel={finishCrop}
                        />
                        <div
                          className="absolute z-20 cursor-move touch-none border-2 border-cyan-300 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
                          style={{
                            left: `${sceneCrop.x * 100}%`,
                            top: `${sceneCrop.y * 100}%`,
                            width: `${sceneCrop.width * 100}%`,
                            height: `${sceneCrop.height * 100}%`,
                          }}
                          onPointerDown={startMoveCrop}
                          onPointerMove={moveCrop}
                          onPointerUp={finishCrop}
                          onPointerCancel={finishCrop}
                        >
                          <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/70 px-2 py-1 text-[10px] text-cyan-100">拖拽框内移动</span>
                          {CROP_HANDLES.map((handle) => (
                            <button
                              key={handle.id}
                              type="button"
                              aria-label={handle.label}
                              title={handle.label}
                              className={`absolute z-30 rounded-sm border border-white bg-cyan-300 shadow-[0_0_0_1px_rgba(0,0,0,0.45)] ${handle.className}`}
                              style={{ cursor: handle.cursor }}
                              onPointerDown={(event) => startResizeCrop(handle.id, event)}
                            />
                          ))}
                        </div>
                      </div>
                    ) : (
                      <button type="button" className="flex min-h-52 w-full flex-col items-center justify-center gap-3 text-neutral-500 hover:text-neutral-300" onClick={() => sceneReferenceInputRef.current?.click()}>
                        <Upload size={26} />
                        <span className="text-sm text-neutral-300">点击或拖拽导入实景、构图参考图</span>
                        <span className="text-xs text-neutral-600">支持 JPG、PNG、WebP</span>
                      </button>
                    )}
                    {sceneReferenceDragging && (
                      <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-[#071012]/85 backdrop-blur-sm">
                        <div className="flex flex-col items-center gap-2 text-cyan-200"><Upload size={28} /><span className="text-sm font-medium">释放即可导入场景参考图</span></div>
                      </div>
                    )}
                    {sceneReferenceDataUrl && <button type="button" className="absolute right-3 top-3 z-30 rounded-md bg-black/75 px-3 py-2 text-xs text-white hover:bg-black" onClick={() => sceneReferenceInputRef.current?.click()}>重新选择</button>}
                  </div>
                  {sceneReferenceDataUrl && <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-500"><Crop size={13} /> 拖拽框内可移动取景区域，拖拽边框或角点可调整大小；在框外拖拽可重新框选</p>}
                </>
              ) : (
                <div className="rounded-md border border-cyan-400/15 bg-cyan-400/[0.035] p-4">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <span className="text-sm text-neutral-200">描述想要的场景画面</span>
                    <span className="text-xs text-neutral-600">{sceneConcept.length} / 500</span>
                  </div>
                  <textarea
                    className="min-h-36 w-full resize-y rounded-md border border-white/10 bg-black/30 px-4 py-3 text-[15px] leading-7 text-white outline-none placeholder:text-neutral-600 focus:border-cyan-400/50"
                    maxLength={500}
                    value={sceneConcept}
                    onChange={(event) => { setSceneConcept(event.target.value); setPrepareError(''); }}
                    placeholder="例如：雨后的江南水乡傍晚，青石板路泛着微光，白墙黛瓦沿河展开，远处有拱桥和暖黄色灯笼，整体安静、清新、有一点童话感。"
                  />
                  <p className="mt-2 text-xs leading-5 text-neutral-500">建议写清主体、时间或天气、环境元素和想要的氛围。AI 会据此整理三个不同机位的画面方案。</p>
                </div>
              )}
            </div>

            {sceneSourceMode === 'reference' && (
            <div>
              <div className="mb-3 flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-sm text-neutral-300"><Camera size={16} /> 摄像机视角</span>
                <button
                  type="button"
                  title="重置摄像机"
                  className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-neutral-500 hover:bg-white/5 hover:text-white"
                  onClick={() => setSceneCamera(DEFAULT_CAMERA)}
                >
                  <RotateCcw size={14} />
                </button>
              </div>

              <div className="grid gap-5 rounded-md border border-white/10 bg-[#111516] p-4 md:grid-cols-[220px_minmax(0,1fr)]">
                <div className="relative aspect-square overflow-hidden rounded-md border border-white/8 bg-[#0b0e0f]">
                  <div className="absolute inset-[14%] rounded-full border border-white/10" />
                  <div className="absolute inset-[27%] rounded-full border border-white/8" />
                  <div className="absolute left-1/2 top-[10%] h-[80%] w-px -translate-x-1/2 bg-white/8" />
                  <div className="absolute left-[10%] top-1/2 h-px w-[80%] -translate-y-1/2 bg-white/8" />
                  <div className="absolute left-1/2 top-1/2 h-[72px] w-[56px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded border border-white/20 bg-neutral-900 shadow-lg">
                    {sceneReferenceDataUrl ? <img src={sceneReferenceDataUrl} alt="场景中心" className="h-full w-full object-cover" /> : <ImageIcon size={18} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-neutral-600" />}
                  </div>
                  <div
                    className="absolute flex h-9 w-9 items-center justify-center rounded-full border border-cyan-300/50 bg-cyan-300 text-[#071012] shadow-[0_0_20px_rgba(103,232,249,0.24)] transition-[left,top] duration-200"
                    style={{
                      left: `${50 + Math.sin(sceneCamera.rotation * Math.PI / 180) * 36}%`,
                      top: `${50 + Math.cos(sceneCamera.rotation * Math.PI / 180) * 34 - sceneCamera.tilt * 0.45}%`,
                      transform: 'translate(-50%, -50%)',
                    }}
                  >
                    <Camera size={17} />
                  </div>
                </div>

                <div className="min-w-0 space-y-4">
                  <div className="grid grid-cols-4 gap-2">
                    {CAMERA_PRESETS.map((preset) => {
                      const active = preset.value.rotation === sceneCamera.rotation
                        && preset.value.tilt === sceneCamera.tilt
                        && preset.value.zoom === sceneCamera.zoom;
                      return (
                        <button
                          key={preset.label}
                          type="button"
                          className={`h-9 rounded-md border text-xs transition-colors ${active ? 'border-cyan-400/60 bg-cyan-400/10 text-cyan-200' : 'border-white/10 text-neutral-400 hover:border-white/20 hover:text-white'}`}
                          onClick={() => setSceneCamera(preset.value)}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>

                  <p className="text-xs text-cyan-300/80">{describeCameraViewCompact(sceneCamera)}</p>

                  <label className="block">
                    <span className="mb-2 flex items-center justify-between text-xs text-neutral-400"><span>水平旋转</span><span className="font-mono text-cyan-300">{sceneCamera.rotation}°</span></span>
                    <input className="w-full accent-cyan-300" type="range" min="-60" max="60" step="1" value={sceneCamera.rotation} onChange={(event) => setSceneCamera((current) => ({ ...current, rotation: Number(event.target.value) }))} />
                  </label>

                  <label className="block">
                    <span className="mb-2 flex items-center justify-between text-xs text-neutral-400"><span>俯仰角度</span><span className="font-mono text-cyan-300">{sceneCamera.tilt}°</span></span>
                    <input className="w-full accent-cyan-300" type="range" min="-30" max="30" step="1" value={sceneCamera.tilt} onChange={(event) => setSceneCamera((current) => ({ ...current, tilt: Number(event.target.value) }))} />
                  </label>

                  <label className="block">
                    <span className="mb-2 flex items-center justify-between text-xs text-neutral-400"><span>景别</span><span className="text-cyan-300">{sceneCamera.zoom < 34 ? '全景' : sceneCamera.zoom < 67 ? '中景' : '近景'}</span></span>
                    <input className="w-full accent-cyan-300" type="range" min="0" max="100" step="1" value={sceneCamera.zoom} onChange={(event) => setSceneCamera((current) => ({ ...current, zoom: Number(event.target.value) }))} />
                  </label>
                </div>
              </div>
            </div>
            )}

            <label className="block">
              <span className="mb-2 block text-sm text-neutral-300">{sceneSourceMode === 'reference' ? '场景备注（可选）' : '场景名称或地点（可选）'}</span>
              <span className="relative block">
                <MapPin size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" />
                <input
                  className="h-12 w-full rounded-md border border-white/10 bg-[#111516] pl-11 pr-4 text-[15px] text-white outline-none focus:border-cyan-400/60"
                  value={locationName}
                  onChange={(event) => { setLocationName(event.target.value); setPrepareError(''); }}
                  placeholder={sceneSourceMode === 'reference' ? '例如：海边民宿入口（可留空）' : '例如：雨后江南水乡'}
                />
              </span>
              <p className="mt-2 text-xs text-neutral-600">
                {sceneSourceMode === 'reference'
                  ? '可不填写；留空时完全依据参考图片，填写后仅作为理解场景的补充备注。'
                  : '可用于任务识别；留空时会从场景描述中自动提取名称。'}
              </p>
            </label>

            <div>
              <span className="mb-2 block text-sm text-neutral-300">输出比例</span>
              <div className="grid grid-cols-5 gap-2">
                {Object.keys(RATIO_SIZES).map((value) => (
                  <button
                    key={value}
                    className={`h-11 rounded-md border text-sm ${ratio === value ? 'border-cyan-400/70 bg-cyan-400/10 text-cyan-200' : 'border-white/10 text-neutral-400 hover:border-white/20 hover:text-white'}`}
                    onClick={() => setRatio(value)}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center justify-between rounded-md border border-white/8 bg-white/[0.025] px-4 py-4">
              <div>
                <p className="text-sm text-neutral-200">默认制作动态海报</p>
                <p className="mt-1 text-xs text-neutral-500">静态图确认后自动衔接图生视频</p>
              </div>
              <input type="checkbox" checked={dynamicEnabled} onChange={(event) => setDynamicEnabled(event.target.checked)} className="h-4 w-4 accent-cyan-400" />
            </label>

            <details className="group rounded-md border border-white/10 bg-[#111516]">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-4">
                <div>
                  <p className="flex items-center gap-2 text-sm text-neutral-200">
                    <Sparkles size={15} className="text-cyan-300" />
                    场景分析模型
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {sceneAgentConfig.model || '尚未设置模型'} · 用于分析参考图或文字描述并生成三个取景方案
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] ${sceneAgentConfig.apiKey.trim() || sceneAgentConfig.baseUrl.startsWith('/jd-api') ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/5 text-neutral-400'}`}>
                  {sceneAgentConfig.apiKey.trim() ? 'API Key 已配置' : sceneAgentConfig.baseUrl.startsWith('/jd-api') ? '使用内网代理' : '未配置时使用基础方案'}
                </span>
              </summary>

              <div className="grid gap-3 border-t border-white/8 px-4 py-4 md:grid-cols-2">
                <div className="flex items-center justify-between gap-3 rounded-md border border-violet-400/15 bg-violet-400/[0.045] px-3 py-2.5 md:col-span-2">
                  <div>
                    <p className="text-xs font-medium text-violet-100">GPT-5.5 · 京东内网语言模型</p>
                    <p className="mt-1 text-[11px] text-neutral-500">用于场景分析、三个取景方案和提示词优化。</p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-md border border-violet-300/20 px-3 py-1.5 text-[11px] text-violet-200 hover:bg-violet-300/10"
                    onClick={() => setSceneAgentConfig((current) => ({ ...GPT55_PROMPT_AGENT_CONFIG, apiKey: current.apiKey }))}
                  >
                    使用内网预设
                  </button>
                </div>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-neutral-500">模型名称</span>
                  <input
                    className="h-10 w-full rounded-md border border-white/10 bg-black/30 px-3 text-xs text-neutral-200 outline-none focus:border-cyan-400/50"
                    value={sceneAgentConfig.model}
                    onChange={(event) => setSceneAgentConfig((current) => ({ ...current, model: event.target.value }))}
                    placeholder="GPT-5.5-joybuilder"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-neutral-500">API Key</span>
                  <input
                    className="h-10 w-full rounded-md border border-white/10 bg-black/30 px-3 text-xs text-neutral-200 outline-none focus:border-cyan-400/50"
                    type="password"
                    value={sceneAgentConfig.apiKey}
                    onChange={(event) => setSceneAgentConfig((current) => ({ ...current, apiKey: event.target.value }))}
                    placeholder="可留空，由内网代理环境变量提供"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-neutral-500">Base URL</span>
                  <input
                    className="h-10 w-full rounded-md border border-white/10 bg-black/30 px-3 text-xs text-neutral-200 outline-none focus:border-cyan-400/50"
                    value={sceneAgentConfig.baseUrl}
                    onChange={(event) => setSceneAgentConfig((current) => ({ ...current, baseUrl: event.target.value }))}
                    placeholder="/jd-api"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-neutral-500">聊天端点</span>
                  <input
                    className="h-10 w-full rounded-md border border-white/10 bg-black/30 px-3 text-xs text-neutral-200 outline-none focus:border-cyan-400/50"
                    value={sceneAgentConfig.path}
                    onChange={(event) => setSceneAgentConfig((current) => ({ ...current, path: event.target.value }))}
                    placeholder="/v1/chat/completions"
                  />
                </label>
                <p className="text-xs leading-5 text-neutral-600 md:col-span-2">
                  该语言模型负责第一步场景分析，也会供生成区域中的提示词优化使用。内网部署可通过服务端 JD_API_KEY 提供密钥，个人也可以在这里填写并仅保存在当前浏览器；接口不可用时会自动使用三个可编辑的基础方案，不阻塞工作流。
                </p>
              </div>
            </details>
          </div>

          {prepareError && <p className="mt-4 text-sm text-red-400">{prepareError}</p>}
          <div className={`mt-7 grid gap-3 ${project ? 'sm:grid-cols-2' : ''}`}>
            {project && (
              <button
                type="button"
                className="flex h-12 items-center justify-center gap-2 rounded-md border border-cyan-400/35 bg-cyan-400/8 text-sm font-medium text-cyan-200 hover:bg-cyan-400/12"
                onClick={() => goToStage('scene')}
              >
                返回场景生成（保留原方案）
              </button>
            )}
            <button disabled={preparingScene} className="flex h-12 items-center justify-center gap-2 rounded-md bg-white text-sm font-semibold text-black hover:bg-neutral-200 disabled:cursor-wait disabled:opacity-60" onClick={() => void createProject()}>
              {preparingScene
                ? <><LoaderCircle size={16} className="animate-spin" /> {sceneSourceMode === 'prompt' ? '正在分析描述' : '正在分析场景'}</>
                : (project ? '重新分析并覆盖取景方案' : sceneSourceMode === 'prompt' ? '分析描述并进入下一步' : '分析场景并进入下一步')}
            </button>
          </div>
          </div>
          {historyDialog}
        </div>
      </div>
    );
  }

  const activeIndex = Math.max(0, STEPS.findIndex((step) => step.id === project.currentStage));
  const finalPosterAsset = postProcessedAsset || compositeAsset;
  const projectUsesTextScene = project.sceneSourceMode === 'prompt'
    || Boolean(project.sceneConcept && !project.sceneReferenceId);

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#090b0c]">
      <div className="h-[72px] shrink-0 border-b border-white/8 bg-[#0d1010] px-6 flex items-center gap-6">
        <div className="min-w-[190px]">
          <p className="text-sm font-semibold text-white truncate">{project.name}</p>
          <p className="mt-1 text-[11px] text-neutral-500">{project.outputRatio} · {project.outputWidth} x {project.outputHeight} · 自动保存</p>
        </div>
        <div className="flex-1 flex items-center justify-center gap-2">
          {STEPS.map((step, index) => {
            const complete = index < activeIndex;
            const active = index === activeIndex;
            const reachable = step.id === 'setup'
              || step.id === 'scene'
              || (step.id === 'joy' && Boolean(project.selectedSceneId))
              || (step.id === 'static' && Boolean(project.selectedCompositeId))
              || (step.id === 'post' && Boolean(project.selectedCompositeId))
              || (step.id === 'dynamic' && Boolean(project.selectedCompositeId) && project.dynamicEnabled && Boolean(project.postProcessCompleted))
              || (step.id === 'export' && Boolean(project.selectedVideoId || (!project.dynamicEnabled && project.selectedCompositeId && project.postProcessCompleted)));
            return (
              <React.Fragment key={step.id}>
                {index > 0 && <div className={`h-px w-8 ${complete || active ? 'bg-cyan-400/50' : 'bg-white/10'}`} />}
                <button
                  className={`flex items-center gap-2 text-xs ${active ? 'text-white' : complete ? 'text-cyan-300' : 'text-neutral-600'} ${reachable ? 'cursor-pointer' : 'cursor-default'}`}
                  onClick={() => reachable && (step.id === 'setup' ? returnToSetup() : goToStage(step.id))}
                >
                  <span className={`flex h-6 w-6 items-center justify-center rounded-full border text-[10px] ${active ? 'border-cyan-400 bg-cyan-400/10 text-cyan-200' : complete ? 'border-cyan-400/50 text-cyan-300' : 'border-white/10'}`}>
                    {complete ? <Check size={12} /> : String(index + 1).padStart(2, '0')}
                  </span>
                  {step.label}
                </button>
              </React.Fragment>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-white" onClick={() => void openProjectHistory()}>
            <History size={13} /> 历史任务
          </button>
          <button className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-white" onClick={startNewProject}>
            <RotateCcw size={13} /> 新建任务
          </button>
        </div>
      </div>

      {project.currentStage === 'scene' && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div
            className={`min-h-10 shrink-0 border-b px-6 py-2 flex items-center gap-2 text-xs ${project.sceneAnalysisSource === 'fallback' ? 'border-amber-300/10 bg-amber-300/[0.045] text-amber-100/75' : project.sceneAnalysisSource === 'ai' ? 'border-emerald-300/10 bg-emerald-300/[0.04] text-emerald-100/75' : 'border-white/5 bg-cyan-400/[0.035] text-neutral-400'}`}
            title={project.sceneAnalysisSource === 'fallback' ? project.sceneAnalysisError || '语言模型未返回有效结果' : undefined}
          >
            {project.sceneAnalysisSource === 'fallback'
              ? <AlertTriangle size={13} className="shrink-0 text-amber-300" />
              : <Sparkles size={13} className="shrink-0 text-emerald-300" />}
            {project.sceneAnalysisSource === 'fallback'
              ? 'GPT-5.5 分析未成功，当前显示基础兜底方案；可以返回初始设置重新分析'
              : project.sceneAnalysisSource === 'ai'
                ? `${project.sceneAnalysisModel || '语言模型'} 分析成功 · 已生成三个不同画面方案`
                : projectUsesTextScene ? '已根据文字描述生成三个画面方案；选择并微调后即可生图' : '已生成三个不同取景方案；选择并微调后即可生图'}
          </div>
          {projectUsesTextScene || sceneReferenceAsset ? (
            <AIStudio
              workflowProjectId={project.id}
              workflowStage="scene"
              workflowInputAsset={projectUsesTextScene ? undefined : sceneReferenceAsset}
              workflowReferenceImages={projectUsesTextScene ? STYLE_REFERENCE_URLS : [sceneReferenceAsset!.url, ...STYLE_REFERENCE_URLS]}
              workflowReferenceLabels={projectUsesTextScene ? ['固定风格 1', '固定风格 2'] : ['完整场景参考', '固定风格 1', '固定风格 2']}
              workflowRatio={project.outputRatio}
              workflowSize={(SCENE_GENERATION_SIZES[project.outputRatio] || SCENE_GENERATION_SIZES['1:1']).join('x')}
              workflowPrompt={project.sceneDescription || ''}
              workflowPromptOptions={project.sceneDescriptionOptions || []}
              workflowPromptTemplate={buildAtlasPromptTemplate(
                project.locationName || '',
                project.sceneCamera || DEFAULT_CAMERA,
                project.outputRatio,
                projectUsesTextScene ? 'prompt' : 'reference',
                project.sceneConcept || '',
              )}
              onWorkflowPromptChange={updateSceneDescription}
              onSelectResult={selectScene}
            />
          ) : (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-neutral-500">
              <LoaderCircle size={17} className="animate-spin" /> 正在载入场景参考图
            </div>
          )}
        </div>
      )}

      {project.currentStage === 'joy' && (
        <div className="flex-1 min-h-0 flex items-center justify-center p-8">
          <div className="w-full max-w-5xl grid grid-cols-[minmax(0,1fr)_360px] gap-8 items-center">
            <div className="min-h-[520px] flex items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black">
              {sceneAsset ? <img src={sceneAsset.url} alt="场景定稿" className="max-h-[70vh] max-w-full object-contain" /> : <ImageIcon size={42} className="text-neutral-700" />}
            </div>
            <aside className="space-y-5">
              <div>
                <p className="text-xs uppercase text-cyan-300">02 角色植入</p>
                <h3 className="mt-2 text-2xl font-semibold text-white">场景已自动传递</h3>
                <p className="mt-3 text-sm leading-6 text-neutral-500">调整角色动作、表情、位置、相机和灯光。融图完成后可在右侧立即预览并继续制作。</p>
              </div>
              <button disabled={!sceneAsset} className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-white text-sm font-semibold text-black disabled:opacity-40" onClick={() => sceneAsset && onEnterJoy(sceneAsset, project.joyState || null, project.id)}>
                继续角色植入 <ArrowRight size={16} />
              </button>
              <button className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-white/10 text-sm text-neutral-300 hover:bg-white/5" onClick={() => goToStage('scene')}>
                <ArrowLeft size={15} /> 返回更换场景
              </button>
            </aside>
          </div>
        </div>
      )}

      {project.currentStage === 'static' && (
        <div className="flex-1 min-h-0 flex items-center justify-center p-8 overflow-y-auto">
          <div className="w-full max-w-6xl grid grid-cols-[minmax(0,1fr)_360px] gap-8 items-center">
            <div className="min-w-0 space-y-3">
              <div className="min-h-[520px] max-h-[68vh] flex items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black">
                {compositeAsset
                  ? <img src={compositeAsset.url} alt="静态海报定稿" className="max-h-[68vh] max-w-full object-contain" />
                  : <ImageIcon size={42} className="text-neutral-700" />}
              </div>
              <button disabled={!compositeAsset} className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-white text-sm font-semibold text-black hover:bg-neutral-200 disabled:opacity-40" onClick={() => goToStage('post')}>
                确认静态定稿，进入海报后期 <ArrowRight size={16} />
              </button>
              <p className="text-center text-xs leading-5 text-neutral-600">下一步可在本地调整明暗、色彩、曲线和渐变映射，不消耗模型积分。</p>
            </div>
            <aside className="space-y-5">
              <div>
                <p className="text-xs uppercase text-cyan-300">03 静态海报</p>
                <h3 className="mt-2 text-2xl font-semibold text-white">确认静态定稿</h3>
                <p className="mt-3 text-sm leading-6 text-neutral-500">当前结果已与场景和 JOY 参数关联并保存。返回调整时会恢复动作、表情、角度、位置、焦段和灯光。</p>
              </div>
              <button disabled={!sceneAsset} className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-white/10 text-sm text-neutral-200 hover:bg-white/5 disabled:opacity-40" onClick={() => sceneAsset && onEnterJoy(sceneAsset, project.joyState || null, project.id)}>
                <ArrowLeft size={15} /> 返回 JOY 调整
              </button>
            </aside>
          </div>
        </div>
      )}

      {project.currentStage === 'post' && compositeAsset && (
        <PosterPostProcessStage
          key={`${project.id}_${compositeAsset.id}`}
          sourceAsset={compositeAsset}
          projectId={project.id}
          projectName={project.name}
          initialSettings={project.postProcessSettings}
          dynamicEnabled={project.dynamicEnabled}
          onBack={() => goToStage('static')}
          onContinueOriginal={continueWithOriginalPoster}
          onCommit={commitPostProcess}
        />
      )}

      {project.currentStage === 'dynamic' && finalPosterAsset && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="h-10 shrink-0 border-b border-white/5 bg-cyan-400/[0.035] px-6 flex items-center gap-2 text-xs text-neutral-400">
            <Film size={13} className="text-cyan-300" /> {postProcessedAsset ? '后期版本' : '原始静态定稿'}已自动设为帧素材，可选择单图生视频或首尾帧。生成后选择一个视频即可进入导出。
          </div>
          <AIStudio
            workflowProjectId={project.id}
            workflowStage="dynamic"
            workflowInputAsset={finalPosterAsset}
            workflowRatio={project.outputRatio}
            workflowSize={(DYNAMIC_RATIO_SIZES[project.outputRatio] || [project.outputWidth, project.outputHeight]).join('x')}
            workflowPrompt={`保持角色形象、服装、场景构图和镜头角度一致，角色自然${String(project.joyState?.pose || '做轻微待机动作')}，动作幅度克制，环境产生细微动态，画面稳定，无镜头突变。`}
            onSelectResult={selectDynamicVideo}
          />
        </div>
      )}

      {project.currentStage === 'export' && (
        <div className="flex-1 min-h-0 flex items-center justify-center overflow-y-auto p-8">
          <div className="w-full max-w-6xl grid grid-cols-[minmax(0,1fr)_360px] gap-8 items-center">
            <div className="min-h-[560px] max-h-[76vh] flex items-center justify-center overflow-hidden rounded-lg border border-white/10 bg-black">
              {videoAsset
                ? <video src={videoAsset.url} controls autoPlay loop className="max-h-[76vh] max-w-full object-contain" />
                : finalPosterAsset
                  ? <img src={finalPosterAsset.url} alt="海报导出预览" className="max-h-[76vh] max-w-full object-contain" />
                  : <ImageIcon size={42} className="text-neutral-700" />}
            </div>
            <aside className="space-y-5">
              <div>
                <p className="text-xs uppercase text-cyan-300">05 导出</p>
                <h3 className="mt-2 text-2xl font-semibold text-white">角色海报任务已完成</h3>
                <p className="mt-3 text-sm leading-6 text-neutral-500">当前定稿已经保存在素材仓库，并保留场景、JOY 状态和生成关系，可随时返回上一步继续调整。</p>
              </div>
              <button disabled={!videoAsset && !finalPosterAsset} className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-white text-sm font-semibold text-black hover:bg-neutral-200 disabled:opacity-40" onClick={() => downloadOutput(videoAsset || finalPosterAsset)}>
                <Download size={16} /> 下载{videoAsset ? '动态' : '静态'}海报
              </button>
              <button className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-white/10 text-sm text-neutral-200 hover:bg-white/5" onClick={() => goToStage(videoAsset ? 'dynamic' : 'post')}>
                <ArrowLeft size={15} /> 返回上一步
              </button>
              <p className="text-xs leading-5 text-emerald-400/80">已存入仓库 · 与任务 {project.name} 关联</p>
            </aside>
          </div>
        </div>
      )}
      {historyDialog}
    </div>
  );
};
