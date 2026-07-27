/**
 * JOYFlow V2.0 主入口
 * - 左：可滚动预览区（PreviewStage + Stats + Timeline + Lottie 预览）
 * - 右：ControlPanel（素材源 / 绿幕 / 叠加素材 / 画布 / 优化）
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Trash2, Eye, FileVideo,Image as ImageIcon,
  Sparkles, Languages, Upload, FileJson, Wand2, Package, Images, BookOpen, ArrowLeftRight, Gift,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Lottie from 'lottie-react';
import { parseGIF, decompressFrames } from 'gifuct-js';

import { translations } from './i18n';
import type {
  Lang, Mode, ExportFormat, Status, ProcessedFrame,
  ImageAsset, ChromaKeyOptions, AssetTransform,
} from './types';
import { applyChromaKey } from './utils/chromaKey';
import { getTransformAtTime, upsertPropKeyframe, addKeyframeAllProps, createInitialKeyframes } from './utils/interpolate';
import {
  buildSequencedLottie, buildCompositeLottie, downloadJson,
} from './utils/lottieExport';
import { PreviewStage, type PreviewStageHandle } from './components/PreviewStage';
import { LayerPanel } from './components/LayerPanel';
import { BottomPanel } from './components/BottomPanel';
import { ControlPanel } from './components/ControlPanel';
import { AIStudio } from './components/AIStudio';
import { AssetLibrary } from './components/AssetLibrary';
import { JoyBridgePanel, type JoyState } from './components/JoyBridgePanel';
import { AtlasWorkspace } from './components/AtlasWorkspace';
import { SpecialtyWorkspace } from './components/SpecialtyWorkspace';
import type { LibraryAsset } from './utils/assetLibrary';
import { loadActiveAtlasProject, patchActiveAtlasProject } from './utils/atlasWorkflow';

export default function App() {
  // ===== i18n =====
  const [lang, setLang] = useState<Lang>('zh');
  const t = translations[lang];

  // ===== Top-level mode =====
  const [activeMode, setActiveMode] = useState<Mode>(() => {
    const saved = localStorage.getItem('lottiekey_active_workspace');
    return saved === 'video' || saved === 'sequence' || saved === 'gif' || saved === 'ai' || saved === 'atlas' || saved === 'specialty'
      ? saved
      : 'ai';
  });
  const [lastFormatMode, setLastFormatMode] = useState<'video' | 'sequence' | 'gif'>(() => {
    const saved = localStorage.getItem('lottiekey_active_workspace');
    return saved === 'sequence' || saved === 'gif' ? saved : 'video';
  });
  const [exportFormat, setExportFormat] = useState<ExportFormat>('LOTTIE');

  // ===== Source files =====
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [sequenceFiles, setSequenceFiles] = useState<File[]>([]);
  const [sequenceFrames, setSequenceFrames] = useState<HTMLImageElement[]>([]);
  const [sequenceUrls, setSequenceUrls] = useState<string[]>([]);
  const [gifFile, setGifFile] = useState<File | null>(null);
  const [gifUrl, setGifUrl] = useState<string | null>(null);

  // ===== Chroma key =====
  const [chromaKey, setChromaKey] = useState<ChromaKeyOptions>({
    enabled: true, color: '#00ff00', threshold: 120, similarity: 0.15, despill: 0.3,
  });

  // ===== Canvas/crop =====
  const [customCanvasEnabled, setCustomCanvasEnabled] = useState(false);
  const [targetWidthInput, setTargetWidthInput] = useState<string | number>(512);
  const [targetHeightInput, setTargetHeightInput] = useState<string | number>(512);
  const [contentScale, setContentScale] = useState(1.0);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  const targetWidth = Math.max(32, typeof targetWidthInput === 'number' ? targetWidthInput : (parseInt(targetWidthInput as string) || 32));
  const targetHeight = Math.max(32, typeof targetHeightInput === 'number' ? targetHeightInput : (parseInt(targetHeightInput as string) || 32));

  // ===== Optimization =====
  const [frameSkip, setFrameSkip] = useState(2);
  const [scale, setScale] = useState(0.5);
  const [quality, setQuality] = useState(0.7);
  const [bitrate, setBitrate] = useState(2.5);

  // ===== Process status =====
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<Status>('IDLE');
  const [lastLottieData, setLastLottieData] = useState<any>(null);

  // ===== Video dimensions =====
  const [videoDimensions, setVideoDimensions] = useState({ w: 0, h: 0 });

  // ===== Assets / keyframes / timeline =====
  const [assets, setAssets] = useState<ImageAsset[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(true);

  // 已加载的 PNG 素材 HTMLImageElement 缓存（不放进 state，引用传递）
  const loadedImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [imgVersion, setImgVersion] = useState(0); // 触发预览重渲染

  // ===== Section open states =====
  const [open, setOpen] = useState({
    src: true, chroma: true, canvas: false, optim: true,
  });
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryMode, setLibraryMode] = useState<'asset' | 'source'>('asset');
  const [joyBridgeOpen, setJoyBridgeOpen] = useState(false);
  const [workflowBackground, setWorkflowBackground] = useState<LibraryAsset | null>(null);
  const [workflowProjectId, setWorkflowProjectId] = useState<string | null>(null);
  const [workflowJoyState, setWorkflowJoyState] = useState<JoyState | null>(() =>
    (loadActiveAtlasProject()?.joyState as JoyState | undefined) || null
  );
  const [atlasRevision, setAtlasRevision] = useState(0);
  const joyStateSaveTimerRef = useRef<number | null>(null);

  const handleWorkflowJoyStateChange = (state: JoyState) => {
    if (!workflowProjectId) return;
    setWorkflowJoyState(state);
    if (joyStateSaveTimerRef.current) window.clearTimeout(joyStateSaveTimerRef.current);
    joyStateSaveTimerRef.current = window.setTimeout(() => {
      const activeProject = loadActiveAtlasProject();
      if (activeProject?.id === workflowProjectId) {
        patchActiveAtlasProject({ joyState: state as Record<string, unknown> });
      }
    }, 220);
  };

  const acceptWorkflowResult = (asset: LibraryAsset, destination: 'static' | 'dynamic' = 'static') => {
    const activeProject = loadActiveAtlasProject();
    if (!activeProject || activeProject.id !== workflowProjectId) return;
    const makeDynamic = destination === 'dynamic';
    patchActiveAtlasProject({
      selectedCompositeId: asset.id,
      joyState: (workflowJoyState || asset.joyState || {}) as Record<string, unknown>,
      dynamicEnabled: makeDynamic ? true : activeProject.dynamicEnabled,
      currentStage: makeDynamic ? 'dynamic' : 'static',
    });
    setAtlasRevision((value) => value + 1);
    setJoyBridgeOpen(false);
    setActiveMode('atlas');
  };

  useEffect(() => () => {
    if (joyStateSaveTimerRef.current) window.clearTimeout(joyStateSaveTimerRef.current);
  }, []);

  useEffect(() => {
    localStorage.setItem('lottiekey_active_workspace', activeMode);
    if (activeMode === 'video' || activeMode === 'sequence' || activeMode === 'gif') {
      setLastFormatMode(activeMode);
    }
  }, [activeMode]);

  // ===== Refs =====
  const processCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewStageRef = useRef<PreviewStageHandle>(null);
  const lottieInputRef = useRef<HTMLInputElement>(null);

  // ===== Cleanup object URLs =====
  useEffect(() => {
    return () => {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      if (gifUrl) URL.revokeObjectURL(gifUrl);
      sequenceUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [videoUrl, gifUrl, sequenceUrls]);

  // ===== File change =====
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const file = files[0];
    if (!file) return;
    if (activeMode === 'video') {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      setVideoFile(file);
      setVideoUrl(URL.createObjectURL(file));
      setSequenceFiles([]);
      setSequenceFrames([]);
      setSequenceUrls([]);
      setGifFile(null);
      setGifUrl(null);
    } else if (activeMode === 'sequence') {
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      const pngFiles = files
        .filter((f) => f.type === 'image/png' || /\.png$/i.test(f.name))
        .sort((a, b) => collator.compare(a.name, b.name));
      if (pngFiles.length === 0) return;
      const urls = pngFiles.map((f) => URL.createObjectURL(f));
      Promise.all(urls.map((url) => new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      }))).then((frames) => {
        const first = frames[0];
        if (videoUrl) URL.revokeObjectURL(videoUrl);
        if (gifUrl) URL.revokeObjectURL(gifUrl);
        setVideoFile(null);
        setVideoUrl(null);
        setGifFile(null);
        setGifUrl(null);
        setSequenceFiles(pngFiles);
        setSequenceFrames(frames);
        setSequenceUrls(urls);
        setVideoDimensions({ w: first.naturalWidth || first.width, h: first.naturalHeight || first.height });
        setTargetWidthInput(Math.floor((first.naturalWidth || first.width) * scale));
        setTargetHeightInput(Math.floor((first.naturalHeight || first.height) * scale));
        setDuration(frames.length / 30);
        setPlaying(false);
      }).catch((err) => {
        console.error(err);
        urls.forEach((url) => URL.revokeObjectURL(url));
      });
    } else {
      if (gifUrl) URL.revokeObjectURL(gifUrl);
      setGifFile(file);
      const url = URL.createObjectURL(file);
      setGifUrl(url);
      setVideoFile(null);
      setVideoUrl(null);
      setSequenceFiles([]);
      setSequenceFrames([]);
      setSequenceUrls([]);
      const img = new Image();
      img.onload = () => {
        setVideoDimensions({ w: img.width, h: img.height });
        setTargetWidthInput(Math.floor(img.width * scale));
        setTargetHeightInput(Math.floor(img.height * scale));
      };
      img.src = url;
    }
    setStatus('IDLE');
    setLastLottieData(null);
    setProgress(0);
    setCurrentTime(0);
    e.target.value = '';
  };

  const handleLottiePreviewUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      if (!json || typeof json !== 'object' || !Array.isArray(json.layers)) {
        throw new Error('Invalid Lottie JSON');
      }
      setLastLottieData(json);
      setStatus('IDLE');
      setProgress(0);
      setIsProcessing(false);
    } catch (err) {
      console.error(err);
      alert(lang === 'zh' ? 'Lottie 文件解析失败，请确认是有效的 JSON 动画文件。' : 'Failed to parse Lottie file. Please choose a valid JSON animation.');
    } finally {
      e.target.value = '';
    }
  };

  const openAssetLibrary = () => {
    setLibraryMode('asset');
    setLibraryOpen(true);
  };

  const openSourceLibrary = () => {
    setLibraryMode('source');
    setLibraryOpen(true);
  };

  // ===== Asset upload (PNG/JPEG/WEBP) =====
  const onAssetUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    Array.from(files).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        const img = new Image();
        img.onload = () => {
          const id = `asset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          loadedImagesRef.current.set(id, img);
          setImgVersion((v) => v + 1);
          // 默认在画布中央，初始关键帧 t=0
          const cx = videoDimensions.w ? videoDimensions.w / 2 : 512;
          const cy = videoDimensions.h ? videoDimensions.h / 2 : 512;
          const defaultTr = { x: cx, y: cy, scale: 1, rotation: 0, opacity: 1 };
          const newAsset: ImageAsset = {
            id,
            name: file.name,
            src: dataUrl,
            width: img.naturalWidth,
            height: img.naturalHeight,
            visible: true,
            zBelowVideo: false,
            keyframes: createInitialKeyframes(),
            defaultTransform: defaultTr,
          };
          setAssets((prev) => [...prev, newAsset]);
          setSelectedAssetId(id);
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    });
    // 清空 input 以便重复选择同一文件
    e.target.value = '';
  };

  // ===== 从素材仓库导入素材到当前模式 =====
  const addJoyCaptureAsAsset = (dataUrl: string) => {
    const img = new Image();
    img.onload = () => {
      const id = `joy_capture_${Date.now()}`;
      loadedImagesRef.current.set(id, img);
      setImgVersion((v) => v + 1);
      const cx = videoDimensions.w ? videoDimensions.w / 2 : 512;
      const cy = videoDimensions.h ? videoDimensions.h / 2 : 512;
      const newAsset: ImageAsset = {
        id,
        name: `JOY Capture ${new Date().toLocaleTimeString()}`,
        src: dataUrl,
        width: img.naturalWidth,
        height: img.naturalHeight,
        visible: true,
        zBelowVideo: false,
        keyframes: createInitialKeyframes(),
        defaultTransform: { x: cx, y: cy, scale: 1, rotation: 0, opacity: 1 },
      };
      setAssets((prev) => [...prev, newAsset]);
      setSelectedAssetId(id);
    };
    img.src = dataUrl;
  };

  const onSelectFromLibrary = (libAsset: LibraryAsset) => {
    setLibraryOpen(false);
    if (libAsset.type === 'video') {
      // 视频素材：作为视频模式的素材源
      // 关键：hasFile 依赖 videoFile，因此必须 setVideoFile(File)；
      // 优先 fetch 获取 Blob 得到同源 blob:URL（避免画布跨域污染）；
      // 若跨域 fetch 失败则回退：直接用远端 URL 播放 + 构造占位 File 让 UI 生效。
      setActiveMode('video');
      const guessName = () => {
        try {
          const u = new URL(libAsset.url);
          const last = u.pathname.split('/').pop() || '';
          return /\.(mp4|webm|mov)$/i.test(last)
            ? last
            : `library_video_${Date.now()}.mp4`;
        } catch {
          return `library_video_${Date.now()}.mp4`;
        }
      };
      (async () => {
        const name = guessName();
        // 通用代理：本地/blob/data 直用，其余远端一律走 /remote-asset?u=<encoded>
        const toProxied = (u: string) => {
          if (!u) return u;
          if (u.startsWith('blob:') || u.startsWith('data:')) return u;
          try {
            const url = new URL(u, window.location.href);
            // 同源直接用
            if (url.origin === window.location.origin) return u;
            return `/remote-asset?u=${encodeURIComponent(url.href)}`;
          } catch {
            return u;
          }
        };
        const fetchUrl = toProxied(libAsset.url);
        console.log('[Library] 视频源:', { original: libAsset.url, fetchUrl });
        try {
          const resp = await fetch(fetchUrl, { mode: 'cors' });
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const blob = await resp.blob();
          const type = blob.type || 'video/mp4';
          const file = new File([blob], name, { type });
          if (videoUrl) URL.revokeObjectURL(videoUrl);
          setVideoFile(file);
          const objUrl = URL.createObjectURL(blob);
          setVideoUrl(objUrl);
          console.log('[Library] 视频载入成功:', { size: blob.size, type, objUrl });
        } catch (err) {
          console.warn('[Library] fetch 失败，使用代理 URL 兜底:', err, 'fetchUrl=', fetchUrl);
          // 兜底：走代理 URL 直接给 <video>，避免 CORS 污染
          const placeholderFile = new File([new Blob([], { type: 'video/mp4' })], name, { type: 'video/mp4' });
          if (videoUrl) URL.revokeObjectURL(videoUrl);
          setVideoFile(placeholderFile);
          setVideoUrl(fetchUrl);
        }
        setStatus('IDLE');
        setLastLottieData(null);
        setProgress(0);
        setCurrentTime(0);
        setCustomCanvasEnabled(false);
      })();
      return;
    }
    // 图片素材：加载为叠加素材
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const id = `asset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      loadedImagesRef.current.set(id, img);
      setImgVersion((v) => v + 1);
      const cx = videoDimensions.w ? videoDimensions.w / 2 : 512;
      const cy = videoDimensions.h ? videoDimensions.h / 2 : 512;
      const defaultTr = { x: cx, y: cy, scale: 1, rotation: 0, opacity: 1 };
      const newAsset: ImageAsset = {
        id,
        name: `仓库素材_${new Date().toLocaleTimeString()}`,
        src: libAsset.url,
        width: img.naturalWidth,
        height: img.naturalHeight,
        visible: true,
        zBelowVideo: false,
        keyframes: createInitialKeyframes(),
        defaultTransform: defaultTr,
      };
      setAssets((prev) => [...prev, newAsset]);
      setSelectedAssetId(id);
    };
    img.onerror = () => {
      alert('素材加载失败，可能是图片链接已过期。');
    };
    img.src = libAsset.url;
  };

  // 清理被删除素材的 image 缓存
  useEffect(() => {
    const ids = new Set(assets.map((a) => a.id));
    for (const k of Array.from(loadedImagesRef.current.keys())) {
      if (!ids.has(k)) loadedImagesRef.current.delete(k);
    }
  }, [assets]);

  // ===== Video loaded =====
  const onVideoLoaded = (w: number, h: number) => {
    setVideoDimensions({ w, h });
    setTargetWidthInput(Math.floor(w * scale));
    setTargetHeightInput(Math.floor(h * scale));
    setOffsetX(0); setOffsetY(0);
  };

  useEffect(() => {
    if (activeMode !== 'sequence' || !playing || sequenceFrames.length === 0) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = (now - last) / 1000;
      last = now;
      setCurrentTime((time) => {
        const next = time + delta;
        return duration > 0 ? next % duration : 0;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [activeMode, playing, sequenceFrames.length, duration]);

  // ===== Add keyframe at current time（Timeline 调用）=====
  const onAddKeyframe = () => {
    if (!selectedAssetId) return;
    const a = assets.find((x) => x.id === selectedAssetId);
    if (!a) return;
    // 用 defaultTransform 的值（用户最后拖拽/设置的值）作为新帧值
    const newKfs = addKeyframeAllProps(a.keyframes, currentTime, a.defaultTransform);
    setAssets((prev) => prev.map((x) => x.id === a.id ? { ...x, keyframes: newKfs } : x));
  };

  // ===== Helpers =====
  const hasFile = activeMode === 'video' ? !!videoFile : activeMode === 'sequence' ? sequenceFrames.length > 0 : activeMode === 'gif' ? !!gifFile : false;
  const sourceFileName = activeMode === 'video'
    ? videoFile?.name
    : activeMode === 'sequence'
      ? `${sequenceFiles.length} PNG frames`
      : gifFile?.name;
  const lottieSizeKB = lastLottieData ? Math.round(JSON.stringify(lastLottieData).length / 1024) : 0;
  const outputW = customCanvasEnabled ? targetWidth : Math.floor(videoDimensions.w * scale);
  const outputH = customCanvasEnabled ? targetHeight : Math.floor(videoDimensions.h * scale);
  const estFrames = activeMode === 'sequence'
    ? Math.ceil(sequenceFrames.length / frameSkip)
    : activeMode === 'video' && duration
      ? Math.floor((duration * 30) / frameSkip)
      : 0;

  // ===== Render helpers for asset compositing during export =====
  const drawAssetsAt = (
    ctx: CanvasRenderingContext2D,
    timeSec: number,
    canvasW: number,
    canvasH: number,
    srcW: number,
    srcH: number,
  ) => {
    // assets 的 transform 基于原始视频尺寸；映射到输出画布
    // 视频已绘制于 ctx，仅绘制 "在视频之上" 的素材
    const sx = canvasW / srcW;
    const sy = canvasH / srcH;
    for (const asset of assets) {
      if (!asset.visible) continue;
      if (asset.zBelowVideo) continue;
      const img = loadedImagesRef.current.get(asset.id);
      if (!img) continue;
      const tr = getTransformAtTime(asset.keyframes, timeSec, asset.defaultTransform);
      ctx.save();
      ctx.globalAlpha = tr.opacity;
      ctx.translate(tr.x * sx, tr.y * sy);
      ctx.rotate((tr.rotation * Math.PI) / 180);
      ctx.scale(tr.scale * sx, tr.scale * sy);
      ctx.drawImage(img, -asset.width / 2, -asset.height / 2);
      ctx.restore();
    }
  };

  // ===== Export entry =====
  const startExport = async () => {
    if (activeMode === 'video') await startVideoExport();
    else if (activeMode === 'sequence') await startSequenceExport();
    else await startGifExport();
  };

  // ===== PNG sequence export =====
  const startSequenceExport = async () => {
    if (sequenceFrames.length === 0) return;
    setIsProcessing(true); setStatus('PROCESSING'); setProgress(0);
    try {
      const first = sequenceFrames[0];
      const nativeW = first.naturalWidth || first.width;
      const nativeH = first.naturalHeight || first.height;
      const srcW = Math.floor(nativeW * scale);
      const srcH = Math.floor(nativeH * scale);
      const outW = customCanvasEnabled ? targetWidth : srcW;
      const outH = customCanvasEnabled ? targetHeight : srcH;
      const canvas = processCanvasRef.current!;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      canvas.width = outW; canvas.height = outH;
      const sc = document.createElement('canvas');
      sc.width = srcW; sc.height = srcH;
      const sctx = sc.getContext('2d')!;
      const processed: ProcessedFrame[] = [];
      const sourceFps = 30;
      const targetFps = sourceFps / frameSkip;
      const total = Math.ceil(sequenceFrames.length / frameSkip);
      for (let i = 0, outIndex = 0; i < sequenceFrames.length; i += frameSkip, outIndex++) {
        const img = sequenceFrames[i];
        sctx.clearRect(0, 0, srcW, srcH);
        sctx.drawImage(img, 0, 0, srcW, srcH);
        ctx.clearRect(0, 0, outW, outH);
        if (customCanvasEnabled) {
          const iw = Math.floor(srcW * contentScale);
          const ih = Math.floor(srcH * contentScale);
          const dx = Math.floor((outW - iw) / 2) + offsetX;
          const dy = Math.floor((outH - ih) / 2) + offsetY;
          ctx.drawImage(sc, 0, 0, srcW, srcH, dx, dy, iw, ih);
        } else {
          ctx.drawImage(sc, 0, 0, outW, outH);
        }
        processed.push({ id: `seq_${outIndex}`, data: canvas.toDataURL('image/webp', quality) });
        setProgress(Math.round(((outIndex + 1) / total) * 100));
      }
      const previewW = customCanvasEnabled ? targetWidth : nativeW;
      const previewH = customCanvasEnabled ? targetHeight : nativeH;
      const json = assets.length > 0
        ? buildCompositeLottie(processed, outW, outH, targetFps, mapAssetsToOutput(outW, outH, previewW, previewH))
        : buildSequencedLottie(processed, outW, outH, targetFps);
      setLastLottieData(json);
      downloadJson(json, 'joyflow_png_sequence');
      setStatus('DONE');
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  // ===== GIF export (with assets composite) =====
  const startGifExport = async () => {
    if (!gifFile) return;
    setIsProcessing(true); setStatus('PROCESSING'); setProgress(0);
    try {
      const buffer = await (await fetch(gifUrl!)).arrayBuffer();
      const gif = parseGIF(buffer);
      const frames = decompressFrames(gif, true);
      const filtered = frames.filter((_, i) => i % frameSkip === 0);
      const srcW = Math.floor(gif.lsd.width * scale);
      const srcH = Math.floor(gif.lsd.height * scale);
      const outW = customCanvasEnabled ? targetWidth : srcW;
      const outH = customCanvasEnabled ? targetHeight : srcH;
      const canvas = processCanvasRef.current!;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      canvas.width = outW; canvas.height = outH;
      const tc = document.createElement('canvas');
      tc.width = gif.lsd.width; tc.height = gif.lsd.height;
      const tctx = tc.getContext('2d')!;
      const sc = document.createElement('canvas');
      sc.width = srcW; sc.height = srcH;
      const sctx = sc.getContext('2d')!;
      const processed: ProcessedFrame[] = [];
      const fps = 15;
      for (let i = 0; i < filtered.length; i++) {
        const f = filtered[i];
        const fd = new ImageData(new Uint8ClampedArray(f.patch), f.dims.width, f.dims.height);
        tctx.putImageData(fd, f.dims.left, f.dims.top);
        sctx.clearRect(0, 0, srcW, srcH);
        sctx.drawImage(tc, 0, 0, srcW, srcH);
        if (chromaKey.enabled) applyChromaKey(sctx, srcW, srcH, chromaKey);
        ctx.clearRect(0, 0, outW, outH);
        if (customCanvasEnabled) {
          const iw = Math.floor(srcW * contentScale);
          const ih = Math.floor(srcH * contentScale);
          const dx = Math.floor((outW - iw) / 2) + offsetX;
          const dy = Math.floor((outH - ih) / 2) + offsetY;
          ctx.drawImage(sc, 0, 0, srcW, srcH, dx, dy, iw, ih);
        } else {
          ctx.drawImage(sc, 0, 0, outW, outH);
        }
        processed.push({ id: `gif_${i}`, data: canvas.toDataURL('image/webp', quality) });
        setProgress(Math.round(((i + 1) / filtered.length) * 100));
      }
      const previewGifW = customCanvasEnabled ? outW : Math.floor(gif.lsd.width);
      const previewGifH = customCanvasEnabled ? outH : Math.floor(gif.lsd.height);
      const json = assets.length > 0
        ? buildCompositeLottie(processed, outW, outH, fps, mapAssetsToOutput(outW, outH, previewGifW, previewGifH))
        : buildSequencedLottie(processed, outW, outH, fps);
      setLastLottieData(json);
      downloadJson(json);
      setStatus('DONE');
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  // ===== Video export =====
  const startVideoExport = async () => {
    const stage = previewStageRef.current;
    const v = stage?.videoEl;
    if (!v || !videoFile) return;
    setIsProcessing(true); setStatus('PROCESSING'); setProgress(0);
    try {
      const canvas = processCanvasRef.current!;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      const srcW = Math.floor(v.videoWidth * scale);
      const srcH = Math.floor(v.videoHeight * scale);
      const outW = customCanvasEnabled ? targetWidth : srcW;
      const outH = customCanvasEnabled ? targetHeight : srcH;
      canvas.width = outW; canvas.height = outH;
      const sc = document.createElement('canvas');
      sc.width = srcW; sc.height = srcH;
      const sctx = sc.getContext('2d')!;
      const frames: ProcessedFrame[] = [];
      const fps = 30;
      const total = Math.floor((v.duration * fps) / frameSkip);
      const targetFps = fps / frameSkip;
      let recorder: MediaRecorder | null = null;
      const chunks: Blob[] = [];
      if (exportFormat === 'MP4') {
        const stream = canvas.captureStream(0);
        const mime = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm;codecs=vp9';
        recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate * 1e6 });
        recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.start();
      }
      const wasPlaying = !v.paused;
      v.pause();
      for (let i = 0; i < total; i++) {
        const time = (i * frameSkip) / fps;
        if (time > v.duration) break;
        v.currentTime = time;
        await new Promise<void>((resolve) => {
          const onSeeked = () => {
            sctx.clearRect(0, 0, srcW, srcH);
            sctx.drawImage(v, 0, 0, srcW, srcH);
            if (chromaKey.enabled) applyChromaKey(sctx, srcW, srcH, chromaKey);
            ctx.clearRect(0, 0, outW, outH);
            if (customCanvasEnabled) {
              const iw = Math.floor(srcW * contentScale);
              const ih = Math.floor(srcH * contentScale);
              const dx = Math.floor((outW - iw) / 2) + offsetX;
              const dy = Math.floor((outH - ih) / 2) + offsetY;
              ctx.drawImage(sc, 0, 0, srcW, srcH, dx, dy, iw, ih);
            } else {
              ctx.drawImage(sc, 0, 0, outW, outH);
            }
            // MP4 模式直接烧录素材；Lottie 模式素材作为独立图层导出
            if (exportFormat === 'MP4' && assets.length > 0) {
              drawAssetsAt(ctx, time, outW, outH, v.videoWidth, v.videoHeight);
            }
            if (exportFormat === 'LOTTIE') {
              frames.push({ id: `f_${i}`, data: canvas.toDataURL('image/webp', quality) });
            } else if (recorder) {
              const tracks = (recorder.stream as MediaStream).getVideoTracks();
              if (tracks[0] && 'requestFrame' in tracks[0]) {
                // @ts-ignore
                tracks[0].requestFrame();
              }
            }
            setProgress(Math.round(((i + 1) / total) * 100));
            v.removeEventListener('seeked', onSeeked);
            resolve();
          };
          v.addEventListener('seeked', onSeeked);
        });
        if (exportFormat === 'MP4') await new Promise((r) => setTimeout(r, 20));
      }
      if (exportFormat === 'MP4' && recorder) {
        recorder.stop();
        await new Promise<void>((resolve) => {
          recorder!.onstop = () => {
            const blob = new Blob(chunks, { type: recorder!.mimeType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const ext = recorder!.mimeType.includes('mp4') ? 'mp4' : 'webm';
            a.href = url;
            a.download = `joyflow_video_${Date.now()}.${ext}`;
            a.click();
            URL.revokeObjectURL(url);
            resolve();
          };
        });
      } else {
        // 预览中 canvas 的像素尺寸：裁切模式=targetW/H，非裁切=原始视频尺寸
        const previewW = customCanvasEnabled ? targetWidth : v.videoWidth;
        const previewH = customCanvasEnabled ? targetHeight : v.videoHeight;
        const json = assets.length > 0
          ? buildCompositeLottie(
              frames, outW, outH, targetFps,
              mapAssetsToOutput(outW, outH, previewW, previewH)
            )
          : buildSequencedLottie(frames, outW, outH, targetFps);
        setLastLottieData(json);
        downloadJson(json);
      }
      setStatus('DONE');
      if (wasPlaying) v.play().catch(() => {});
    } catch (err) {
      console.error(err);
    } finally {
      setIsProcessing(false);
    }
  };

  // 把 assets transform（基于原始视频坐标）映射到输出画布坐标
  const mapAssetsToOutput = (outW: number, outH: number, previewW: number, previewH: number): ImageAsset[] => {
    // previewW/previewH = 预览 canvas 的像素尺寸
    // outW/outH = 导出目标尺寸
    // 坐标从预览系映射到输出系
    const sx = previewW > 0 ? outW / previewW : 1;
    const sy = previewH > 0 ? outH / previewH : 1;

    return assets.map((a) => {
      // 压缩素材图片质量（不改变尺寸，只压缩编码）
      const compSrc = compressImage(a.id, a.width, a.height, quality);
      // scale 也需要按 outW/previewW 的比例缩放
      // 因为素材原始尺寸不变，画布缩小时素材相对变大，需要等比缩小 scale
      const scaleFactor = Math.min(sx, sy);
      return {
        ...a,
        src: compSrc,
        keyframes: {
          x: a.keyframes.x.map((kf) => ({ ...kf, value: kf.value * sx })),
          y: a.keyframes.y.map((kf) => ({ ...kf, value: kf.value * sy })),
          scale: a.keyframes.scale.map((kf) => ({ ...kf, value: kf.value * scaleFactor })),
          rotation: a.keyframes.rotation.map((kf) => ({ ...kf })),
          opacity: a.keyframes.opacity.map((kf) => ({ ...kf })),
        },
        defaultTransform: {
          ...a.defaultTransform,
          x: a.defaultTransform.x * sx,
          y: a.defaultTransform.y * sy,
          scale: a.defaultTransform.scale * scaleFactor,
        },
      };
    });
  };

  // 压缩图片质量（保持原始尺寸，只压编码）
  const compressImage = (assetId: string, w: number, h: number, q: number): string => {
    const img = loadedImagesRef.current.get(assetId);
    if (!img) return '';
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL('image/webp', q);
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col">
      <header className="flex items-center justify-between px-6 h-14 border-b border-[var(--border-soft)] bg-[var(--bg-elev)]/60 backdrop-blur-md shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-[var(--primary)] to-[var(--accent)] flex items-center justify-center shadow-lg shadow-blue-900/30">
            <Sparkles className="text-white" size={18} />
          </div>
          <div>
            <h1 className="text-base font-bold tracking-tight leading-none">{t.title}</h1>
            <p className="text-[10px] text-neutral-500 font-mono mt-0.5">{t.subtitle}</p>
          </div>
        </div>
        <div className="topbar-glass-group flex items-center p-0.5">
          <button
            onClick={() => { setActiveMode('ai'); setStatus('IDLE'); }}
            className={`topbar-glass-button ${
              activeMode === 'ai' ? 'is-active' : ''
            }`}
          >
            <Wand2 size={14} /> {lang === 'zh' ? '资产生成' : 'Asset Studio'}
          </button>
          <button
            onClick={() => { setActiveMode('atlas'); setStatus('IDLE'); }}
            className={`topbar-glass-button ${activeMode === 'atlas' ? 'is-active' : ''}`}
          >
            <BookOpen size={14} /> {lang === 'zh' ? '图鉴生产' : 'Atlas Workflow'}
          </button>
          <button
            onClick={() => { setActiveMode('specialty'); setStatus('IDLE'); }}
            className={`topbar-glass-button ${activeMode === 'specialty' ? 'is-active' : ''}`}
          >
            <Gift size={14} /> {lang === 'zh' ? '特产道具' : 'Specialty Props'}
          </button>
          <button
            onClick={() => { setActiveMode(lastFormatMode); setStatus('IDLE'); }}
            className={`topbar-glass-button ${
              activeMode === 'video' || activeMode === 'sequence' || activeMode === 'gif' ? 'is-active' : ''
            }`}
          >
            <ArrowLeftRight size={14} /> {lang === 'zh' ? '转格式工具' : 'Format Tools'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setWorkflowBackground(null); setWorkflowProjectId(null); setWorkflowJoyState(null); setJoyBridgeOpen(true); }} className="topbar-action-button" title="JOY 3D Controller POC">
            <Package size={14} />
            JOY 控制
          </button>
          <button onClick={() => lottieInputRef.current?.click()} className="topbar-action-button" title={lang === 'zh' ? '预览 Lottie JSON' : 'Preview Lottie JSON'}>
            <FileJson size={14} />
            {lang === 'zh' ? 'Lottie 预览' : 'Lottie Preview'}
          </button>
          <button onClick={openAssetLibrary} className="topbar-action-button" title="素材仓库">
            <Package size={14} />
            {lang === 'zh' ? '仓库' : 'Library'}
          </button>
          <button onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} className="topbar-action-button">
            <Languages size={14} />
            {t.languageBtn}
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* AI模式 - 始终挂载，通过display控制显隐以保留状态 */}
        <div className={`flex-1 flex flex-col overflow-hidden ${activeMode === 'ai' ? '' : 'hidden'}`}>
          <AIStudio />
        </div>

        <div className={`flex-1 flex flex-col overflow-hidden ${activeMode === 'atlas' ? '' : 'hidden'}`}>
          <AtlasWorkspace
            revision={atlasRevision}
            onEnterJoy={(asset, joyState, projectId) => {
              setWorkflowBackground(asset);
              setWorkflowProjectId(projectId);
              setWorkflowJoyState(joyState as JoyState | null);
              setJoyBridgeOpen(true);
            }}
          />
        </div>

        <div className={`flex-1 flex flex-col overflow-hidden ${activeMode === 'specialty' ? '' : 'hidden'}`}>
          <SpecialtyWorkspace />
        </div>

        {/* 视频/GIF模式 */}
        <div className={`flex-1 flex flex-col overflow-hidden ${activeMode !== 'ai' && activeMode !== 'atlas' && activeMode !== 'specialty' ? '' : 'hidden'}`}>
        <div className="format-tool-tabs-bar shrink-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-neutral-300">
            <ArrowLeftRight size={14} className="text-[var(--primary)]" />
            <span>{lang === 'zh' ? '转格式工具' : 'Format Tools'}</span>
          </div>
          <div className="format-tool-tabs" role="tablist" aria-label={lang === 'zh' ? '转格式类型' : 'Format type'}>
            <button
              role="tab"
              aria-selected={activeMode === 'video'}
              onClick={() => { setActiveMode('video'); setStatus('IDLE'); }}
              className={`format-tool-tab ${activeMode === 'video' ? 'is-active' : ''}`}
            >
              <FileVideo size={14} /> {t.videoMode}
            </button>
            <button
              role="tab"
              aria-selected={activeMode === 'sequence'}
              onClick={() => { setActiveMode('sequence'); setExportFormat('LOTTIE'); setStatus('IDLE'); }}
              className={`format-tool-tab ${activeMode === 'sequence' ? 'is-active' : ''}`}
            >
              <Images size={14} /> {t.sequenceMode}
            </button>
            <button
              role="tab"
              aria-selected={activeMode === 'gif'}
              onClick={() => { setActiveMode('gif'); setExportFormat('LOTTIE'); setStatus('IDLE'); }}
              className={`format-tool-tab ${activeMode === 'gif' ? 'is-active' : ''}`}
            >
              <ImageIcon size={14} /> {t.gifMode}
            </button>
          </div>
        </div>
        {/* 上部：三栏 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 左：图层面板 */}
          <LayerPanel
            t={t} lang={lang}
            assets={assets} setAssets={setAssets}
            selectedAssetId={selectedAssetId} setSelectedAssetId={setSelectedAssetId}
            onAssetUpload={onAssetUpload}
            onOpenLibrary={openAssetLibrary}
          />

          {/* 中：预览区 */}
          <div className="flex-1 relative overflow-hidden">
            {/* 顶部信息条 */}
            <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-1.5 bg-[var(--bg-elev)]/70 backdrop-blur-sm border-b border-[var(--border-soft)]">
              <div className="flex items-center gap-2">
                <Eye size={14} className="text-[var(--primary)]" />
                <span className="text-xs font-semibold">{t.previewStage}</span>
                {hasFile && (
                  <span className="text-[10px] font-mono text-neutral-500">
                    {videoDimensions.w}×{videoDimensions.h}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                {hasFile && (
                  <div className="flex items-center gap-1 text-[10px] font-mono text-neutral-500 bg-neutral-900/50 rounded px-2 py-0.5">
                    <span>{outputW}×{outputH}</span>
                    {lottieSizeKB > 0 && (<><span className="text-neutral-700">|</span><span className="text-[var(--primary)]">{lottieSizeKB}KB</span></>)}
                  </div>
                )}
                {hasFile && (
                  <button
                    onClick={() => {
                      setVideoFile(null); setVideoUrl(null);
                      setSequenceFiles([]); setSequenceFrames([]); setSequenceUrls([]);
                      setGifFile(null); setGifUrl(null);
                      setStatus('IDLE'); setLastLottieData(null);
                      setAssets([]); setSelectedAssetId(null);
                      setCurrentTime(0); setDuration(0);
                    }}
                    className="text-neutral-500 hover:text-red-400 transition-colors p-1"
                    title={t.replaceFile}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>

            {/* 预览内容 */}
            {!hasFile ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-neutral-500 preview-dot-grid">
                <div className="w-20 h-20 rounded-full bg-[var(--bg-elev-2)]/70 border border-dashed border-neutral-700 flex items-center justify-center">
                  <Upload size={32} />
                </div>
                <div className="text-center">
                  <p className="text-sm text-neutral-400 font-medium">{t.noFile}</p>
                  <p className="text-xs text-neutral-600 mt-1">{t.noFileDesc}</p>
                </div>
              </div>
            ) : (
              <PreviewStage
                ref={previewStageRef}
                videoUrl={videoUrl}
                gifUrl={gifUrl}
                sequenceFrames={sequenceFrames}
                activeMode={activeMode === 'sequence' || activeMode === 'gif' ? activeMode : 'video'}
                chromaKey={chromaKey}
                assets={assets}
                setAssets={setAssets}
                loadedImages={loadedImagesRef.current}
                selectedAssetId={selectedAssetId}
                setSelectedAssetId={setSelectedAssetId}
                currentTime={currentTime}
                setCurrentTime={setCurrentTime}
                setDuration={setDuration}
                playing={playing}
                setPlaying={setPlaying}
                onVideoLoaded={onVideoLoaded}
                canvasCrop={customCanvasEnabled ? {
                  enabled: true,
                  targetW: targetWidth,
                  targetH: targetHeight,
                  contentScale,
                  offsetX,
                  offsetY,
                } : undefined}
              />
            )}

            {/* Processing overlay */}
            {isProcessing && (
              <div className="absolute inset-0 bg-black/75 backdrop-blur-sm flex flex-col items-center justify-center gap-4 z-50">
                <div className="w-12 h-12 border-4 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
                <div className="text-center">
                  <h3 className="font-semibold">{t.processing}</h3>
                  <p className="text-xs text-neutral-400 mt-1">{t.processingDesc}</p>
                </div>
                <div className="w-64 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                  <motion.div className="h-full bg-[var(--primary)]" animate={{ width: `${progress}%` }} />
                </div>
                <span className="text-xs font-mono text-neutral-400">{progress}%</span>
              </div>
            )}

            {/* Lottie 预览覆盖层 - 铺满预览区 */}
            <AnimatePresence>
              {lastLottieData && !isProcessing && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 z-30 bg-[var(--bg-base)] flex flex-col"
                >
                  <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-soft)] shrink-0">
                    <div className="flex items-center gap-2 text-xs font-semibold">
                      <FileJson size={14} className="text-green-400" />
                      {t.lottiePreview} · {lottieSizeKB}KB
                    </div>
                    <button onClick={() => setLastLottieData(null)} className="text-neutral-400 hover:text-white text-sm px-2 py-1 rounded hover:bg-white/10 transition-colors">✕</button>
                  </div>
                  <div className="flex-1 checker-bg flex items-center justify-center p-4 overflow-hidden">
                    <Lottie animationData={lastLottieData} loop style={{ maxHeight: '100%', maxWidth: '100%' }} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 右：控制面板 */}
          <ControlPanel
            t={t} lang={lang} setLang={setLang} activeMode={activeMode === 'sequence' || activeMode === 'gif' ? activeMode : 'video'}
            open={open} setOpen={setOpen}
            hasFile={hasFile} videoFileName={sourceFileName}
            handleFileChange={handleFileChange}
            chromaKey={chromaKey} setChromaKey={setChromaKey}
            customCanvasEnabled={customCanvasEnabled} setCustomCanvasEnabled={setCustomCanvasEnabled}
            targetWidthInput={targetWidthInput} setTargetWidthInput={setTargetWidthInput}
            targetHeightInput={targetHeightInput} setTargetHeightInput={setTargetHeightInput}
            contentScale={contentScale} setContentScale={setContentScale}
            offsetX={offsetX} setOffsetX={setOffsetX}
            offsetY={offsetY} setOffsetY={setOffsetY}
            videoDimensions={videoDimensions} scale={scale} setScale={setScale}
            exportFormat={exportFormat} setExportFormat={setExportFormat}
            frameSkip={frameSkip} setFrameSkip={setFrameSkip}
            quality={quality} setQuality={setQuality}
            bitrate={bitrate} setBitrate={setBitrate}
            status={status} startExport={startExport} isProcessing={isProcessing}
            onOpenLibrary={openSourceLibrary}
          />
        </div>

        {/* 底部：时间轴 + 属性面板 */}
        {hasFile && (
          <BottomPanel
            t={t} lang={lang}
            duration={duration}
            currentTime={currentTime}
            setCurrentTime={(time) => {
              setCurrentTime(time);
              previewStageRef.current?.setCurrentTime(time);
            }}
            playing={playing}
            setPlaying={setPlaying}
            assets={assets}
            setAssets={setAssets}
            selectedAssetId={selectedAssetId}
            setSelectedAssetId={setSelectedAssetId}
            onAddKeyframe={onAddKeyframe}
          />
        )}
        </div>
      </main>

      <canvas ref={processCanvasRef} className="hidden" />
      <input
        ref={lottieInputRef}
        type="file"
        accept="application/json,.json,.lottie"
        className="hidden"
        onChange={handleLottiePreviewUpload}
      />
      <AssetLibrary
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onSelectAsset={onSelectFromLibrary}
        onLocalUpload={libraryMode === 'asset' ? onAssetUpload : undefined}
        onSourceUpload={libraryMode === 'source' && activeMode === 'video' ? handleFileChange : undefined}
        sourceUploadAccept="video/*"
        defaultFilter={libraryMode === 'source' ? 'video' : undefined}
      />
      <JoyBridgePanel
        open={joyBridgeOpen}
        onClose={() => setJoyBridgeOpen(false)}
        onAddCapture={addJoyCaptureAsAsset}
        initialBackground={workflowBackground}
        initialState={workflowJoyState}
        workflowProjectId={workflowProjectId}
        onStateChange={handleWorkflowJoyStateChange}
        onWorkflowResult={acceptWorkflowResult}
      />
    </div>
  );
}

const StatItem: React.FC<{ label: string; value: string; accent?: boolean }> = ({ label, value, accent }) => (
  <div className="px-4 py-3">
    <p className="text-[10px] uppercase tracking-wider text-neutral-500">{label}</p>
    <p className={`text-sm font-mono mt-0.5 font-semibold ${accent ? 'text-[var(--primary)]' : 'text-neutral-200'}`}>{value}</p>
  </div>
);
