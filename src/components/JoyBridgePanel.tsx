import React, { useEffect, useRef, useState } from 'react';
import { Aperture, Bone, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ExternalLink, Images, KeyRound, Maximize2, Minimize2, Palette, Plus, RefreshCw, RotateCcw, Shirt, Sparkles, Sun, WandSparkles, WifiOff, X } from 'lucide-react';
import { AssetLibrary } from './AssetLibrary';
import { addToLibrary, loadLibrary, type LibraryAsset } from '../utils/assetLibrary';

interface JoyBridgePanelProps {
  open: boolean;
  onClose: () => void;
  onAddCapture: (dataUrl: string) => void;
  initialBackground?: LibraryAsset | null;
  initialState?: JoyState | null;
  workflowProjectId?: string | null;
  onStateChange?: (state: JoyState) => void;
  onWorkflowResult?: (asset: LibraryAsset, destination?: 'static' | 'dynamic') => void;
}

interface JoyTransform {
  scale: number;
  yaw: number;
  pitch: number;
  roll: number;
  x: number;
  y: number;
}

interface JoyLight {
  exposure: number;
  ambient: number;
  shadowOpacity: number;
  shadowX: number;
  shadowY: number;
  shadowSize: number;
  shadowBlur: number;
  shadowEnabled: boolean;
  toneMatch: boolean;
}

interface JoyCamera {
  focalLength: number;
}

interface JoyBoneTransform {
  q: number[];
  p: number[];
  s: number[];
}

export interface JoyState {
  pose?: string | null;
  face?: string | null;
  hasBackground?: boolean;
  transform?: Partial<JoyTransform>;
  light?: Partial<JoyLight>;
  camera?: Partial<JoyCamera>;
  boneDetail?: 'basic' | 'full';
  bonePose?: Record<string, JoyBoneTransform> | null;
}

interface JoyCapabilities {
  poses: string[];
  faces: Array<{ label: string; value: string }>;
}

type JoyApiMode = 'proxy' | 'user';

interface JoyGenerationConfig {
  prompt: string;
  mode: JoyApiMode;
  name: string;
  endpoint: string;
  model: string;
  imgModel: string;
  hasKey: boolean;
  activeName: string;
  configured: boolean;
}

interface JoyApiDraft extends Omit<JoyGenerationConfig, 'hasKey' | 'activeName' | 'configured' | 'prompt'> {
  key: string;
}

type JoyImagePresetId = 'gpt-image-2' | 'gemini-3-pro';

interface JoyImagePreset {
  id: JoyImagePresetId;
  label: string;
  description: string;
  name: string;
  endpoint: string;
  model: string;
  imgModel: string;
}

type JoyGearCategory = 'head' | 'neck' | 'body' | 'feet';

interface JoyGearTune {
  x: number;
  y: number;
  z: number;
  scale: number;
  rx: number;
  ry: number;
  rz: number;
  px: number;
  py: number;
  pz: number;
  color: string;
}

interface JoyGearState {
  category: JoyGearCategory;
  categories: JoyGearCategory[];
  items: Array<{ id: string; name: string }>;
  selectedId: string;
  activeByCategory: Partial<Record<JoyGearCategory, string>>;
  tuneEnabled: boolean;
  tune: JoyGearTune;
  parts: Array<{ name: string; color: string }>;
}

interface JoyBoneEditorState {
  active: boolean;
  mode: 'joint' | 'overall';
  detail: 'basic' | 'full';
  axis: 'x' | 'y' | 'z';
  value: number;
  canRotate: boolean;
  title: string;
}

const JOY_INTERNAL_URL = 'https://5r0lrpa77tvw.joyapp.jd.com/compose.html';
// 本地开发与京东 JoyCode 部署都使用增强桥接，确保角色植入始终进入
// JOYFlow 定制的编辑流程；其他公开部署仍由内网浏览器直接访问 JOY。
const USE_ENHANCED_JOY_BRIDGE = import.meta.env.DEV
  || window.location.hostname.endsWith('.joyapp.jd.com');
const JOY_URL = USE_ENHANCED_JOY_BRIDGE ? '/joy-compose' : JOY_INTERNAL_URL;
const getJoyMessageOrigin = () => new URL(JOY_URL, window.location.href).origin;

const FALLBACK_POSES = [
  '静止', 'wink', '伸懒腰', '呼吸', '坐下', '失落', '害羞', '左右摇摆', '左顾右盼', '思考',
  '惊讶', '打哈欠', '打招呼', '抖耳朵', '摇头', '摇尾巴', '撒娇', '歪头卖萌', '点头', '生气',
  '疑惑', '走路', '跳舞', '跳跃', '蹦跑', '转圈', '难过', '鞠躬', '坐地看景',
];

const FALLBACK_FACES = [
  '01微笑', '02大笑', '03脸红', '04眨单眼大笑', '05眨眼大笑', '06小开心', '07美味', '08眨眼',
  '09眯眼美味', '10星星眼', '11嘟嘴', '12嘟嘴眨眼', '13嘟嘴眯眼', '14眯眼微笑', '15无奈',
  '16嘟嘴困', '17咀嚼', '18愉悦', '19亲亲', '20歪嘴哼', '21爱心眼', '22呆住', '23困',
  '24难过', '25生气',
].map((value) => ({ label: value.replace(/^\d+/, ''), value }));

const DEFAULT_TRANSFORM: JoyTransform = { scale: 1, yaw: 0, pitch: 0, roll: 0, x: 0, y: 0 };
const DEFAULT_CAMERA: JoyCamera = { focalLength: 85 };
const DEFAULT_GENERATION_PROMPT = '把3D角色自然融入环境，严格保持角色比例和轮廓，光影、质感和投影与环境匹配，保留原始构图和主体位置。';
const JOY_IMAGE_PRESETS: Record<JoyImagePresetId, JoyImagePreset> = {
  'gpt-image-2': {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    description: '写实光影·融合稳定',
    name: 'JD GPT Image 2',
    endpoint: 'http://llm-gw.jd.local/v1',
    model: 'GPT-5.5-joybuilder',
    imgModel: 'GPT-image-2-joybuilder',
  },
  'gemini-3-pro': {
    id: 'gemini-3-pro',
    label: 'Gemini 3 Pro',
    description: '创意构图·细节更多',
    name: 'JD Gemini 3 Pro Image',
    endpoint: 'http://llm-gw.jd.local/v1',
    model: 'GPT-5.5-joybuilder',
    imgModel: 'Gemini-3-Pro-Image-Preview-joybuilder',
  },
};
const DEFAULT_JOY_IMAGE_PRESET_ID: JoyImagePresetId = 'gpt-image-2';
const DEFAULT_JOY_IMAGE_PRESET = JOY_IMAGE_PRESETS[DEFAULT_JOY_IMAGE_PRESET_ID];
const resolveJoyImagePresetId = (model: string): JoyImagePresetId => (/gemini/i.test(model) ? 'gemini-3-pro' : 'gpt-image-2');
const DEFAULT_GENERATION_CONFIG: JoyGenerationConfig = {
  prompt: DEFAULT_GENERATION_PROMPT,
  mode: 'user',
  name: DEFAULT_JOY_IMAGE_PRESET.name,
  endpoint: DEFAULT_JOY_IMAGE_PRESET.endpoint,
  model: DEFAULT_JOY_IMAGE_PRESET.model,
  imgModel: DEFAULT_JOY_IMAGE_PRESET.imgModel,
  hasKey: false,
  activeName: DEFAULT_JOY_IMAGE_PRESET.name,
  configured: false,
};
const DEFAULT_GEAR_TUNE: JoyGearTune = { x: 0, y: 0, z: 0, scale: 80, rx: 0, ry: 0, rz: 0, px: 0, py: 0, pz: 0, color: '#ffffff' };
const DEFAULT_GEAR_STATE: JoyGearState = {
  category: 'neck',
  categories: ['head', 'neck', 'body', 'feet'],
  items: [{ id: '__none__', name: '无' }],
  selectedId: '__none__',
  activeByCategory: {},
  tuneEnabled: false,
  tune: DEFAULT_GEAR_TUNE,
  parts: [],
};
const DEFAULT_BONE_EDITOR_STATE: JoyBoneEditorState = {
  active: false,
  mode: 'joint',
  detail: 'basic',
  axis: 'z',
  value: 0,
  canRotate: false,
  title: '先选择一个关节',
};
const DEFAULT_LIGHT: JoyLight = {
  exposure: 1.15,
  ambient: 1.5,
  shadowOpacity: 0.32,
  shadowX: 0,
  shadowY: 0,
  shadowSize: 1,
  shadowBlur: 60,
  shadowEnabled: true,
  toneMatch: true,
};

const TRANSFORM_CONTROLS = [
  ['scale', '缩放', 0.05, 3, 0.01],
  ['yaw', '左右角度', -180, 180, 1],
  ['pitch', '俯仰角度', -180, 180, 1],
  ['roll', '整体侧倾', -180, 180, 1],
  ['x', '水平位置', -4, 4, 0.01],
  ['y', '垂直位置', -4, 4, 0.01],
] as const;

const POSITION_RANGE = 4;
const POSITION_SNAP_VALUE = 2.8;
const POSITION_SNAPS = [
  { x: -POSITION_SNAP_VALUE, y: POSITION_SNAP_VALUE, label: '左上' },
  { x: 0, y: POSITION_SNAP_VALUE, label: '中上' },
  { x: POSITION_SNAP_VALUE, y: POSITION_SNAP_VALUE, label: '右上' },
  { x: -POSITION_SNAP_VALUE, y: 0, label: '左中' },
  { x: 0, y: 0, label: '居中' },
  { x: POSITION_SNAP_VALUE, y: 0, label: '右中' },
  { x: -POSITION_SNAP_VALUE, y: -POSITION_SNAP_VALUE, label: '左下' },
  { x: 0, y: -POSITION_SNAP_VALUE, label: '中下' },
  { x: POSITION_SNAP_VALUE, y: -POSITION_SNAP_VALUE, label: '右下' },
] as const;

const LIGHT_CONTROLS = [
  ['exposure', '曝光', 0.4, 1.8, 0.05],
  ['ambient', '环境光', 0, 2.5, 0.05],
  ['shadowOpacity', '阴影透明度', 0, 0.7, 0.02],
  ['shadowX', '阴影水平位置', -2, 2, 0.01],
  ['shadowY', '阴影垂直位置', -2, 2, 0.01],
  ['shadowSize', '阴影大小', 0.4, 2.5, 0.05],
  ['shadowBlur', '阴影模糊', 0, 100, 1],
] as const;

const formatValue = (value: number, step: number) => step >= 1 ? Math.round(value) : value.toFixed(2);

const persistLibraryAsset = async (asset: Omit<LibraryAsset, 'id' | 'createdAt'>) => {
  const library = await loadLibrary();
  const existing = library.find((item) => item.sourceUrl === asset.url || item.url === asset.url);
  if (existing) return existing;
  return addToLibrary(asset);
};

const toDownloadableUrl = (url: string) => {
  if (url.startsWith('data:') || url.startsWith('blob:')) return url;
  try {
    const parsed = new URL(url, window.location.href);
    if (parsed.origin === window.location.origin) return parsed.href;
    return `/remote-asset?u=${encodeURIComponent(parsed.href)}`;
  } catch {
    return url;
  }
};

const downloadJoyAsset = async (url: string) => {
  let downloadUrl = toDownloadableUrl(url);
  if (!url.startsWith('data:') && !url.startsWith('blob:')) {
    const parsed = new URL(url, window.location.href);
    downloadUrl = parsed.origin === window.location.origin
      ? parsed.href
      : `/download-asset?u=${encodeURIComponent(parsed.href)}`;
  }
  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = `joy-image-${Date.now()}.png`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
};

export const JoyBridgePanel: React.FC<JoyBridgePanelProps> = ({
  open,
  onClose,
  onAddCapture,
  initialBackground,
  initialState,
  workflowProjectId,
  onStateChange,
  onWorkflowResult,
}) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const captureIdRef = useRef<string | null>(null);
  const savedMessageIdsRef = useRef<Set<string>>(new Set());
  const latestJoyStateRef = useRef<JoyState | null>(initialState || null);
  const initialStateRef = useRef<JoyState | null>(initialState || null);
  const initialStateAppliedRef = useRef(false);
  const lastStateSignatureRef = useRef('');
  const onStateChangeRef = useRef(onStateChange);
  const onWorkflowResultRef = useRef(onWorkflowResult);
  const workflowProjectIdRef = useRef(workflowProjectId);
  const latestWorkflowAssetRef = useRef<LibraryAsset | null>(null);
  const apiSaveRequestIdRef = useRef<string | null>(null);
  const modelSaveRequestIdRef = useRef<string | null>(null);
  const pendingImagePresetIdRef = useRef<JoyImagePresetId | null>(null);
  const [ready, setReady] = useState(false);
  const [connectionTimedOut, setConnectionTimedOut] = useState(false);
  const [capture, setCapture] = useState<string | null>(null);
  const [captureTransparent, setCaptureTransparent] = useState(true);
  const [captureSaved, setCaptureSaved] = useState(false);
  const [captureSaveError, setCaptureSaveError] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [hasBackground, setHasBackground] = useState(false);
  const [backgroundLibraryOpen, setBackgroundLibraryOpen] = useState(false);
  const [selectedPose, setSelectedPose] = useState<string | null>(null);
  const [selectedFace, setSelectedFace] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<JoyCapabilities>({
    poses: FALLBACK_POSES,
    faces: FALLBACK_FACES,
  });
  const [transform, setTransform] = useState<JoyTransform>(DEFAULT_TRANSFORM);
  const [light, setLight] = useState<JoyLight>(DEFAULT_LIGHT);
  const [camera, setCamera] = useState<JoyCamera>(DEFAULT_CAMERA);
  const [latestWorkflowAsset, setLatestWorkflowAsset] = useState<LibraryAsset | null>(null);
  const [resultPreviewOpen, setResultPreviewOpen] = useState(false);
  const [panelWidth, setPanelWidth] = useState(360);
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false);
  const [generationConfig, setGenerationConfig] = useState<JoyGenerationConfig>(DEFAULT_GENERATION_CONFIG);
  const [selectedImagePresetId, setSelectedImagePresetId] = useState<JoyImagePresetId>(DEFAULT_JOY_IMAGE_PRESET_ID);
  const [modelSwitching, setModelSwitching] = useState(false);
  const [generationPrompt, setGenerationPrompt] = useState(DEFAULT_GENERATION_PROMPT);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const [apiDialogOpen, setApiDialogOpen] = useState(false);
  const [apiDraftError, setApiDraftError] = useState('');
  const [apiSaving, setApiSaving] = useState(false);
  const [apiSaveMessage, setApiSaveMessage] = useState('');
  const [apiDraft, setApiDraft] = useState<JoyApiDraft>({
    mode: 'user',
    name: DEFAULT_JOY_IMAGE_PRESET.name,
    endpoint: DEFAULT_JOY_IMAGE_PRESET.endpoint,
    model: DEFAULT_JOY_IMAGE_PRESET.model,
    imgModel: DEFAULT_JOY_IMAGE_PRESET.imgModel,
    key: '',
  });
  const [boneEditor, setBoneEditor] = useState<JoyBoneEditorState>(DEFAULT_BONE_EDITOR_STATE);
  const [gearState, setGearState] = useState<JoyGearState>(DEFAULT_GEAR_STATE);
  const [actionsExpanded, setActionsExpanded] = useState(true);
  const [facesExpanded, setFacesExpanded] = useState(true);
  const [gearExpanded, setGearExpanded] = useState(false);
  const [gearTuneExpanded, setGearTuneExpanded] = useState(false);

  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);
  useEffect(() => { onWorkflowResultRef.current = onWorkflowResult; }, [onWorkflowResult]);
  useEffect(() => { workflowProjectIdRef.current = workflowProjectId; }, [workflowProjectId]);
  useEffect(() => { latestWorkflowAssetRef.current = latestWorkflowAsset; }, [latestWorkflowAsset]);
  useEffect(() => {
    if (!open || ready) {
      setConnectionTimedOut(false);
      return;
    }
    const timer = window.setTimeout(() => setConnectionTimedOut(true), 7000);
    return () => window.clearTimeout(timer);
  }, [open, ready, workflowProjectId]);
  useEffect(() => {
    setLatestWorkflowAsset(null);
    setResultPreviewOpen(false);
    setCapture(null);
    setCaptureSaved(false);
    setCaptureSaveError(false);
    setGenerating(false);
    setGenerationError('');
    setBoneEditor(DEFAULT_BONE_EDITOR_STATE);
    setGearState(DEFAULT_GEAR_STATE);
  }, [workflowProjectId, initialBackground?.id]);
  useEffect(() => {
    if (!open || !workflowProjectId) return;
    let cancelled = false;
    void loadLibrary().then((assets) => {
      if (cancelled) return;
      const latest = assets
        .filter((asset) => (
          asset.type === 'image'
          && asset.projectId === workflowProjectId
          && asset.stage === 'composite'
          && asset.tags?.includes('joy-ai-generated')
        ))
        .sort((a, b) => b.createdAt - a.createdAt)[0] || null;
      if (latest) {
        latestWorkflowAssetRef.current = latest;
        setLatestWorkflowAsset(latest);
      }
    });
    return () => { cancelled = true; };
  }, [open, workflowProjectId]);

  const post = (payload: Record<string, unknown>) => {
    iframeRef.current?.contentWindow?.postMessage(payload, getJoyMessageOrigin());
  };

  const applyInitialBackground = () => {
    if (!initialBackground || initialBackground.type !== 'image') return;
    const url = (() => {
      if (initialBackground.url.startsWith('data:') || initialBackground.url.startsWith('blob:')) return initialBackground.url;
      try {
        const parsed = new URL(initialBackground.url, window.location.href);
        return parsed.origin === window.location.origin
          ? parsed.href
          : `/remote-asset?u=${encodeURIComponent(parsed.href)}`;
      } catch {
        return initialBackground.url;
      }
    })();
    setHasBackground(true);
    post({ action: 'setBackground', url });
  };

  const applyInitialState = () => {
    const state = initialStateRef.current;
    if (!state) return;
    latestJoyStateRef.current = state;
    if (state.pose) post({ action: 'setPose', pose: state.pose });
    if (state.face) post({ action: 'setFace', face: state.face });
    if (state.transform) post({ action: 'setTransform', ...state.transform });
    if (state.light) post({ action: 'setLight', ...state.light });
    if (state.camera) post({ action: 'setCamera', ...state.camera });
    post({ _lottiekey: true, type: 'setBoneDetail', detail: state.boneDetail === 'full' ? 'full' : 'basic' });
    if (state.bonePose) post({ _lottiekey: true, type: 'setBonePose', bonePose: state.bonePose });
  };

  useEffect(() => {
    if (!open || !ready || !initialBackground) return;
    applyInitialBackground();
  }, [open, ready, initialBackground?.id]);

  useEffect(() => {
    if (!open || !ready) return;
    post({ _lottiekey: true, type: 'workflowMode', enabled: Boolean(workflowProjectId) });
    post({ _lottiekey: true, type: 'getGenerationConfig' });
    post({ _lottiekey: true, type: 'getGearState', category: gearState.category });
  }, [open, ready, workflowProjectId]);

  useEffect(() => {
    if (!open || !ready || !workflowProjectId) return;
    let cancelled = false;
    const syncRenderedGeneratedResult = () => {
      const doc = iframeRef.current?.contentDocument;
      const result = doc?.querySelector('#result');
      if (!result || !result.textContent?.includes('生成结果')) return;
      const image = result.querySelector('img');
      const url = image?.currentSrc || image?.src || image?.getAttribute('src') || '';
      if (!url) return;
      const key = `generated-url:${url}`;
      if (savedMessageIdsRef.current.has(key)) return;
      savedMessageIdsRef.current.add(key);
      const prompt = (doc?.querySelector('#prompt') as HTMLTextAreaElement | null)?.value || 'JOY AI 合成结果';
      void persistLibraryAsset({
        url,
        type: 'image',
        prompt,
        thumbnail: url,
        projectId: workflowProjectId,
        workflowId: workflowProjectId,
        stage: 'composite',
        joyState: latestJoyStateRef.current as Record<string, unknown> | undefined,
        status: 'candidate',
        tags: ['joy-ai-generated'],
      }).then((saved) => {
        if (cancelled) return;
        latestWorkflowAssetRef.current = saved;
        setLatestWorkflowAsset(saved);
      });
    };
    syncRenderedGeneratedResult();
    const timer = window.setInterval(syncRenderedGeneratedResult, 800);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [open, ready, workflowProjectId]);

  useEffect(() => {
    initialStateAppliedRef.current = false;
    initialStateRef.current = initialState || null;
  }, [open, workflowProjectId, initialBackground?.id]);

  useEffect(() => {
    if (!initialStateAppliedRef.current) initialStateRef.current = initialState || null;
  }, [initialState]);

  useEffect(() => {
    if (!open || !ready || initialStateAppliedRef.current || !initialStateRef.current) return;
    initialStateAppliedRef.current = true;
    const timer = window.setTimeout(applyInitialState, 420);
    return () => window.clearTimeout(timer);
  }, [open, ready, workflowProjectId, initialBackground?.id]);

  const syncFromJoy = (state?: JoyState) => {
    if (!state) return;
    if (state.pose !== undefined) setSelectedPose(state.pose ?? null);
    if (state.face !== undefined) setSelectedFace(state.face ?? null);
    if (state.hasBackground !== undefined) setHasBackground(state.hasBackground);
    if (state.transform) setTransform((current) => ({ ...current, ...state.transform }));
    if (state.light) setLight((current) => ({ ...current, ...state.light }));
    if (state.camera) setCamera((current) => ({ ...current, ...state.camera }));
    if (state.boneDetail) setBoneEditor((current) => ({ ...current, detail: state.boneDetail === 'full' ? 'full' : 'basic' }));
    latestJoyStateRef.current = state;
    const signature = JSON.stringify(state);
    if (signature !== lastStateSignatureRef.current) {
      lastStateSignatureRef.current = signature;
      onStateChangeRef.current?.(state);
    }
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== getJoyMessageOrigin()) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data?._joy) return;
      setReady(true);

      if (data.type === 'generationConfig' && data.config) {
        const config: JoyGenerationConfig = {
          ...DEFAULT_GENERATION_CONFIG,
          ...data.config,
          mode: data.config.mode === 'user' ? 'user' : 'proxy',
        };
        setGenerationConfig(config);
        const resolvedPresetId = resolveJoyImagePresetId(config.imgModel);
        const pendingPresetId = pendingImagePresetIdRef.current;
        if (pendingPresetId && pendingPresetId !== resolvedPresetId) {
          setSelectedImagePresetId(pendingPresetId);
        } else {
          pendingImagePresetIdRef.current = null;
          setSelectedImagePresetId(resolvedPresetId);
        }
        if (typeof config.prompt === 'string' && config.prompt.trim()) setGenerationPrompt(config.prompt);
        setApiDraft((current) => ({
          ...current,
          mode: config.mode,
          name: config.name,
          endpoint: config.endpoint,
          model: config.model,
          imgModel: config.imgModel,
          key: '',
        }));
        return;
      }

      if (data.type === 'generationConfigSaved' && data.requestId === modelSaveRequestIdRef.current) {
        modelSaveRequestIdRef.current = null;
        setModelSwitching(false);
        if (data.ok) {
          setGenerationError('');
          post({ _lottiekey: true, type: 'getGenerationConfig' });
        } else {
          pendingImagePresetIdRef.current = null;
          setSelectedImagePresetId(resolveJoyImagePresetId(generationConfig.imgModel));
          setGenerationError(typeof data.error === 'string' ? data.error : '模型切换失败，请重试。');
        }
        return;
      }

      if (data.type === 'generationConfigSaved' && data.requestId === apiSaveRequestIdRef.current) {
        apiSaveRequestIdRef.current = null;
        setApiSaving(false);
        if (data.ok) {
          setApiDraftError('');
          setApiSaveMessage('配置已保存，并已切换为当前融图接口。');
          post({ _lottiekey: true, type: 'getGenerationConfig' });
        } else {
          setApiSaveMessage('');
          setApiDraftError(typeof data.error === 'string' ? data.error : '配置保存失败，请重试。');
        }
        return;
      }

      if (data.type === 'generationFailed') {
        setGenerating(false);
        setGenerationError(typeof data.error === 'string' ? data.error : '融图生成失败，请检查 API 配置后重试。');
        return;
      }

      if (data.type === 'boneEditorState') {
        setBoneEditor((current) => ({
          ...current,
          active: Boolean(data.active),
          mode: data.mode === 'overall' ? 'overall' : 'joint',
          detail: data.detail === 'full' ? 'full' : 'basic',
          axis: data.axis === 'x' || data.axis === 'y' ? data.axis : 'z',
          value: Number(data.value || 0),
          canRotate: Boolean(data.canRotate),
          title: typeof data.title === 'string' ? data.title : current.title,
        }));
        return;
      }

      if (data.type === 'gearState' && data.state) {
        setGearState((current) => ({
          ...current,
          ...data.state,
          tune: { ...current.tune, ...(data.state.tune || {}) },
        }));
        return;
      }

      if (data.type === 'requestBackgroundLibrary') {
        setBackgroundLibraryOpen(true);
        return;
      }

      if (data.type === 'poseAdjusted') {
        return;
      }

      if (data.type === 'assetActionRequest' && typeof data.asset?.url === 'string') {
        const operation = data.operation === 'save' ? 'save' : 'download';
        const sendResult = (ok: boolean, message: string) => {
          iframeRef.current?.contentWindow?.postMessage({
            _lottiekey: true,
            type: 'assetActionResult',
            operation,
            requestId: data.requestId,
            ok,
            message,
          }, getJoyMessageOrigin());
        };

        if (operation === 'save') {
          void persistLibraryAsset({
            url: data.asset.url,
            type: 'image',
            prompt: data.asset.prompt || 'JOY 图片素材',
            thumbnail: data.asset.url,
          }).then((saved) => {
            sendResult(Boolean(saved), saved ? '已存入仓库' : '仓库空间不足');
          }).catch(() => sendResult(false, '保存失败'));
        } else {
          void downloadJoyAsset(data.asset.url)
            .then(() => sendResult(true, '已开始下载'))
            .catch(() => sendResult(false, '下载失败'));
        }
        return;
      }

      if (data.type === 'generatedAsset' && typeof data.asset?.url === 'string') {
        setGenerating(false);
        setGenerationError('');
        const key = `generated-url:${data.asset.url}`;
        if (!savedMessageIdsRef.current.has(key)) {
          savedMessageIdsRef.current.add(key);
          void persistLibraryAsset({
            url: data.asset.url,
            type: data.asset.type === 'video' ? 'video' : 'image',
            prompt: data.asset.prompt || 'JOY AI 合成结果',
            thumbnail: data.asset.type === 'video' ? undefined : data.asset.url,
            projectId: workflowProjectIdRef.current || undefined,
            workflowId: workflowProjectIdRef.current || undefined,
            stage: workflowProjectIdRef.current ? 'composite' : undefined,
            joyState: latestJoyStateRef.current as Record<string, unknown> | undefined,
            status: workflowProjectIdRef.current ? 'candidate' : undefined,
            tags: ['joy-ai-generated'],
          }).then((saved) => {
            if (workflowProjectIdRef.current && saved.type === 'image') {
              latestWorkflowAssetRef.current = saved;
              setLatestWorkflowAsset(saved);
            }
          });
        }
        return;
      }

      if (data.type === 'generationStarted') {
        latestWorkflowAssetRef.current = null;
        setLatestWorkflowAsset(null);
        setGenerating(true);
        setGenerationError('');
        return;
      }

      if (data.type === 'adoptGeneratedAsset' && typeof data.asset?.url === 'string') {
        if (!workflowProjectIdRef.current) return;
        const destination = data.destination === 'dynamic' ? 'dynamic' : 'static';
        const current = latestWorkflowAssetRef.current;
        if (current?.url === data.asset.url) {
          onWorkflowResultRef.current?.(current, destination);
          return;
        }
        void persistLibraryAsset({
          url: data.asset.url,
          type: 'image',
          prompt: data.asset.prompt || 'JOY AI 合成结果',
          thumbnail: data.asset.url,
          projectId: workflowProjectIdRef.current,
          workflowId: workflowProjectIdRef.current,
          stage: 'composite',
          joyState: latestJoyStateRef.current as Record<string, unknown> | undefined,
          status: 'candidate',
          tags: ['joy-ai-generated'],
        }).then((saved) => {
          latestWorkflowAssetRef.current = saved;
          setLatestWorkflowAsset(saved);
          onWorkflowResultRef.current?.(saved, destination);
        });
        return;
      }

      if (Array.isArray(data.capabilities?.poses) && data.capabilities.poses.length > 0) {
        setCapabilities({
          poses: data.capabilities.poses,
          faces: Array.isArray(data.capabilities.faces) && data.capabilities.faces.length > 0
            ? data.capabilities.faces
            : FALLBACK_FACES,
        });
      }
      const legacyState = data.state || (
        data.pose !== undefined
        || data.scale !== undefined
        || data.yaw !== undefined
        || data.x !== undefined
        || data.y !== undefined
        || data.bg !== undefined
          ? {
            pose: data.pose ?? null,
            hasBackground: Boolean(data.bg),
            transform: {
              scale: data.scale ?? transform.scale,
              yaw: data.yaw ?? transform.yaw,
              x: data.x ?? transform.x,
              y: data.y ?? transform.y,
            },
          }
          : undefined
      );
      syncFromJoy(legacyState);

      const isCaptureResult = data.id === captureIdRef.current && typeof data.image === 'string';
      if (data.id === captureIdRef.current) {
        setCapturing(false);
        captureIdRef.current = null;
      }
      if (typeof data.image === 'string') {
        setCapture(data.image);
        setCaptureTransparent(data.transparent !== false);
      }
      if (isCaptureResult && !savedMessageIdsRef.current.has(`capture:${data.id}`)) {
        savedMessageIdsRef.current.add(`capture:${data.id}`);
        if (workflowProjectIdRef.current) {
          setCaptureSaved(false);
          setCaptureSaveError(false);
          return;
        }
        void persistLibraryAsset({
          url: data.image,
          type: 'image',
          prompt: data.transparent === false ? 'JOY 角色与背景合成图' : 'JOY 透明角色素材',
          thumbnail: data.image,
          joyState: latestJoyStateRef.current as Record<string, unknown> | undefined,
          tags: ['joy-capture'],
        }).then((saved) => {
          setCaptureSaved(Boolean(saved.id));
          setCaptureSaveError(!saved.id);
        });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  if (!open) return null;

  const requestJoyState = () => {
    post({ action: 'getCapabilities' });
    post({ action: 'getState' });
  };

  const retryJoyConnection = () => {
    setReady(false);
    setConnectionTimedOut(false);
    const iframe = iframeRef.current;
    if (iframe) iframe.src = JOY_URL;
  };

  const updateTransform = (key: keyof JoyTransform, value: number) => {
    const next = { ...transform, [key]: value };
    setTransform(next);
    post({ action: 'setTransform', ...next });
    post({ _lottiekey: true, type: 'highlightGenerate' });
  };

  const updateJoyPosition = (x: number, y: number) => {
    const clamp = (value: number) => Math.max(-POSITION_RANGE, Math.min(POSITION_RANGE, value));
    const next = {
      ...transform,
      x: Number(clamp(x).toFixed(2)),
      y: Number(clamp(y).toFixed(2)),
    };
    setTransform(next);
    post({ action: 'setTransform', ...next });
    post({ _lottiekey: true, type: 'highlightGenerate' });
  };

  const beginPositionDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const pad = event.currentTarget;
    const rect = pad.getBoundingClientRect();
    const pointerId = event.pointerId;
    const applyPointer = (clientX: number, clientY: number) => {
      if (rect.width <= 0 || rect.height <= 0) return;
      const x = ((clientX - rect.left) / rect.width) * POSITION_RANGE * 2 - POSITION_RANGE;
      const y = POSITION_RANGE - ((clientY - rect.top) / rect.height) * POSITION_RANGE * 2;
      updateJoyPosition(x, y);
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      applyPointer(moveEvent.clientX, moveEvent.clientY);
    };
    const finish = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      pad.removeEventListener('pointermove', onMove);
      pad.removeEventListener('pointerup', finish);
      pad.removeEventListener('pointercancel', finish);
      try { pad.releasePointerCapture(pointerId); } catch { /* pointer may already be released */ }
    };
    pad.setPointerCapture(pointerId);
    pad.addEventListener('pointermove', onMove);
    pad.addEventListener('pointerup', finish);
    pad.addEventListener('pointercancel', finish);
    applyPointer(event.clientX, event.clientY);
    event.preventDefault();
  };

  const updateLight = (key: keyof JoyLight, value: number | boolean) => {
    const next = { ...light, [key]: value };
    setLight(next);
    post({ action: 'setLight', [key]: value });
    post({ _lottiekey: true, type: 'highlightGenerate' });
  };

  const updateCamera = (focalLength: number) => {
    const next = { focalLength };
    setCamera(next);
    post({ action: 'setCamera', ...next });
    post({ _lottiekey: true, type: 'highlightGenerate' });
  };

  const captureCurrentState = () => {
    if (!ready || capturing) return;
    const id = `joy_${Date.now()}`;
    setCapturing(true);
    setCapture(null);
    setCaptureSaved(false);
    setCaptureSaveError(false);
    captureIdRef.current = id;
    post({ action: 'capture', id });
  };

  const toJoyAssetUrl = (url: string) => {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    try {
      const parsed = new URL(url, window.location.href);
      if (parsed.origin === window.location.origin) return parsed.href;
      return `/remote-asset?u=${encodeURIComponent(parsed.href)}`;
    } catch {
      return url;
    }
  };

  const selectBackgroundFromLibrary = (asset: LibraryAsset) => {
    if (asset.type !== 'image') return;
    setBackgroundLibraryOpen(false);
    setHasBackground(true);
    post({ action: 'setBackground', url: toJoyAssetUrl(asset.url) });
    post({ _lottiekey: true, type: 'highlightGenerate' });
  };

  const openApiDialog = () => {
    setApiDraft({
      mode: generationConfig.mode,
      name: generationConfig.name,
      endpoint: generationConfig.endpoint,
      model: generationConfig.model,
      imgModel: generationConfig.imgModel,
      key: '',
    });
    setApiDraftError('');
    setApiSaveMessage('');
    setApiSaving(false);
    setApiDialogOpen(true);
  };

  const saveApiConfiguration = () => {
    if (!ready) {
      setApiDraftError('JOY 控制器尚未连接，暂时无法保存配置。');
      return;
    }
    if (apiDraft.mode === 'user') {
      if (!apiDraft.endpoint.trim()) {
        setApiDraftError('请填写 API Endpoint。');
        return;
      }
      if (!apiDraft.key.trim() && !generationConfig.hasKey) {
        setApiDraftError('请填写 API Key。');
        return;
      }
    }
    setApiDraftError('');
    setApiSaveMessage('');
    setApiSaving(true);
    const requestId = `joy_api_${Date.now()}`;
    apiSaveRequestIdRef.current = requestId;
    post({
      _lottiekey: true,
      type: 'saveGenerationConfig',
      requestId,
      config: {
        ...apiDraft,
        key: apiDraft.key.trim(),
      },
    });
    window.setTimeout(() => {
      if (apiSaveRequestIdRef.current !== requestId) return;
      apiSaveRequestIdRef.current = null;
      setApiSaving(false);
      setApiDraftError('没有收到保存回执，请检查 JOY 控制器连接后重试。');
    }, 5000);
  };

  const selectImagePreset = (presetId: JoyImagePresetId) => {
    if (!ready || modelSwitching) return;
    const preset = JOY_IMAGE_PRESETS[presetId];
    pendingImagePresetIdRef.current = presetId;
    setSelectedImagePresetId(presetId);
    setModelSwitching(true);
    setGenerationError('');
    const requestId = `joy_model_${Date.now()}`;
    modelSaveRequestIdRef.current = requestId;
    post({
      _lottiekey: true,
      type: 'selectGenerationModel',
      requestId,
      presetId,
      config: {
        name: preset.name,
        endpoint: preset.endpoint,
        model: preset.model,
        imgModel: preset.imgModel,
      },
    });
    window.setTimeout(() => {
      if (modelSaveRequestIdRef.current !== requestId) return;
      modelSaveRequestIdRef.current = null;
      pendingImagePresetIdRef.current = null;
      setSelectedImagePresetId(resolveJoyImagePresetId(generationConfig.imgModel));
      setModelSwitching(false);
      setGenerationError('模型切换超时，请检查 JOY 控制器连接后重试。');
    }, 5000);
  };

  const generateComposite = () => {
    if (!ready || generating) return;
    if (!generationConfig.hasKey) {
      setGenerationError('首次使用需要填写 API Key。已为你打开画面左上角 API 入口，填写后保存即可融图。');
      post({ _lottiekey: true, type: 'openApiConfig', focus: 'key' });
      return;
    }
    if (!hasBackground) {
      setGenerationError('请先选择背景素材，再开始融图。');
      return;
    }
    setGenerationError('');
    setGenerating(true);
    const preset = JOY_IMAGE_PRESETS[selectedImagePresetId];
    post({
      _lottiekey: true,
      type: 'generateComposite',
      prompt: generationPrompt.trim() || DEFAULT_GENERATION_PROMPT,
      presetId: preset.id,
      config: {
        name: preset.name,
        endpoint: preset.endpoint,
        model: preset.model,
        imgModel: preset.imgModel,
      },
    });
  };

  const toggleBoneEditor = () => {
    if (!ready) return;
    post({ _lottiekey: true, type: 'toggleBoneEditor' });
  };

  const selectGearCategory = (category: JoyGearCategory) => {
    setGearState((current) => ({ ...current, category }));
    post({ _lottiekey: true, type: 'setGearCategory', category });
  };

  const selectGear = (gearId: string) => {
    setGearState((current) => ({ ...current, selectedId: gearId }));
    post({ _lottiekey: true, type: 'setGear', category: gearState.category, gearId });
    post({ _lottiekey: true, type: 'highlightGenerate' });
  };

  const updateGearTune = (key: keyof Omit<JoyGearTune, 'color'>, value: number) => {
    setGearState((current) => ({ ...current, tune: { ...current.tune, [key]: value } }));
    post({ _lottiekey: true, type: 'setGearTune', key, value });
    post({ _lottiekey: true, type: 'highlightGenerate' });
  };

  const updateGearColor = (color: string) => {
    setGearState((current) => ({ ...current, tune: { ...current.tune, color } }));
    post({ _lottiekey: true, type: 'setGearColor', color });
    post({ _lottiekey: true, type: 'highlightGenerate' });
  };

  const updateGearPartColor = (name: string, color: string) => {
    setGearState((current) => ({
      ...current,
      parts: current.parts.map((part) => part.name === name ? { ...part, color } : part),
    }));
    post({ _lottiekey: true, type: 'setGearPartColor', name, color });
    post({ _lottiekey: true, type: 'highlightGenerate' });
  };

  const updateBoneMode = (mode: JoyBoneEditorState['mode']) => {
    setBoneEditor((current) => ({ ...current, mode }));
    post({ _lottiekey: true, type: 'setBoneMode', mode });
  };

  const updateBoneDetail = (detail: JoyBoneEditorState['detail']) => {
    setBoneEditor((current) => ({ ...current, detail }));
    post({ _lottiekey: true, type: 'setBoneDetail', detail });
    post({ _lottiekey: true, type: 'highlightGenerate' });
  };

  const updateBoneAxis = (axis: JoyBoneEditorState['axis']) => {
    setBoneEditor((current) => ({ ...current, axis }));
    post({ _lottiekey: true, type: 'setBoneAxis', axis });
  };

  const updateBoneRotation = (value: number) => {
    setBoneEditor((current) => ({ ...current, value }));
    post({ _lottiekey: true, type: 'setBoneRotation', value });
    post({ _lottiekey: true, type: 'highlightGenerate' });
  };

  const beginPanelResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (panelCollapsed || event.button !== 0) return;
    const startX = event.clientX;
    const startWidth = panelWidth;
    const onMove = (moveEvent: PointerEvent) => {
      const maxWidth = Math.max(280, Math.min(520, window.innerWidth * 0.72));
      setPanelWidth(Math.min(maxWidth, Math.max(280, startWidth + startX - moveEvent.clientX)));
    };
    const onEnd = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    event.preventDefault();
  };

  const positionAndAnglePanel = (
    <section className="panel-sub p-3 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold">位置 / 角度</p>
        <button
          className="text-[10px] text-neutral-400 hover:text-white flex items-center gap-1"
          onClick={() => {
            setTransform(DEFAULT_TRANSFORM);
            post({ action: 'setTransform', ...DEFAULT_TRANSFORM });
            post({ _lottiekey: true, type: 'highlightGenerate' });
          }}
        >
          <RotateCcw size={11} /> 重置
        </button>
      </div>
      {TRANSFORM_CONTROLS.filter(([key]) => key !== 'x' && key !== 'y').map(([key, label, min, max, step]) => (
        <div key={key}>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="text-neutral-500">{label}</span>
            <span className="font-mono text-[var(--primary)]">{formatValue(transform[key], step)}</span>
          </div>
          <input className="slider" type="range" min={min} max={max} step={step} value={transform[key]} onChange={(event) => updateTransform(key, Number(event.target.value))} />
        </div>
      ))}
      <div className="border-t border-white/[0.07] pt-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[10px] font-medium text-neutral-400">位置</span>
          <span className="font-mono text-[9px] text-neutral-600">X {transform.x.toFixed(2)} · Y {transform.y.toFixed(2)}</span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_84px] gap-2.5">
          <div
            data-testid="joy-position-pad"
            className="relative h-28 touch-none cursor-crosshair overflow-hidden rounded-lg border border-white/10 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.08),transparent_58%),linear-gradient(to_right,transparent_calc(50%_-_0.5px),rgba(255,255,255,0.08)_50%,transparent_calc(50%_+_0.5px)),linear-gradient(to_bottom,transparent_calc(50%_-_0.5px),rgba(255,255,255,0.08)_50%,transparent_calc(50%_+_0.5px))] hover:border-[var(--primary)]/40"
            onPointerDown={beginPositionDrag}
            title="拖动或点击来定位 JOY"
          >
            <span className="pointer-events-none absolute left-2 top-2 text-[9px] text-neutral-600">XY 拖动定位</span>
            <span
              data-testid="joy-position-dot"
              className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-[var(--primary)] shadow-[0_0_14px_rgba(34,211,238,0.6)] transition-[left,top] duration-75"
              style={{
                left: `${((Math.max(-POSITION_RANGE, Math.min(POSITION_RANGE, transform.x)) + POSITION_RANGE) / (POSITION_RANGE * 2)) * 100}%`,
                top: `${((POSITION_RANGE - Math.max(-POSITION_RANGE, Math.min(POSITION_RANGE, transform.y))) / (POSITION_RANGE * 2)) * 100}%`,
              }}
            />
          </div>
          <div className="grid grid-cols-3 grid-rows-3 gap-1.5" aria-label="快速定位">
            {POSITION_SNAPS.map((snap) => {
              const active = Math.abs(transform.x - snap.x) < 0.08 && Math.abs(transform.y - snap.y) < 0.08;
              return (
                <button
                  key={snap.label}
                  type="button"
                  title={snap.label}
                  aria-label={`定位到${snap.label}`}
                  className={`flex min-h-0 items-center justify-center rounded-md border transition-colors ${active ? 'border-[var(--primary)] bg-[var(--primary)]/12' : 'border-white/10 bg-white/[0.025] hover:border-white/25 hover:bg-white/[0.06]'}`}
                  onClick={() => updateJoyPosition(snap.x, snap.y)}
                >
                  <span className={`h-2 w-2 rounded-full ${active ? 'bg-[var(--primary)] shadow-[0_0_7px_rgba(34,211,238,0.7)]' : 'bg-neutral-600'}`} />
                </button>
              );
            })}
          </div>
        </div>
        <p className="mt-2 text-[9px] leading-4 text-neutral-600">拖动左侧定位板自由摆放；右侧九宫格用于快速对齐。</p>
      </div>
      {TRANSFORM_CONTROLS.filter(([key]) => key === 'x' || key === 'y').map(([key, label, min, max, step]) => (
        <div key={key}>
          <div className="flex justify-between text-[11px] mb-1">
            <span className="text-neutral-500">{label}</span>
            <span className="font-mono text-[var(--primary)]">{formatValue(transform[key], step)}</span>
          </div>
          <input className="slider" type="range" min={min} max={max} step={step} value={transform[key]} onChange={(event) => updateTransform(key, Number(event.target.value))} />
        </div>
      ))}
    </section>
  );

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div
        className={`relative bg-[var(--bg-main)] border border-[var(--border-soft)] shadow-2xl overflow-hidden flex transition-[width,height,border-radius] duration-200 ${workspaceExpanded
          ? 'w-screen h-screen rounded-none border-0'
          : 'w-[calc(100vw-24px)] h-[calc(100vh-24px)] sm:w-[96vw] sm:h-[92vh] rounded-lg'}`}
      >
        <div className="relative flex-1 min-w-0 bg-black">
          <iframe
            ref={iframeRef}
            src={JOY_URL}
            className="w-full h-full border-0"
            title="JOY 3D Controller"
            onLoad={() => {
              setReady(false);
              window.setTimeout(requestJoyState, 900);
            }}
            allow="clipboard-read; clipboard-write"
          />
          {connectionTimedOut && !ready && (
            <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#080b10]/92 px-6 text-center backdrop-blur-sm">
              <div className="max-w-md rounded-xl border border-white/10 bg-[#111722] p-7 shadow-2xl">
                <WifiOff size={30} className="mx-auto text-amber-300" />
                <h3 className="mt-4 text-lg font-semibold text-white">JOY 资源仅限京东内网</h3>
                <p className="mt-2 text-sm leading-6 text-neutral-400">
                  JOY 控制器和角色资源不会随公开网页分发。请连接京东网络后重试，或在京东内网直接打开控制器。
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <button type="button" className="btn-ghost h-10 px-4 text-xs" onClick={retryJoyConnection}>
                    <RefreshCw size={13} /> 重新连接
                  </button>
                  <a
                    className="btn-ghost h-10 px-4 text-xs"
                    href="https://5r0lrpa77tvw.joyapp.jd.com/compose.html"
                    target="_blank"
                    rel="noreferrer"
                  >
                    内网打开 <ExternalLink size={13} />
                  </a>
                </div>
              </div>
            </div>
          )}
          {workflowProjectId && generating && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/45 px-6 backdrop-blur-[2px]">
              <div className="w-full max-w-xs rounded-xl border border-cyan-300/20 bg-[#0d1420]/94 p-5 text-center shadow-[0_24px_80px_rgba(0,0,0,0.55)]">
                <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/[0.08]">
                  <WandSparkles size={20} className="animate-pulse text-cyan-300" />
                </div>
                <p className="mt-3 text-sm font-semibold text-white">正在融图</p>
                <p className="mt-1 text-[10px] leading-5 text-neutral-400">正在匹配角色、场景与光影，完成后结果会显示在右侧融图设置中。</p>
                <div className="mt-4 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div className="h-full w-1/2 animate-pulse rounded-full bg-gradient-to-r from-cyan-400 to-blue-500" />
                </div>
              </div>
            </div>
          )}
        </div>

        <aside
          className="relative shrink-0 border-l border-[var(--border-soft)] bg-[var(--bg-elev)]/95 flex flex-col overflow-hidden transition-[width] duration-200"
          style={{ width: panelCollapsed ? 52 : panelWidth }}
        >
          {!panelCollapsed && (
            <div
              className="absolute inset-y-0 left-0 z-30 w-2 -translate-x-1/2 cursor-col-resize touch-none group"
              onPointerDown={beginPanelResize}
              title="拖动调整控制面板宽度"
            >
              <div className="absolute inset-y-0 left-1/2 w-px bg-transparent group-hover:bg-[var(--primary)]/70" />
            </div>
          )}
          <div className="h-14 px-4 border-b border-[var(--border-soft)] flex items-center justify-between shrink-0">
            <div className={panelCollapsed ? 'hidden' : 'min-w-0'}>
              <h2 className="text-sm font-bold">JOY 控制 POC</h2>
              <p className="text-[10px] text-neutral-500">
                {ready
                  ? (USE_ENHANCED_JOY_BRIDGE ? '已与 JOY 场景同步' : '已连接京东内网 JOY')
                  : connectionTimedOut
                    ? '仅限京东内网连接'
                    : '正在连接 JOY...'}
              </p>
            </div>
            <div className={`flex items-center ${panelCollapsed ? 'w-full justify-center' : 'gap-1'}`}>
              {!panelCollapsed && (
                <button
                  type="button"
                  onClick={() => setWorkspaceExpanded((value) => !value)}
                  className="p-1.5 rounded hover:bg-white/10 text-neutral-400 hover:text-white"
                  title={workspaceExpanded ? '退出铺满屏幕' : '铺满屏幕'}
                  aria-label={workspaceExpanded ? '退出铺满屏幕' : '铺满屏幕'}
                >
                  {workspaceExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
              )}
              <button
                onClick={() => setPanelCollapsed((value) => !value)}
                className="p-1.5 rounded hover:bg-white/10 text-neutral-400 hover:text-white"
                title={panelCollapsed ? '展开控制面板' : '收起控制面板'}
              >
                {panelCollapsed ? <ChevronLeft size={17} /> : <ChevronRight size={17} />}
              </button>
              {!panelCollapsed && (
                <button onClick={onClose} className="p-1.5 rounded hover:bg-white/10 text-neutral-400 hover:text-white" title="关闭">
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          <div className={panelCollapsed ? 'hidden' : 'flex-1 overflow-y-auto scroll-area p-4 space-y-4'}>
            <section className="panel-sub p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold">背景素材</p>
                <p className={`text-[10px] mt-0.5 ${hasBackground ? 'text-emerald-400' : 'text-neutral-500'}`}>
                  {hasBackground ? '已加载背景，可用于角色预览与融图' : '未选择背景素材'}
                </p>
              </div>
              <button className="btn-ghost h-8 px-3 text-[10px] shrink-0" onClick={() => setBackgroundLibraryOpen(true)}>
                <Images size={13} /> 从仓库选择
              </button>
            </section>

            {workflowProjectId && (
              <section className="panel-sub border-[var(--primary)]/30 p-3 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Sparkles size={14} className="shrink-0 text-[var(--primary)]" />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white">AI 融图设置</p>
                      <p className="mt-0.5 text-[10px] text-neutral-500">提示词、生成状态与结果预览</p>
                    </div>
                  </div>
                  <span className="shrink-0 rounded border border-white/[0.07] bg-black/20 px-2 py-1 text-[9px] text-neutral-500">API 请在画面左上角配置</span>
                </div>
                <div>
                  <label className="mb-1.5 block text-[10px] text-neutral-500">融合提示词</label>
                  <textarea
                    value={generationPrompt}
                    onChange={(event) => setGenerationPrompt(event.target.value)}
                    rows={4}
                    className="w-full resize-y rounded-md border border-white/10 bg-black/25 px-3 py-2 text-[11px] leading-5 text-neutral-200 outline-none placeholder:text-neutral-600 focus:border-[var(--primary)]/60"
                    placeholder={DEFAULT_GENERATION_PROMPT}
                  />
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-3">
                    <label className="text-[10px] text-neutral-500">融图模型</label>
                    <span className="text-[9px] text-neutral-600">{modelSwitching ? '正在切换参数…' : '共用已保存的 API Key'}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {(Object.values(JOY_IMAGE_PRESETS) as JoyImagePreset[]).map((preset) => {
                      const active = selectedImagePresetId === preset.id;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          disabled={!ready || modelSwitching}
                          onClick={() => selectImagePreset(preset.id)}
                          className={`min-w-0 rounded-md border px-3 py-2.5 text-left transition-all disabled:cursor-wait disabled:opacity-55 ${active
                            ? 'border-cyan-300/55 bg-cyan-400/[0.10] shadow-[0_0_0_1px_rgba(103,232,249,0.08)]'
                            : 'border-white/[0.08] bg-black/20 hover:border-white/20 hover:bg-white/[0.04]'}`}
                        >
                          <span className={`block truncate text-[11px] font-semibold ${active ? 'text-cyan-200' : 'text-neutral-300'}`}>{preset.label}</span>
                          <span className="mt-0.5 block truncate text-[9px] text-neutral-600">{preset.description}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <button
                  type="button"
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-gradient-to-r from-cyan-500 to-blue-600 px-5 text-xs font-semibold text-white shadow-[0_10px_28px_rgba(37,99,235,0.28)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={!ready || generating || modelSwitching || !hasBackground}
                  onClick={generateComposite}
                >
                  <WandSparkles size={15} className={generating ? 'animate-pulse' : ''} />
                  {generating ? '正在融图...' : latestWorkflowAsset ? '重新融图' : '开始融图'}
                </button>
                <div className="flex items-start gap-2 rounded-md border border-white/[0.06] bg-black/20 px-2.5 py-2">
                  <WandSparkles size={12} className={`mt-0.5 shrink-0 ${generating ? 'animate-pulse text-cyan-300' : 'text-neutral-500'}`} />
                  <p className={`text-[10px] leading-4 ${generationError ? 'text-red-400' : generating ? 'text-cyan-300' : 'text-neutral-500'}`}>
                    {generationError || (generating
                      ? '正在融合角色与场景，完成后结果会自动出现在这里。'
                      : latestWorkflowAsset
                        ? '融图完成。可以查看大图、重新融图或使用结果继续。'
                        : hasBackground
                          ? '调整提示词后即可开始融图。'
                          : '请先从仓库选择背景素材。')}
                  </p>
                </div>
                {latestWorkflowAsset && (
                  <div className="overflow-hidden rounded-lg border border-emerald-400/20 bg-black/25">
                    <div className="flex items-center justify-between border-b border-white/[0.07] px-3 py-2.5">
                      <div>
                        <p className="text-[11px] font-semibold text-white">融图完成</p>
                        <p className="mt-0.5 text-[9px] text-neutral-500">结果已保存，可直接进入后续流程</p>
                      </div>
                      <span className="inline-flex items-center gap-1 text-[9px] text-emerald-300"><CheckCircle2 size={11} /> 已完成</span>
                    </div>
                    <button
                      type="button"
                      className="group relative flex aspect-[4/3] max-h-64 w-full items-center justify-center overflow-hidden bg-black/50"
                      onClick={() => setResultPreviewOpen(true)}
                      title="点击查看大图"
                    >
                      <img src={latestWorkflowAsset.thumbnail || latestWorkflowAsset.url} alt="融图完成结果" className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.015]" />
                      <span className="absolute bottom-2 right-2 rounded bg-black/70 px-2 py-1 text-[9px] text-white opacity-0 backdrop-blur group-hover:opacity-100">查看大图</span>
                    </button>
                    <div className="grid grid-cols-2 gap-2 p-2.5">
                      <button type="button" className="btn-ghost h-9 text-[10px]" onClick={() => setResultPreviewOpen(true)}>查看大图</button>
                      <button type="button" className="btn-primary h-9 text-[10px]" onClick={() => onWorkflowResult?.(latestWorkflowAsset, 'dynamic')}>使用结果并继续 <Plus size={12} /></button>
                    </div>
                  </div>
                )}
              </section>
            )}

            {workflowProjectId && (
              <section className="panel-sub p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Bone size={13} className="text-[var(--primary)]" />
                    <p className="text-xs font-semibold">骨骼编辑</p>
                  </div>
                  <span className={`text-[9px] ${boneEditor.active ? 'text-emerald-400' : 'text-neutral-600'}`}>
                    {boneEditor.active ? '编辑中' : '未开启'}
                  </span>
                </div>
                <p className="text-[10px] leading-4 text-neutral-500">基础模式保留易用控制点；完整模式补充胸部、脊柱、颈部、肩部等旋转节点。</p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" className={`btn-ghost h-8 text-[10px] ${boneEditor.active ? 'border-[var(--primary)]/60 text-white' : ''}`} onClick={toggleBoneEditor}>
                    {boneEditor.active ? '退出编辑' : '打开骨骼编辑'}
                  </button>
                  <button type="button" className="btn-ghost h-8 text-[10px]" onClick={() => post({ _lottiekey: true, type: 'resetBonePose' })}>
                    <RotateCcw size={11} /> 回到站姿
                  </button>
                </div>
                {boneEditor.active && (
                  <div className="space-y-3 border-t border-white/[0.07] pt-3">
                    <div>
                      <div className="mb-1.5 flex items-center justify-between text-[9px]">
                        <span className="text-neutral-500">节点范围</span>
                        <span className={boneEditor.detail === 'full' ? 'text-blue-300' : 'text-emerald-300'}>
                          {boneEditor.detail === 'full' ? '蓝色为旋转节点' : '绿色为拖动节点'}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 rounded-md bg-black/20 p-1">
                        {([
                          ['basic', '基础控制'],
                          ['full', '完整骨骼'],
                        ] as const).map(([detail, label]) => (
                          <button
                            key={detail}
                            type="button"
                            className={`h-8 rounded text-[10px] transition-colors ${boneEditor.detail === detail ? 'bg-blue-500/80 text-white' : 'text-neutral-500 hover:bg-white/[0.05] hover:text-neutral-300'}`}
                            onClick={() => updateBoneDetail(detail)}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-1.5 rounded-md bg-black/20 p-1">
                      {([
                        ['joint', '单个骨骼'],
                        ['overall', '整体旋转'],
                      ] as const).map(([mode, label]) => (
                        <button
                          key={mode}
                          type="button"
                          className={`h-8 rounded text-[10px] transition-colors ${boneEditor.mode === mode ? 'bg-[var(--primary)] text-white' : 'text-neutral-500 hover:bg-white/[0.05] hover:text-neutral-300'}`}
                          onClick={() => updateBoneMode(mode)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-2 text-[10px]">
                      <span className="truncate text-neutral-500">{boneEditor.mode === 'overall' ? 'JOY 整体' : boneEditor.title}</span>
                      <span className="shrink-0 font-mono text-[var(--primary)]">{Math.round(boneEditor.value)}°</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(['x', 'y', 'z'] as const).map((axis) => (
                        <button
                          key={axis}
                          type="button"
                          onClick={() => updateBoneAxis(axis)}
                          className={`h-8 rounded border text-[10px] font-bold uppercase transition-colors ${boneEditor.axis === axis ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-white' : 'border-white/10 text-neutral-500 hover:border-white/20 hover:text-neutral-300'}`}
                        >
                          <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${axis === 'x' ? 'bg-red-400' : axis === 'y' ? 'bg-emerald-400' : 'bg-blue-400'}`} />
                          {axis}
                        </button>
                      ))}
                    </div>
                    <input
                      className="slider"
                      type="range"
                      min={-180}
                      max={180}
                      step={1}
                      value={boneEditor.value}
                      disabled={!boneEditor.canRotate}
                      onChange={(event) => updateBoneRotation(Number(event.target.value))}
                    />
                    <p className={`text-[9px] leading-4 ${boneEditor.canRotate ? 'text-neutral-600' : 'text-amber-400/80'}`}>
                      {boneEditor.canRotate
                        ? `拖动滑杆控制${boneEditor.axis.toUpperCase()}轴旋转，缩放仍可在“位置 / 角度”中调整。`
                        : boneEditor.detail === 'full'
                          ? '请在左侧画布点击绿色或蓝色骨骼节点。'
                          : '请先在左侧画布点击一个绿色关节点。'}
                    </p>
                  </div>
                )}
              </section>
            )}

            {positionAndAnglePanel}

            <section className="panel-sub p-3">
              <button type="button" className="flex w-full items-center justify-between" onClick={() => setActionsExpanded((value) => !value)}>
                <span className="text-[11px] font-semibold text-neutral-300">动作</span>
                <span className="flex items-center gap-2 text-[10px] text-neutral-600">
                  {capabilities.poses.length} {actionsExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </span>
              </button>
              {actionsExpanded && (
                <div className="mt-3 grid grid-cols-3 gap-1.5 max-h-44 overflow-y-auto scroll-area pr-1">
                  {capabilities.poses.map((pose) => (
                    <button
                      key={pose}
                      className={`min-h-8 rounded border border-white/[0.08] bg-black/15 px-1 py-1.5 text-[10px] leading-tight hover:border-[var(--primary)]/60 ${selectedPose === pose ? 'border-[var(--primary)] text-white bg-[var(--primary)]/10' : 'text-neutral-400'}`}
                      onClick={() => {
                        setSelectedPose(pose);
                        post({ action: 'setPose', pose });
                        post({ _lottiekey: true, type: 'highlightGenerate' });
                      }}
                    >
                      {pose}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="panel-sub p-3">
              <button type="button" className="flex w-full items-center justify-between" onClick={() => setFacesExpanded((value) => !value)}>
                <span className="text-[11px] font-semibold text-neutral-300">表情</span>
                <span className="flex items-center gap-2 text-[10px] text-neutral-600">
                  {capabilities.faces.length} {facesExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </span>
              </button>
              {facesExpanded && (
                <div className="mt-3 grid grid-cols-4 gap-1.5 max-h-40 overflow-y-auto scroll-area pr-1">
                  {capabilities.faces.map((face) => (
                    <button
                      key={face.value}
                      className={`min-h-8 rounded border border-white/[0.08] bg-black/15 px-1 py-1.5 text-[10px] leading-tight hover:border-[var(--primary)]/60 ${selectedFace === face.value ? 'border-[var(--primary)] text-white bg-[var(--primary)]/10' : 'text-neutral-400'}`}
                      onClick={() => {
                        setSelectedFace(face.value);
                        post({ action: 'setFace', face: face.value });
                        post({ _lottiekey: true, type: 'highlightGenerate' });
                      }}
                    >
                      {face.label}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="panel-sub p-3">
              <button
                type="button"
                className="flex w-full items-center justify-between"
                onClick={() => setGearExpanded((value) => {
                  const next = !value;
                  if (next) post({ _lottiekey: true, type: 'getGearState', category: gearState.category });
                  return next;
                })}
              >
                <span className="flex items-center gap-2 text-[11px] font-semibold text-neutral-300"><Shirt size={13} className="text-[var(--primary)]" /> 装扮</span>
                <span className="flex items-center gap-2 text-[10px] text-neutral-600">
                  {gearState.selectedId !== '__none__' ? '已装备' : '未装备'} {gearExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                </span>
              </button>
              {gearExpanded && (
                <div className="mt-3 space-y-3">
                  <div className="grid grid-cols-4 gap-1.5">
                    {gearState.categories.map((category) => {
                      const label = ({ head: '头部', neck: '颈部', body: '身体', feet: '脚部' } as const)[category];
                      const equipped = gearState.activeByCategory[category] && gearState.activeByCategory[category] !== '__none__';
                      return (
                        <button
                          key={category}
                          type="button"
                          className={`relative h-8 rounded border text-[10px] ${gearState.category === category ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-white' : 'border-white/[0.08] text-neutral-500 hover:border-white/20 hover:text-neutral-300'}`}
                          onClick={() => selectGearCategory(category)}
                        >
                          {label}
                          {equipped && <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-emerald-400" />}
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {gearState.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={`min-h-9 rounded border px-2 py-1.5 text-[10px] leading-tight ${gearState.selectedId === item.id ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-white' : 'border-white/[0.08] bg-black/15 text-neutral-400 hover:border-white/20'}`}
                        onClick={() => selectGear(item.id)}
                      >
                        {item.name}
                      </button>
                    ))}
                  </div>
                  {gearState.tuneEnabled && (
                    <div className="border-t border-white/[0.07] pt-3">
                      <button
                        type="button"
                        className="flex w-full items-center justify-between"
                        onClick={() => setGearTuneExpanded((value) => {
                          const next = !value;
                          if (next) post({ _lottiekey: true, type: 'getGearState', category: gearState.category });
                          return next;
                        })}
                      >
                        <span className="flex items-center gap-2 text-[10px] text-neutral-400"><Palette size={12} /> 装扮微调</span>
                        {gearTuneExpanded ? <ChevronUp size={13} className="text-neutral-600" /> : <ChevronDown size={13} className="text-neutral-600" />}
                      </button>
                      {gearTuneExpanded && (
                        <div className="mt-3 space-y-3">
                          <label className="flex items-center justify-between rounded-md border border-white/[0.07] bg-black/15 px-2.5 py-2 text-[10px] text-neutral-500">
                            整体颜色
                            <input type="color" value={gearState.tune.color} onChange={(event) => updateGearColor(event.target.value)} className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0" />
                          </label>
                          {gearState.parts.length > 1 && (
                            <div className="space-y-1.5">
                              <p className="text-[9px] text-neutral-600">分部上色</p>
                              <div className="grid grid-cols-2 gap-1.5">
                                {gearState.parts.map((part, index) => (
                                  <label key={`${part.name}-${index}`} className="flex min-w-0 items-center justify-between gap-2 rounded border border-white/[0.06] px-2 py-1.5 text-[9px] text-neutral-500">
                                    <span className="truncate" title={part.name}>{part.name}</span>
                                    <input type="color" value={part.color} onChange={(event) => updateGearPartColor(part.name, event.target.value)} className="h-5 w-7 shrink-0 cursor-pointer border-0 bg-transparent p-0" />
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                          {([
                            ['x', '水平位置', -500, 500, 1], ['y', '垂直位置', -500, 500, 1], ['z', '前后位置', -500, 500, 1],
                            ['scale', '缩放', 1, 1000, 1], ['rx', 'X 旋转', -180, 180, 1], ['ry', 'Y 旋转', -180, 180, 1], ['rz', 'Z 旋转', -180, 180, 1],
                            ['px', 'X 轴心', -100, 100, 1], ['py', 'Y 轴心', -100, 100, 1], ['pz', 'Z 轴心', -100, 100, 1],
                          ] as const).map(([key, label, min, max, step]) => (
                            <div key={key}>
                              <div className="mb-1 flex justify-between text-[10px]"><span className="text-neutral-500">{label}</span><span className="font-mono text-[var(--primary)]">{Math.round(gearState.tune[key])}</span></div>
                              <input className="slider" type="range" min={min} max={max} step={step} value={gearState.tune[key]} onChange={(event) => updateGearTune(key, Number(event.target.value))} />
                            </div>
                          ))}
                          <div className="grid grid-cols-2 gap-2 pt-1">
                            <button type="button" className="btn-ghost h-8 text-[10px]" onClick={() => post({ _lottiekey: true, type: 'resetGear' })}><RotateCcw size={11} /> 重置装扮</button>
                            <button type="button" className="btn-ghost h-8 text-[10px]" onClick={() => post({ _lottiekey: true, type: 'autofitGear' })}>自动贴合</button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="panel-sub p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Aperture size={13} className="text-[var(--primary)]" />
                  <p className="text-xs font-semibold">相机</p>
                </div>
                <button
                  className="text-[10px] text-neutral-400 hover:text-white flex items-center gap-1"
                  onClick={() => updateCamera(DEFAULT_CAMERA.focalLength)}
                >
                  <RotateCcw size={11} /> 重置
                </button>
              </div>
              <div>
                <div className="flex justify-between text-[11px] mb-1">
                  <span className="text-neutral-500">焦段</span>
                  <span className="font-mono text-[var(--primary)]">{Math.round(camera.focalLength)} mm</span>
                </div>
                <input
                  className="slider"
                  type="range"
                  min={24}
                  max={200}
                  step={1}
                  value={camera.focalLength}
                  onChange={(e) => updateCamera(Number(e.target.value))}
                />
              </div>
            </section>

            <section className="panel-sub p-3 space-y-3">
              <div className="flex items-center gap-2">
                <Sun size={13} className="text-[var(--primary)]" />
                <p className="text-xs font-semibold">灯光 / 阴影</p>
              </div>
              {LIGHT_CONTROLS.map(([key, label, min, max, step]) => (
                <div key={key}>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-neutral-500">{label}</span>
                    <span className="font-mono text-[var(--primary)]">{formatValue(light[key], step)}</span>
                  </div>
                  <input className="slider" type="range" min={min} max={max} step={step} value={light[key]} onChange={(e) => updateLight(key, Number(e.target.value))} />
                </div>
              ))}
              <div className="grid grid-cols-2 gap-2 pt-1">
                {([
                  ['shadowEnabled', '显示阴影'],
                  ['toneMatch', '色调匹配'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-[10px] text-neutral-400 cursor-pointer select-none">
                    <input type="checkbox" checked={light[key]} onChange={(e) => updateLight(key, e.target.checked)} className="accent-[var(--primary)]" />
                    {label}
                  </label>
                ))}
              </div>
            </section>

          </div>
        </aside>
      </div>
      {resultPreviewOpen && latestWorkflowAsset && (
        <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/88 p-6 backdrop-blur-md" onClick={() => setResultPreviewOpen(false)}>
          <button type="button" className="absolute right-6 top-6 rounded-full border border-white/15 bg-black/55 p-2 text-neutral-300 hover:bg-white/10 hover:text-white" onClick={() => setResultPreviewOpen(false)} title="关闭大图">
            <X size={20} />
          </button>
          <img
            src={latestWorkflowAsset.url}
            alt="融图结果大图"
            className="max-h-[88vh] max-w-[92vw] rounded-lg object-contain shadow-[0_28px_100px_rgba(0,0,0,0.7)]"
            onClick={(event) => event.stopPropagation()}
          />
        </div>
      )}
      <AssetLibrary
        open={backgroundLibraryOpen}
        onClose={() => setBackgroundLibraryOpen(false)}
        onSelectAsset={selectBackgroundFromLibrary}
        title="选择 JOY 背景"
        layerClassName="z-[140]"
        defaultFilter="image"
      />
      {apiDialogOpen && (
        <div className="fixed inset-0 z-[170] flex items-center justify-center p-5" onClick={() => setApiDialogOpen(false)}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
          <div
            className="relative w-full max-w-lg overflow-hidden rounded-xl border border-white/10 bg-[#111721] shadow-[0_28px_90px_rgba(0,0,0,0.65)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex h-14 items-center justify-between border-b border-white/10 px-5">
              <div className="flex items-center gap-2">
                <KeyRound size={15} className="text-[var(--primary)]" />
                <div>
                  <p className="text-sm font-semibold text-white">融图 API 配置</p>
                  <p className="text-[9px] text-neutral-500">配置只保存在当前浏览器，不写入项目代码</p>
                </div>
              </div>
              <button type="button" className="rounded p-1.5 text-neutral-500 hover:bg-white/10 hover:text-white" onClick={() => setApiDialogOpen(false)}>
                <X size={16} />
              </button>
            </div>

            <div className="max-h-[72vh] space-y-4 overflow-y-auto p-5 scroll-area">
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-white/[0.07] bg-black/20 p-1">
                {([
                  ['proxy', '共享配置'],
                  ['user', '使用自己的 API'],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => {
                      setApiDraft((current) => ({ ...current, mode }));
                      setApiDraftError('');
                      setApiSaveMessage('');
                    }}
                    className={`h-9 rounded-md text-[11px] transition-colors ${apiDraft.mode === mode ? 'bg-[var(--primary)] text-white' : 'text-neutral-500 hover:bg-white/[0.05] hover:text-neutral-300'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {apiDraft.mode === 'proxy' ? (
                <div className="rounded-lg border border-cyan-400/15 bg-cyan-400/[0.05] p-4">
                  <p className="text-xs font-medium text-cyan-200">使用外部 JOY 当前的共享接口配置</p>
                  <p className="mt-1.5 text-[10px] leading-5 text-neutral-500">无需填写 Key。若共享服务不可用，可切换为自己的 OpenAI 兼容接口。</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] text-neutral-500">配置名称（可选）</span>
                    <input
                      value={apiDraft.name}
                      onChange={(event) => { setApiDraft((current) => ({ ...current, name: event.target.value })); setApiSaveMessage(''); }}
                      className="h-10 w-full rounded-md border border-white/10 bg-black/25 px-3 text-xs text-white outline-none focus:border-[var(--primary)]/60"
                      placeholder="例如：团队图像接口"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] text-neutral-500">Endpoint（OpenAI 兼容基础路径）</span>
                    <input
                      value={apiDraft.endpoint}
                      onChange={(event) => { setApiDraft((current) => ({ ...current, endpoint: event.target.value })); setApiSaveMessage(''); }}
                      className="h-10 w-full rounded-md border border-white/10 bg-black/25 px-3 font-mono text-[11px] text-white outline-none focus:border-[var(--primary)]/60"
                      placeholder="https://example.com/v1"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[10px] text-neutral-500">API Key</span>
                    <input
                      type="password"
                      autoComplete="off"
                      value={apiDraft.key}
                      onChange={(event) => { setApiDraft((current) => ({ ...current, key: event.target.value })); setApiSaveMessage(''); }}
                      className="h-10 w-full rounded-md border border-white/10 bg-black/25 px-3 font-mono text-[11px] text-white outline-none focus:border-[var(--primary)]/60"
                      placeholder={generationConfig.hasKey ? '已保存，留空将保持原 Key' : '输入 API Key'}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block min-w-0">
                      <span className="mb-1.5 block text-[10px] text-neutral-500">Chat / Vision Model</span>
                      <input
                        value={apiDraft.model}
                        onChange={(event) => { setApiDraft((current) => ({ ...current, model: event.target.value })); setApiSaveMessage(''); }}
                        className="h-10 w-full rounded-md border border-white/10 bg-black/25 px-3 font-mono text-[10px] text-white outline-none focus:border-[var(--primary)]/60"
                      />
                    </label>
                    <label className="block min-w-0">
                      <span className="mb-1.5 block text-[10px] text-neutral-500">Image Model</span>
                      <input
                        value={apiDraft.imgModel}
                        onChange={(event) => { setApiDraft((current) => ({ ...current, imgModel: event.target.value })); setApiSaveMessage(''); }}
                        className="h-10 w-full rounded-md border border-white/10 bg-black/25 px-3 font-mono text-[10px] text-white outline-none focus:border-[var(--primary)]/60"
                      />
                    </label>
                  </div>
                  <p className="text-[9px] leading-4 text-neutral-600">Key 由外部 JOY 控制器存入当前浏览器 localStorage，页面刷新后仍可继续使用。</p>
                </div>
              )}

              {apiDraftError && <p className="rounded-md border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-[10px] text-red-400">{apiDraftError}</p>}
              {apiSaveMessage && <p className="rounded-md border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2 text-[10px] text-emerald-300"><CheckCircle2 size={12} className="mr-1.5 inline" />{apiSaveMessage}</p>}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-white/10 px-5 py-4">
              <button type="button" className="btn-ghost h-9 px-4 text-[11px]" disabled={apiSaving} onClick={() => setApiDialogOpen(false)}>{apiSaveMessage ? '完成' : '取消'}</button>
              <button type="button" className="btn-primary h-9 px-5 text-[11px] disabled:cursor-wait disabled:opacity-60" disabled={apiSaving} onClick={saveApiConfiguration}>
                <CheckCircle2 size={13} /> {apiSaving ? '正在保存...' : '保存配置'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
