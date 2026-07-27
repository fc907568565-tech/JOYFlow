import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Camera, Check, Crop, Download, Film, History, Image as ImageIcon, LoaderCircle, MapPin, RotateCcw, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { AIStudio } from './AIStudio';
import { addToLibrary, loadLibrary, type LibraryAsset } from '../utils/assetLibrary';
import { BUILT_IN_PRESETS } from '../ai/presets';
import {
  describeAtlasSceneOptions,
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
  type AtlasSceneStrategy,
  type AtlasStage,
} from '../utils/atlasWorkflow';

interface AtlasWorkspaceProps {
  revision?: number;
  onEnterJoy: (asset: LibraryAsset, joyState: Record<string, unknown> | null, projectId: string) => void;
}

const STEPS: Array<{ id: AtlasStage; label: string }> = [
  { id: 'scene', label: '场景生成' },
  { id: 'joy', label: 'JOY 编排' },
  { id: 'static', label: '静态图鉴' },
  { id: 'dynamic', label: '动态图鉴' },
  { id: 'export', label: '导出' },
];

const RATIO_SIZES: Record<string, [number, number]> = {
  '16:9': [1280, 720],
  '4:3': [1112, 834],
  '1:1': [1024, 1024],
  '3:4': [834, 1112],
  '9:16': [720, 1280],
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

const buildAtlasPromptTemplate = (locationName: string, camera: AtlasCameraView = DEFAULT_CAMERA) => ({
  prefix: `生成一张卡通游戏海报，场景为【${locationName}】。第1张图片是完整场景参考，是场景身份、建筑结构、景物关系和空间布局的最高优先级依据；结果必须明确表现同一个地点。目标摄像机视角为：${describeCameraView(camera)}。请依据该参数推演同一场景的新机位画面，而不是复刻原照片构图。允许在原拍摄位置附近前移、侧移或转动镜头，但不得改造建筑、移动或替换景物、交换空间关系、加入新地标，或重新组合成另一个场景。未展示区域只做符合原结构的保守延伸。第2、3张图片只用于参考3D卡通拟物的视觉风格，不参考其中的场景内容、人物、文字和构图。3D哑光质感，C4D，blender，Q萌，圆润，简洁造型，色彩清新，高饱和度，细腻材质，柔和自然光影。具体取景为：`,
  suffix: '。严格保留原参考照片的场景辨识度、建筑特征和景物空间关系。以场景本身的美感、视觉重心、构图节奏和层次完整为最高优先，不要为了后续角色刻意制造大片空地或留白。高清简洁，色彩搭配高级简约。不要出现文字、Logo或水印。比例3:4',
});

const buildFallbackSceneOptions = (
  locationName: string,
  strategy: AtlasSceneStrategy,
  camera: AtlasCameraView,
) => {
  const location = locationName.trim() || '参考场景';
  const view = describeCameraViewCompact(camera);
  const strategyText = strategy === 'recompose'
    ? '从原拍摄点附近轻微侧移'
    : strategy === 'landmark'
      ? '靠近最具辨识度的主体'
      : '基本保持原照片方向并适度推进';
  return [
    `以${location}的主要建筑或地标为主体，${strategyText}，采用${view}，保留真实前中后景关系与自然光线，视觉重心落在场景最具辨识度的位置。`,
    `完整呈现${location}的主体轮廓，前景承接原有道路或自然景物，中景突出建筑空间，远景保留环境层次，采用${view}，构图清晰舒展。`,
    `围绕${location}建立层次分明的取景，严格沿用参考图中的建筑、树木和道路关系，使用${view}，以主体和周围环境的呼应作为视觉重点。`,
  ];
};

export const AtlasWorkspace: React.FC<AtlasWorkspaceProps> = ({ revision = 0, onEnterJoy }) => {
  const [project, setProject] = useState<AtlasProject | null>(() => loadActiveAtlasProject());
  const [projectName, setProjectName] = useState('');
  const [ratio, setRatio] = useState('3:4');
  const [dynamicEnabled, setDynamicEnabled] = useState(true);
  const [locationName, setLocationName] = useState('');
  const [sceneReferenceDataUrl, setSceneReferenceDataUrl] = useState('');
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
      setVideoAsset(project.selectedVideoId
        ? assets.find((asset) => asset.id === project.selectedVideoId) || null
        : null);
    });
    return () => { cancelled = true; };
  }, [project?.sceneReferenceId, project?.selectedSceneId, project?.selectedCompositeId, project?.selectedVideoId]);

  useEffect(() => {
    if (!project || project.currentStage !== 'setup') return;
    setProjectName(project.name || '');
    setLocationName(project.locationName || '');
    setRatio(project.outputRatio || '3:4');
    setDynamicEnabled(project.dynamicEnabled);
    setSceneCrop(project.sceneCrop || DEFAULT_CROP);
    setSceneCamera(project.sceneCamera || DEFAULT_CAMERA);
    setPrepareError('');
  }, [project?.id, project?.currentStage]);

  const createProject = async () => {
    if (!sceneReferenceDataUrl) {
      setPrepareError('请先上传一张场景参考图');
      return;
    }
    if (!locationName.trim()) {
      setPrepareError('请输入场景选址地名');
      return;
    }
    setPreparingScene(true);
    setPrepareError('');
    const [outputWidth, outputHeight] = RATIO_SIZES[ratio] || RATIO_SIZES['1:1'];
    try {
      const seedreamConfig = BUILT_IN_PRESETS.find((preset) => preset.id === '__doubao_seedream__')?.config;
      if (!seedreamConfig) throw new Error('未找到 Seedream 模型配置');
      const croppedReference = await cropImageDataUrl(sceneReferenceDataUrl, sceneCrop);
      const sceneStrategy = resolveSceneStrategy(sceneCamera);
      let sceneDescriptionOptions: string[];
      try {
        if (!sceneAgentConfig.apiKey.trim()) throw new Error('未配置场景分析 API Key');
        sceneDescriptionOptions = await describeAtlasSceneOptions(
          sceneAgentConfig,
          seedreamConfig,
          croppedReference,
          locationName,
          sceneStrategy,
          sceneCamera,
        );
      } catch (analysisError) {
        console.warn('[Atlas] 场景 AI 分析不可用，使用本地基础方案继续：', analysisError);
        sceneDescriptionOptions = buildFallbackSceneOptions(locationName, sceneStrategy, sceneCamera);
      }
      const sceneDescription = sceneDescriptionOptions[0] || '';
      const baseProject = project?.currentStage === 'setup'
        ? saveActiveAtlasProject({
          ...project,
          name: projectName.trim() || project.name,
          currentStage: 'scene',
          locationName: locationName.trim(),
          sceneDescription,
          sceneDescriptionOptions,
          sceneStrategy,
          sceneCrop,
          sceneCamera,
          outputRatio: ratio,
          outputWidth,
          outputHeight,
          dynamicEnabled,
          selectedSceneId: undefined,
          selectedCompositeId: undefined,
          selectedVideoId: undefined,
          joyState: undefined,
        })
        : createAtlasProject({
          name: projectName,
          outputRatio: ratio,
          outputWidth,
          outputHeight,
          dynamicEnabled,
          locationName,
          sceneDescription,
          sceneDescriptionOptions,
          sceneStrategy,
          sceneCrop,
          sceneCamera,
        });
      const referenceAsset = sceneReferenceAsset?.url === sceneReferenceDataUrl
        ? sceneReferenceAsset
        : await addToLibrary({
          url: sceneReferenceDataUrl,
          type: 'image',
          prompt: `${locationName.trim()} 完整场景参考图`,
          thumbnail: sceneReferenceDataUrl,
          projectId: baseProject.id,
          workflowId: baseProject.id,
          stage: 'reference',
          selected: true,
          status: 'approved',
          tags: ['图鉴场景参考', 'image-to-image', sceneStrategy],
        });
      const next = saveActiveAtlasProject({ ...baseProject, sceneReferenceId: referenceAsset.id });
      setSceneReferenceAsset(referenceAsset);
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
      selectedVideoId: undefined,
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

  const goToStage = (stage: AtlasStage) => {
    if (!project) return;
    if (
      stage === 'scene' ||
      (stage === 'joy' && project.selectedSceneId) ||
      (stage === 'static' && project.selectedCompositeId) ||
      (stage === 'dynamic' && project.selectedCompositeId && project.dynamicEnabled) ||
      (stage === 'export' && (project.selectedVideoId || (!project.dynamicEnabled && project.selectedCompositeId)))
    ) {
      setProject(saveActiveAtlasProject({ ...project, currentStage: stage }));
    }
  };

  const returnToSetup = () => {
    if (!project) return;
    setProjectName(project.name || '');
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
    setVideoAsset(null);
    setProjectName('');
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
      const assetId = item.selectedVideoId || item.selectedCompositeId || item.selectedSceneId || item.sceneReferenceId;
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
    setVideoAsset(null);
    setProjectName('');
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
                      <p className="mt-1 text-xs text-neutral-500">{item.locationName || '未填写场景地点'}</p>
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
      <div className="flex-1 overflow-y-auto bg-[#090b0c] px-6 py-10">
        <div className="mx-auto max-w-3xl">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-white/10 bg-white/5">
              <BookOpen size={21} className="text-cyan-300" />
            </div>
            <div>
              <h2 className="text-2xl font-semibold text-white">{project ? '调整图鉴任务' : '创建图鉴任务'}</h2>
              <p className="mt-1 text-sm text-neutral-500">{project ? '当前任务信息已保留，调整后重新分析场景' : '设置一次，后续素材和步骤自动传递'}</p>
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
                placeholder="例如：JOY 夏日露营图鉴"
              />
            </label>

            <div>
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
              <div className="relative flex min-h-52 w-full items-center justify-center overflow-hidden rounded-md border border-dashed border-white/15 bg-[#111516]">
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
                    <span className="text-sm text-neutral-300">上传实景或构图参考图</span>
                  </button>
                )}
                {sceneReferenceDataUrl && <button type="button" className="absolute right-3 top-3 z-30 rounded-md bg-black/75 px-3 py-2 text-xs text-white hover:bg-black" onClick={() => sceneReferenceInputRef.current?.click()}>重新选择</button>}
              </div>
              {sceneReferenceDataUrl && <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-500"><Crop size={13} /> 拖拽框内可移动取景区域，拖拽边框或角点可调整大小；在框外拖拽可重新框选</p>}
            </div>

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

            <label className="block">
              <span className="mb-2 block text-sm text-neutral-300">场景选址</span>
              <span className="relative block">
                <MapPin size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500" />
                <input
                  className="h-12 w-full rounded-md border border-white/10 bg-[#111516] pl-11 pr-4 text-[15px] text-white outline-none focus:border-cyan-400/60"
                  value={locationName}
                  onChange={(event) => { setLocationName(event.target.value); setPrepareError(''); }}
                  placeholder="例如：广州沙面岛汇丰银行一角"
                />
              </span>
              <p className="mt-2 text-xs text-neutral-600">下一步会根据图片生成一段简短场景描述，可继续修改。</p>
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
                <p className="text-sm text-neutral-200">默认制作动态图鉴</p>
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
                    {sceneAgentConfig.model || '尚未设置模型'} · 用于识别参考图并生成三个取景方案
                  </p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-[11px] ${sceneAgentConfig.apiKey.trim() ? 'bg-emerald-400/10 text-emerald-300' : 'bg-white/5 text-neutral-400'}`}>
                  {sceneAgentConfig.apiKey.trim() ? 'API Key 已配置' : '未配置时使用基础方案'}
                </span>
              </summary>

              <div className="grid gap-3 border-t border-white/8 px-4 py-4 md:grid-cols-2">
                <label className="block">
                  <span className="mb-1.5 block text-xs text-neutral-500">模型名称</span>
                  <input
                    className="h-10 w-full rounded-md border border-white/10 bg-black/30 px-3 text-xs text-neutral-200 outline-none focus:border-cyan-400/50"
                    value={sceneAgentConfig.model}
                    onChange={(event) => setSceneAgentConfig((current) => ({ ...current, model: event.target.value }))}
                    placeholder="doubao-seed-2-0-lite-260428"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-neutral-500">API Key</span>
                  <input
                    className="h-10 w-full rounded-md border border-white/10 bg-black/30 px-3 text-xs text-neutral-200 outline-none focus:border-cyan-400/50"
                    type="password"
                    value={sceneAgentConfig.apiKey}
                    onChange={(event) => setSceneAgentConfig((current) => ({ ...current, apiKey: event.target.value }))}
                    placeholder="填写用于场景分析的 Ark API Key"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-neutral-500">Base URL</span>
                  <input
                    className="h-10 w-full rounded-md border border-white/10 bg-black/30 px-3 text-xs text-neutral-200 outline-none focus:border-cyan-400/50"
                    value={sceneAgentConfig.baseUrl}
                    onChange={(event) => setSceneAgentConfig((current) => ({ ...current, baseUrl: event.target.value }))}
                    placeholder="/ark-api"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-neutral-500">聊天端点</span>
                  <input
                    className="h-10 w-full rounded-md border border-white/10 bg-black/30 px-3 text-xs text-neutral-200 outline-none focus:border-cyan-400/50"
                    value={sceneAgentConfig.path}
                    onChange={(event) => setSceneAgentConfig((current) => ({ ...current, path: event.target.value }))}
                    placeholder="/api/v3/responses"
                  />
                </label>
                <p className="text-xs leading-5 text-neutral-600 md:col-span-2">
                  这里的配置只负责第一步“分析场景”。如果 Key 或接口不可用，会自动使用三个可编辑的基础方案继续，不会阻塞工作流；下一步生成场景图片仍使用图片生成区域选择的 Seedream 等模型。
                </p>
              </div>
            </details>
          </div>

          {prepareError && <p className="mt-4 text-sm text-red-400">{prepareError}</p>}
          <button disabled={preparingScene} className="mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-white text-sm font-semibold text-black hover:bg-neutral-200 disabled:cursor-wait disabled:opacity-60" onClick={() => void createProject()}>
            {preparingScene ? <><LoaderCircle size={16} className="animate-spin" /> 正在分析场景</> : <>{project ? '保存调整并重新分析' : '分析场景并进入下一步'} <ArrowRight size={16} /></>}
          </button>
        </div>
        {historyDialog}
      </div>
    );
  }

  const activeIndex = Math.max(0, STEPS.findIndex((step) => step.id === project.currentStage));

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
            const reachable = step.id === 'scene'
              || (step.id === 'joy' && Boolean(project.selectedSceneId))
              || (step.id === 'static' && Boolean(project.selectedCompositeId))
              || (step.id === 'dynamic' && Boolean(project.selectedCompositeId) && project.dynamicEnabled)
              || (step.id === 'export' && Boolean(project.selectedVideoId || (!project.dynamicEnabled && project.selectedCompositeId)));
            return (
              <React.Fragment key={step.id}>
                {index > 0 && <div className={`h-px w-8 ${complete || active ? 'bg-cyan-400/50' : 'bg-white/10'}`} />}
                <button
                  className={`flex items-center gap-2 text-xs ${active ? 'text-white' : complete ? 'text-cyan-300' : 'text-neutral-600'} ${reachable ? 'cursor-pointer' : 'cursor-default'}`}
                  onClick={() => reachable && goToStage(step.id)}
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
          <button className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-white" onClick={returnToSetup} title="返回上传场景参考图与任务设置">
            <ArrowLeft size={13} /> 返回初始步骤
          </button>
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
          <div className="h-10 shrink-0 border-b border-white/5 bg-cyan-400/[0.035] px-6 flex items-center gap-2 text-xs text-neutral-400">
            <Sparkles size={13} className="text-cyan-300" /> 已生成三个不同取景方案；选择并微调后即可生图
          </div>
          {sceneReferenceAsset ? (
            <AIStudio
              workflowProjectId={project.id}
              workflowStage="scene"
              workflowInputAsset={sceneReferenceAsset}
              workflowReferenceImages={[sceneReferenceAsset.url, ...STYLE_REFERENCE_URLS]}
              workflowReferenceLabels={['完整场景参考', '固定风格 1', '固定风格 2']}
              workflowRatio={project.outputRatio}
              workflowSize="2K"
              workflowPrompt={project.sceneDescription || ''}
              workflowPromptOptions={project.sceneDescriptionOptions || []}
              workflowPromptTemplate={buildAtlasPromptTemplate(project.locationName || '', project.sceneCamera || DEFAULT_CAMERA)}
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
                <p className="text-xs uppercase text-cyan-300">02 JOY 编排</p>
                <h3 className="mt-2 text-2xl font-semibold text-white">场景已自动传递</h3>
                <p className="mt-3 text-sm leading-6 text-neutral-500">调整角色动作、表情、位置、相机和灯光。所有 Capture 结果会自动保存到仓库。</p>
              </div>
              <button disabled={!sceneAsset} className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-white text-sm font-semibold text-black disabled:opacity-40" onClick={() => sceneAsset && onEnterJoy(sceneAsset, project.joyState || null, project.id)}>
                继续 JOY 编排 <ArrowRight size={16} />
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
                  ? <img src={compositeAsset.url} alt="静态图鉴定稿" className="max-h-[68vh] max-w-full object-contain" />
                  : <ImageIcon size={42} className="text-neutral-700" />}
              </div>
              <button disabled={!compositeAsset} className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-white text-sm font-semibold text-black hover:bg-neutral-200 disabled:opacity-40" onClick={() => goToStage(project.dynamicEnabled ? 'dynamic' : 'export')}>
                {project.dynamicEnabled ? '保存并制作动态图鉴' : '保存并进入导出'} <ArrowRight size={16} />
              </button>
              <p className="text-center text-xs leading-5 text-neutral-600">{project.dynamicEnabled ? '当前图片会自动保存并成为图生视频首帧。' : '当前任务未启用动态版本，将保存静态图鉴并进入导出。'}</p>
            </div>
            <aside className="space-y-5">
              <div>
                <p className="text-xs uppercase text-cyan-300">03 静态图鉴</p>
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

      {project.currentStage === 'dynamic' && compositeAsset && (
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="h-10 shrink-0 border-b border-white/5 bg-cyan-400/[0.035] px-6 flex items-center gap-2 text-xs text-neutral-400">
            <Film size={13} className="text-cyan-300" /> 静态定稿已自动设为首帧。生成后选择一个视频即可进入导出。
          </div>
          <AIStudio
            workflowProjectId={project.id}
            workflowStage="dynamic"
            workflowInputAsset={compositeAsset}
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
                : compositeAsset
                  ? <img src={compositeAsset.url} alt="图鉴导出预览" className="max-h-[76vh] max-w-full object-contain" />
                  : <ImageIcon size={42} className="text-neutral-700" />}
            </div>
            <aside className="space-y-5">
              <div>
                <p className="text-xs uppercase text-cyan-300">05 导出</p>
                <h3 className="mt-2 text-2xl font-semibold text-white">图鉴任务已完成</h3>
                <p className="mt-3 text-sm leading-6 text-neutral-500">当前定稿已经保存在素材仓库，并保留场景、JOY 状态和生成关系，可随时返回上一步继续调整。</p>
              </div>
              <button disabled={!videoAsset && !compositeAsset} className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-white text-sm font-semibold text-black hover:bg-neutral-200 disabled:opacity-40" onClick={() => downloadOutput(videoAsset || compositeAsset)}>
                <Download size={16} /> 下载{videoAsset ? '动态' : '静态'}图鉴
              </button>
              <button className="flex h-11 w-full items-center justify-center gap-2 rounded-md border border-white/10 text-sm text-neutral-200 hover:bg-white/5" onClick={() => goToStage(videoAsset ? 'dynamic' : 'static')}>
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
