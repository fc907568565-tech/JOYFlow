import React, { useEffect, useRef, useState } from 'react';
import { Aperture, Camera, CheckCircle2, Images, Plus, RefreshCw, RotateCcw, Sun, X } from 'lucide-react';
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
  shadowEnabled: boolean;
  toneMatch: boolean;
}

interface JoyCamera {
  focalLength: number;
}

export interface JoyState {
  pose?: string | null;
  face?: string | null;
  hasBackground?: boolean;
  transform?: Partial<JoyTransform>;
  light?: Partial<JoyLight>;
  camera?: Partial<JoyCamera>;
}

interface JoyCapabilities {
  poses: string[];
  faces: Array<{ label: string; value: string }>;
}

const JOY_URL = '/joy-compose';

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
const DEFAULT_LIGHT: JoyLight = {
  exposure: 1.15,
  ambient: 1.5,
  shadowOpacity: 0.32,
  shadowX: 0,
  shadowY: 0,
  shadowSize: 1,
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

const LIGHT_CONTROLS = [
  ['exposure', '曝光', 0.4, 1.8, 0.05],
  ['ambient', '环境光', 0, 2.5, 0.05],
  ['shadowOpacity', '阴影透明度', 0, 0.7, 0.02],
  ['shadowX', '阴影水平位置', -2, 2, 0.01],
  ['shadowY', '阴影垂直位置', -2, 2, 0.01],
  ['shadowSize', '阴影大小', 0.4, 2.5, 0.05],
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
  const [ready, setReady] = useState(false);
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

  useEffect(() => { onStateChangeRef.current = onStateChange; }, [onStateChange]);
  useEffect(() => { onWorkflowResultRef.current = onWorkflowResult; }, [onWorkflowResult]);
  useEffect(() => { workflowProjectIdRef.current = workflowProjectId; }, [workflowProjectId]);
  useEffect(() => { latestWorkflowAssetRef.current = latestWorkflowAsset; }, [latestWorkflowAsset]);
  useEffect(() => {
    setLatestWorkflowAsset(null);
    setCapture(null);
    setCaptureSaved(false);
    setCaptureSaveError(false);
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
    iframeRef.current?.contentWindow?.postMessage(payload, window.location.origin);
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
  };

  useEffect(() => {
    if (!open || !ready || !initialBackground) return;
    applyInitialBackground();
  }, [open, ready, initialBackground?.id]);

  useEffect(() => {
    if (!open || !ready) return;
    post({ _lottiekey: true, type: 'workflowMode', enabled: Boolean(workflowProjectId) });
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
    latestJoyStateRef.current = state;
    const signature = JSON.stringify(state);
    if (signature !== lastStateSignatureRef.current) {
      lastStateSignatureRef.current = signature;
      onStateChangeRef.current?.(state);
    }
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data;
      if (!data?._joy) return;
      setReady(true);

      if (data.type === 'requestBackgroundLibrary') {
        setBackgroundLibraryOpen(true);
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
          }, window.location.origin);
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
      syncFromJoy(data.state);

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

  const updateTransform = (key: keyof JoyTransform, value: number) => {
    const next = { ...transform, [key]: value };
    setTransform(next);
    post({ action: 'setTransform', ...next });
  };

  const updateLight = (key: keyof JoyLight, value: number | boolean) => {
    const next = { ...light, [key]: value };
    setLight(next);
    post({ action: 'setLight', [key]: value });
  };

  const updateCamera = (focalLength: number) => {
    const next = { focalLength };
    setCamera(next);
    post({ action: 'setCamera', ...next });
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
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[1180px] max-w-[95vw] h-[760px] max-h-[90vh] bg-[var(--bg-main)] border border-[var(--border-soft)] rounded-lg shadow-2xl overflow-hidden flex">
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
          {workflowProjectId && latestWorkflowAsset?.tags?.includes('joy-ai-generated') && (
            <div className="absolute inset-x-5 bottom-5 z-30 flex justify-center pointer-events-none">
              <button
                className="pointer-events-auto flex h-12 min-w-[340px] items-center justify-center gap-2 rounded-md border border-white/20 bg-red-600 px-7 text-sm font-semibold text-white shadow-[0_12px_36px_rgba(220,38,38,0.42)] hover:bg-red-500"
                onClick={() => onWorkflowResult?.(latestWorkflowAsset, 'dynamic')}
              >
                使用 AI 融合结果并制作动态图鉴 <Plus size={15} />
              </button>
            </div>
          )}
        </div>

        <aside className="w-[360px] shrink-0 border-l border-[var(--border-soft)] bg-[var(--bg-elev)]/95 flex flex-col">
          <div className="h-14 px-4 border-b border-[var(--border-soft)] flex items-center justify-between shrink-0">
            <div>
              <h2 className="text-sm font-bold">JOY 控制 POC</h2>
              <p className="text-[10px] text-neutral-500">{ready ? '已与 JOY 场景同步' : '正在连接 JOY...'}</p>
            </div>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-white/10 text-neutral-400 hover:text-white" title="关闭">
              <X size={16} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto scroll-area p-4 space-y-4">
            <section className="panel-sub p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold">背景素材</p>
                <p className={`text-[10px] mt-0.5 ${hasBackground ? 'text-emerald-400' : 'text-neutral-500'}`}>
                  {hasBackground ? '已加载背景，Capture 将保存完整画面' : '无背景，Capture 将保存透明角色'}
                </p>
              </div>
              <button className="btn-ghost h-8 px-3 text-[10px] shrink-0" onClick={() => setBackgroundLibraryOpen(true)}>
                <Images size={13} /> 从仓库选择
              </button>
            </section>

            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-neutral-500">动作</p>
                <span className="text-[10px] text-neutral-600">{capabilities.poses.length}</span>
              </div>
              <div className="grid grid-cols-3 gap-1.5 max-h-44 overflow-y-auto scroll-area pr-1">
                {capabilities.poses.map((pose) => (
                  <button
                    key={pose}
                    className={`panel-sub min-h-8 px-1 py-1.5 text-[10px] leading-tight hover:border-[var(--primary)]/60 ${selectedPose === pose ? 'border-[var(--primary)] text-white bg-[var(--primary)]/10' : ''}`}
                    onClick={() => {
                      setSelectedPose(pose);
                      post({ action: 'setPose', pose });
                    }}
                  >
                    {pose}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-neutral-500">表情</p>
                <span className="text-[10px] text-neutral-600">{capabilities.faces.length}</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5 max-h-40 overflow-y-auto scroll-area pr-1">
                {capabilities.faces.map((face) => (
                  <button
                    key={face.value}
                    className={`panel-sub min-h-8 px-1 py-1.5 text-[10px] leading-tight hover:border-[var(--primary)]/60 ${selectedFace === face.value ? 'border-[var(--primary)] text-white bg-[var(--primary)]/10' : ''}`}
                    onClick={() => {
                      setSelectedFace(face.value);
                      post({ action: 'setFace', face: face.value });
                    }}
                  >
                    {face.label}
                  </button>
                ))}
              </div>
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
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold">位置 / 角度</p>
                <button
                  className="text-[10px] text-neutral-400 hover:text-white flex items-center gap-1"
                  onClick={() => {
                    setTransform(DEFAULT_TRANSFORM);
                    post({ action: 'setTransform', ...DEFAULT_TRANSFORM });
                  }}
                >
                  <RotateCcw size={11} /> 重置
                </button>
              </div>
              {TRANSFORM_CONTROLS.map(([key, label, min, max, step]) => (
                <div key={key}>
                  <div className="flex justify-between text-[11px] mb-1">
                    <span className="text-neutral-500">{label}</span>
                    <span className="font-mono text-[var(--primary)]">{formatValue(transform[key], step)}</span>
                  </div>
                  <input className="slider" type="range" min={min} max={max} step={step} value={transform[key]} onChange={(e) => updateTransform(key, Number(e.target.value))} />
                </div>
              ))}
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

            <section className="space-y-2">
              <button className="btn-primary w-full h-10 text-xs disabled:opacity-50 disabled:cursor-not-allowed" disabled={!ready || capturing} onClick={captureCurrentState}>
                <Camera size={15} /> {capturing ? '正在截取...' : hasBackground ? 'Capture 场景 PNG' : 'Capture 透明 PNG'}
              </button>
              <button className="btn-ghost w-full h-9 text-xs" onClick={requestJoyState}>
                <RefreshCw size={14} /> 同步当前状态
              </button>
            </section>

            {workflowProjectId && latestWorkflowAsset && (
              <section className="panel-sub p-3 space-y-3 border-[var(--primary)]/40">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-xs font-semibold text-white">候选结果已保存</p>
                    <p className="mt-0.5 text-[10px] text-neutral-500">保存当前结果并自动设为视频首帧</p>
                  </div>
                  <CheckCircle2 size={15} className="text-emerald-400" />
                </div>
                <div className="aspect-video rounded bg-black/50 overflow-hidden flex items-center justify-center">
                  <img src={latestWorkflowAsset.thumbnail || latestWorkflowAsset.url} alt="JOY 合成候选" className="max-h-full max-w-full object-contain" />
                </div>
                <button className="btn-primary w-full h-10 text-xs" onClick={() => onWorkflowResult?.(latestWorkflowAsset, 'dynamic')}>
                  保存并制作动态图鉴 <Plus size={14} />
                </button>
              </section>
            )}

            {capture && (
              <section className="panel-sub p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-neutral-400">{captureTransparent ? '透明角色预览' : '角色与背景合成预览'}</p>
                  {captureSaved && (
                    <span className="inline-flex items-center gap-1 text-[9px] text-emerald-400">
                      <CheckCircle2 size={10} /> 已存入仓库
                    </span>
                  )}
                  {captureSaveError && <span className="text-[9px] text-red-400">仓库空间不足</span>}
                </div>
                <div className="aspect-square checkerboard rounded overflow-hidden flex items-center justify-center">
                  <img src={capture} alt="JOY capture" className="max-w-full max-h-full object-contain" />
                </div>
                <button className="btn-ghost w-full h-9 text-xs" onClick={() => onAddCapture(capture)}>
                  <Plus size={14} /> 加入图层
                </button>
              </section>
            )}
          </div>
        </aside>
      </div>
      <AssetLibrary
        open={backgroundLibraryOpen}
        onClose={() => setBackgroundLibraryOpen(false)}
        onSelectAsset={selectBackgroundFromLibrary}
        title="选择 JOY 背景"
        layerClassName="z-[140]"
        defaultFilter="image"
      />
    </div>
  );
};
