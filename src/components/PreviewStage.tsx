import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import type { ImageAsset, ChromaKeyOptions, AssetTransform } from '../types';
import { applyChromaKey } from '../utils/chromaKey';
import { getTransformAtTime } from '../utils/interpolate';

export interface PreviewStageHandle {
  videoEl: HTMLVideoElement | null;
  getCurrentTime: () => number;
  setCurrentTime: (t: number) => void;
  play: () => void;
  pause: () => void;
}

export interface PreviewStageProps {
  videoUrl: string | null;
  gifUrl: string | null;
  sequenceFrames?: HTMLImageElement[];
  activeMode: 'video' | 'sequence' | 'gif';
  chromaKey: ChromaKeyOptions;
  assets: ImageAsset[];
  setAssets: (next: ImageAsset[]) => void;
  loadedImages: Map<string, HTMLImageElement>;
  selectedAssetId: string | null;
  setSelectedAssetId: (id: string | null) => void;
  currentTime: number;
  setCurrentTime: (t: number) => void;
  setDuration: (d: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  onVideoLoaded: (w: number, h: number) => void;
  // 画布裁切参数（实时预览）
  canvasCrop?: {
    enabled: boolean;
    targetW: number;
    targetH: number;
    contentScale: number;
    offsetX: number;
    offsetY: number;
  };
}

type DragMode = 'move' | 'scale' | 'rotate' | null;

export const PreviewStage = forwardRef<PreviewStageHandle, PreviewStageProps>(function PreviewStage(props, ref) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; startTransform: AssetTransform | null }>({
    mode: null, startX: 0, startY: 0, startTransform: null,
  });
  const [canvasSize, setCanvasSize] = useState({ w: 800, h: 450 });
  // 滚轮缩放与平移
  const [viewScale, setViewScale] = useState(1);
  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 });
  const panRef = useRef<{ active: boolean; startX: number; startY: number; baseX: number; baseY: number }>({
    active: false, startX: 0, startY: 0, baseX: 0, baseY: 0,
  });
  // 绿幕缓存：避免每帧重复扫描像素
  const chromaCacheRef = useRef<HTMLCanvasElement | null>(null);
  const lastChromaKeyTimeRef = useRef<number>(-1);
  const pendingSeekTimeRef = useRef<number | null>(null);
  const seekRafRef = useRef<number>(0);
  const seekInFlightRef = useRef(false);
  // chromaKey 配置变化时强制重算
  useEffect(() => { lastChromaKeyTimeRef.current = -1; chromaCacheRef.current = null; }, [props.chromaKey]);

  // 用 ref 保存最新 props，供 RAF 读取（避免 useEffect 重建）
  const propsRef = useRef(props);
  propsRef.current = props;

  useImperativeHandle(ref, () => ({
    videoEl: videoRef.current,
    getCurrentTime: () => videoRef.current?.currentTime ?? 0,
    setCurrentTime: (t) => queueVideoSeek(t),
    play: () => videoRef.current?.play(),
    pause: () => videoRef.current?.pause(),
  }));

  const queueVideoSeek = (time: number) => {
    const v = videoRef.current;
    if (!v || !Number.isFinite(time)) return;
    const duration = Number.isFinite(v.duration) ? v.duration : time;
    pendingSeekTimeRef.current = Math.max(0, Math.min(duration, time));
    if (seekRafRef.current) return;
    seekRafRef.current = requestAnimationFrame(flushQueuedSeek);
  };

  const flushQueuedSeek = () => {
    seekRafRef.current = 0;
    const v = videoRef.current;
    const target = pendingSeekTimeRef.current;
    if (!v || target == null) return;
    if (seekInFlightRef.current) return;
    if (Math.abs(v.currentTime - target) < 0.006) {
      pendingSeekTimeRef.current = null;
      return;
    }
    seekInFlightRef.current = true;
    v.currentTime = target;
  };

  // sync video play state
  useEffect(() => {
    if (!videoRef.current) return;
    if (props.playing) videoRef.current.play().catch(() => {});
    else videoRef.current.pause();
  }, [props.playing]);

  // listen to video timeupdate to push back to global currentTime
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      if (pendingSeekTimeRef.current != null || seekInFlightRef.current) return;
      propsRef.current.setCurrentTime(v.currentTime);
    };
    const onSeeked = () => {
      seekInFlightRef.current = false;
      const pending = pendingSeekTimeRef.current;
      if (pending == null || Math.abs(v.currentTime - pending) < 0.006) {
        pendingSeekTimeRef.current = null;
        propsRef.current.setCurrentTime(v.currentTime);
        return;
      }
      if (!seekRafRef.current) seekRafRef.current = requestAnimationFrame(flushQueuedSeek);
    };
    const onLoaded = () => {
      propsRef.current.onVideoLoaded(v.videoWidth, v.videoHeight);
      propsRef.current.setDuration(v.duration || 0);
      fitCanvas(); // 视频 metadata 加载后重新计算画布尺寸
    };
    const onPlay = () => propsRef.current.setPlaying(true);
    const onPause = () => propsRef.current.setPlaying(false);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('loadedmetadata', onLoaded);
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('loadedmetadata', onLoaded);
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
    };
  }, [props.videoUrl]);

  // === Render Loop (runs continuously, reads from refs) ===
  useEffect(() => {
    let raf = 0;
    const render = () => {
      raf = requestAnimationFrame(render);
      const canvas = canvasRef.current;
      const v = videoRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      const p = propsRef.current;

      // 视频模式下，如果视频还没准备好当前帧（seek中），跳过本次绘制保留上一帧
      if (p.activeMode === 'video' && v && v.readyState < 2) return;

      const time = p.activeMode === 'video' && v ? v.currentTime : p.currentTime;
      const sequenceFrame = p.activeMode === 'sequence' && p.sequenceFrames?.length
        ? p.sequenceFrames[Math.min(p.sequenceFrames.length - 1, Math.max(0, Math.floor(time * 30)))]
        : null;

      ctx.clearRect(0, 0, w, h);

      // 辅助：从后往前绘制（数组第0项=最顶层，最后画）
      const drawAssets = (filter: (a: any) => boolean) => {
        const list = p.assets.filter((a) => a.visible && filter(a));
        // 从末尾画到开头 → 数组前面的覆盖后面的（最顶层）
        for (let i = list.length - 1; i >= 0; i--) {
          const asset = list[i];
          const img = p.loadedImages.get(asset.id);
          if (!img) continue;
          const tr = getTransformAtTime(asset.keyframes, time, asset.defaultTransform);
          ctx.save();
          ctx.globalAlpha = tr.opacity;
          ctx.translate(tr.x, tr.y);
          ctx.rotate((tr.rotation * Math.PI) / 180);
          ctx.scale(tr.scale, tr.scale);
          ctx.drawImage(img, -asset.width / 2, -asset.height / 2);
          ctx.restore();
        }
      };

      // 1. 先画"视频之下"素材
      drawAssets((a) => !!a.zBelowVideo);

      // 2. 画视频（支持画布裁切预览）
      if (p.activeMode === 'video' && v) {
        if (p.canvasCrop?.enabled) {
          // 裁切模式：先在临时 canvas 画原始视频+绿幕，再按 crop 参数缩放偏移绘制到主 canvas
          const srcW = v.videoWidth;
          const srcH = v.videoHeight;
          if (p.chromaKey.enabled) {
            const key = Math.round(v.currentTime * 60) / 60;
            if (key !== lastChromaKeyTimeRef.current || !chromaCacheRef.current || chromaCacheRef.current.width !== srcW) {
              if (!chromaCacheRef.current || chromaCacheRef.current.width !== srcW || chromaCacheRef.current.height !== srcH) {
                chromaCacheRef.current = document.createElement('canvas');
                chromaCacheRef.current.width = srcW; chromaCacheRef.current.height = srcH;
              }
              const cctx = chromaCacheRef.current.getContext('2d', { willReadFrequently: true })!;
              cctx.clearRect(0, 0, srcW, srcH);
              cctx.drawImage(v, 0, 0, srcW, srcH);
              applyChromaKey(cctx, srcW, srcH, p.chromaKey);
              lastChromaKeyTimeRef.current = key;
            }
            const iw = Math.floor(srcW * p.canvasCrop.contentScale);
            const ih = Math.floor(srcH * p.canvasCrop.contentScale);
            const dx = Math.floor((w - iw) / 2) + p.canvasCrop.offsetX;
            const dy = Math.floor((h - ih) / 2) + p.canvasCrop.offsetY;
            ctx.drawImage(chromaCacheRef.current, 0, 0, srcW, srcH, dx,dy, iw, ih);
          } else {
            const iw = Math.floor(srcW * p.canvasCrop.contentScale);
            const ih = Math.floor(srcH * p.canvasCrop.contentScale);
            const dx = Math.floor((w - iw) / 2) + p.canvasCrop.offsetX;
            const dy = Math.floor((h - ih) / 2) + p.canvasCrop.offsetY;
            ctx.drawImage(v, 0, 0, srcW, srcH, dx, dy, iw, ih);
          }
        } else {
          // 非裁切模式：填满 canvas
          if (p.chromaKey.enabled) {
            const key = Math.round(v.currentTime * 60) / 60;
            if (key !== lastChromaKeyTimeRef.current || !chromaCacheRef.current || chromaCacheRef.current.width !== w) {
              if (!chromaCacheRef.current || chromaCacheRef.current.width !== w || chromaCacheRef.current.height !== h) {
                chromaCacheRef.current = document.createElement('canvas');
                chromaCacheRef.current.width = w; chromaCacheRef.current.height = h;
              }
              const cctx = chromaCacheRef.current.getContext('2d', { willReadFrequently: true })!;
              cctx.clearRect(0, 0, w, h);
              cctx.drawImage(v, 0, 0, w, h);
              applyChromaKey(cctx, w, h, p.chromaKey);
              lastChromaKeyTimeRef.current = key;
            }
            ctx.drawImage(chromaCacheRef.current, 0, 0);
          } else {
            ctx.drawImage(v, 0, 0, w, h);
          }
        }
      }
      if (p.activeMode === 'sequence' && sequenceFrame) {
        if (p.canvasCrop?.enabled) {
          const srcW = sequenceFrame.naturalWidth || sequenceFrame.width;
          const srcH = sequenceFrame.naturalHeight || sequenceFrame.height;
          const iw = Math.floor(srcW * p.canvasCrop.contentScale);
          const ih = Math.floor(srcH * p.canvasCrop.contentScale);
          const dx = Math.floor((w - iw) / 2) + p.canvasCrop.offsetX;
          const dy = Math.floor((h - ih) / 2) + p.canvasCrop.offsetY;
          ctx.drawImage(sequenceFrame, 0, 0, srcW, srcH, dx, dy, iw, ih);
        } else {
          ctx.drawImage(sequenceFrame, 0, 0, w, h);
        }
      }

      // 3. 画"视频之上"素材
      drawAssets((a) => !a.zBelowVideo);

      // 4. Draw selection bounding box
      if (p.selectedAssetId) {
        const a = p.assets.find((x) => x.id === p.selectedAssetId);
        if (a) {
          const tr = getTransformAtTime(a.keyframes, time, a.defaultTransform);
          ctx.save();
          ctx.translate(tr.x, tr.y);
          ctx.rotate((tr.rotation * Math.PI) / 180);
          const halfW = (a.width * tr.scale) / 2;
          const halfH = (a.height * tr.scale) / 2;
          ctx.strokeStyle = '#4f7cff';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([6, 4]);
          ctx.strokeRect(-halfW, -halfH, halfW * 2, halfH * 2);
          ctx.setLineDash([]);
          ctx.fillStyle = '#4f7cff';
          [[-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH]].forEach(([cx, cy]) => {
            ctx.fillRect(cx - 4, cy - 4, 8, 8);
          });
          ctx.restore();
        }
      }
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, []);  // 空依赖：常驻循环，不会因 props 变化重建

  // resize canvas based on video / gif size, keep within container
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => fitCanvas());
    ro.observe(container);
    fitCanvas();
    return () => ro.disconnect();
  }, [props.videoUrl, props.gifUrl, props.sequenceFrames, props.activeMode, props.canvasCrop?.enabled, props.canvasCrop?.targetW, props.canvasCrop?.targetH]);

  const fitCanvas = () => {
    const c = containerRef.current;
    if (!c) return;
    const cw = c.clientWidth;
    const ch = c.clientHeight;
    if (cw <= 0 || ch <= 0) return;
    const v = videoRef.current;
    const p = propsRef.current;
    let nativeW = 1280, nativeH = 720;
    if (p.canvasCrop?.enabled) {
      nativeW = p.canvasCrop.targetW;
      nativeH = p.canvasCrop.targetH;
    } else if (p.activeMode === 'video' && v && v.videoWidth) {
      nativeW = v.videoWidth;
      nativeH = v.videoHeight;
    } else if (p.activeMode === 'sequence' && p.sequenceFrames?.[0]) {
      nativeW = p.sequenceFrames[0].naturalWidth || p.sequenceFrames[0].width;
      nativeH = p.sequenceFrames[0].naturalHeight || p.sequenceFrames[0].height;
    }
    const ratio = nativeW / nativeH;
    let w = cw, h = cw / ratio;
    if (h > ch) { h = ch; w = ch * ratio; }
    w = Math.max(50, Math.floor(w));
    h = Math.max(50, Math.floor(h));
    setCanvasSize({ w, h });
    const canvas = canvasRef.current;
    if (canvas) { canvas.width = nativeW; canvas.height = nativeH; }
  };

  // === Wheel zoom ===
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setViewScale((s) => Math.max(0.1, Math.min(8, s * (1 + delta))));
  };

  // === Right-button pan (or middle button) ===
  const onPanStart = (e: React.MouseEvent) => {
    if (e.button !== 1 && e.button !== 2) return;
    e.preventDefault();
    panRef.current = {
      active: true, startX: e.clientX, startY: e.clientY,
      baseX: viewOffset.x, baseY: viewOffset.y,
    };
  };
  const onPanMove = (e: React.MouseEvent) => {
    if (!panRef.current.active) return;
    setViewOffset({
      x: panRef.current.baseX + (e.clientX - panRef.current.startX),
      y: panRef.current.baseY + (e.clientY - panRef.current.startY),
    });
  };
  const onPanEnd = () => { panRef.current.active = false; };
  const resetView = () => { setViewScale(1); setViewOffset({ x: 0, y: 0 }); };

  // === Mouse Interactions ===
  const getCanvasCoord = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  const hitTestAsset = (px: number, py: number): string | null => {
    const p = propsRef.current;
    // 反向遍历：最上层先被选中
    for (let i = p.assets.length - 1; i >= 0; i--) {
      const a = p.assets[i];
      if (!a.visible) continue;
      const tr = getTransformAtTime(a.keyframes, videoRef.current?.currentTime ?? p.currentTime, a.defaultTransform);
      const dx = px - tr.x;
      const dy = py - tr.y;
      const cos = Math.cos((-tr.rotation * Math.PI) / 180);
      const sin = Math.sin((-tr.rotation * Math.PI) / 180);
      const lx = dx * cos - dy * sin;
      const ly = dx * sin + dy * cos;
      const halfW = (a.width * tr.scale) / 2;
      const halfH = (a.height * tr.scale) / 2;
      if (lx >= -halfW && lx <= halfW && ly >= -halfH && ly <= halfH) {
        return a.id;
      }
    }
    return null;
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // 只处理左键
    const { x, y } = getCanvasCoord(e);
    const hit = hitTestAsset(x, y);
    propsRef.current.setSelectedAssetId(hit);
    if (hit) {
      const p = propsRef.current;
      const a = p.assets.find((x) => x.id === hit)!;
      const tr = getTransformAtTime(a.keyframes, videoRef.current?.currentTime ?? p.currentTime, a.defaultTransform);
      dragRef.current = {
        mode: e.shiftKey ? 'scale' : (e.altKey ? 'rotate' : 'move'),
        startX: x, startY: y,
        startTransform: { ...tr },
      };
    }
  };

  const onMouseMove = (e: React.MouseEvent) => {
    const p = propsRef.current;
    if (!dragRef.current.mode || !dragRef.current.startTransform || !p.selectedAssetId) return;
    const { x, y } = getCanvasCoord(e);
    const dx = x - dragRef.current.startX;
    const dy = y - dragRef.current.startY;
    const a = p.assets.find((x) => x.id === p.selectedAssetId);
    if (!a) return;
    const start = dragRef.current.startTransform;
    let next: AssetTransform = { ...start };
    if (dragRef.current.mode === 'move') {
      next.x = start.x + dx;
      next.y = start.y + dy;
    } else if (dragRef.current.mode === 'scale') {
      const factor = 1 + dx / 200;
      next.scale = Math.max(0.05, start.scale * factor);
    } else if (dragRef.current.mode === 'rotate') {
      next.rotation = start.rotation + dx / 2;
    }
    // 更新素材属性：只修改当前时刻的帧（±0.05s），没有则改 defaultTransform
    const time = videoRef.current?.currentTime ?? p.currentTime;
    const updateTrack = (track: any[], val: number) => {
      const exact = track.findIndex((k: any) => Math.abs(k.time - time) < 0.05);
      if (exact >= 0) {
        return track.map((k: any, i: number) => i === exact ? { ...k, value: val } : k);
      }
      return null; // 当前时刻没有帧 → 改 defaultTransform
    };

    const xTrack = updateTrack(a.keyframes.x, next.x);
    const yTrack = updateTrack(a.keyframes.y, next.y);
    const scaleTrack = updateTrack(a.keyframes.scale, next.scale);
    const rotTrack = updateTrack(a.keyframes.rotation, next.rotation);
    const opTrack = updateTrack(a.keyframes.opacity, next.opacity);

    const newKfs = {
      x: xTrack ?? a.keyframes.x,
      y: yTrack ?? a.keyframes.y,
      scale: scaleTrack ?? a.keyframes.scale,
      rotation: rotTrack ?? a.keyframes.rotation,
      opacity: opTrack ?? a.keyframes.opacity,
    };
    const newDefault = {
      ...a.defaultTransform,
      ...(xTrack === null ? { x: next.x } : {}),
      ...(yTrack === null ? { y: next.y } : {}),
      ...(scaleTrack === null ? { scale: next.scale } : {}),
      ...(rotTrack === null ? { rotation: next.rotation } : {}),
      ...(opTrack === null ? { opacity: next.opacity } : {}),
    };
    p.setAssets(p.assets.map((x) => x.id === a.id ? { ...x, keyframes: newKfs, defaultTransform: newDefault } : x));
  };

  const onMouseUp = () => {
    dragRef.current = { mode: null, startX: 0, startY: 0, startTransform: null };
  };

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 preview-dot-grid overflow-hidden select-none"
      onWheel={onWheel}
      onMouseDown={onPanStart}
      onMouseMove={onPanMove}
      onMouseUp={onPanEnd}
      onMouseLeave={onPanEnd}
      onContextMenu={(e) => e.preventDefault()}
      onDoubleClick={(e) => { if (e.button === 0 && (e.target as HTMLElement).tagName !== 'CANVAS') resetView(); }}
    >
      {/* Zoom level indicator + reset */}
      <div className="absolute top-2 right-2 z-20 flex items-center gap-1.5 panel-sub px-2 py-1 text-[10px] font-mono text-neutral-400">
        <span>{Math.round(viewScale * 100)}%</span>
        <button onClick={resetView} className="text-neutral-500 hover:text-neutral-200 ml-1" title="重置视图">⟳</button>
      </div>
      {/* video element kept visible (1px) to ensure browser actually decodes frames */}
      {props.activeMode === 'video' && props.videoUrl && (
        <video
          ref={videoRef}
          src={props.videoUrl}
          className="absolute opacity-0 pointer-events-none"
          style={{ width: 1, height: 1, left: 0, top: 0 }}
          loop
          muted
          autoPlay
          playsInline
          crossOrigin="anonymous"
        />
      )}
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{
          transform: `translate(${viewOffset.x}px, ${viewOffset.y}px) scale(${viewScale})`,
          transformOrigin: 'center center',
          transition: panRef.current.active ? 'none' : 'transform 0.05s linear',
        }}
      >
        {props.activeMode === 'gif' && props.gifUrl ? (
          <img src={props.gifUrl} className="max-w-full max-h-full object-contain" alt="preview" draggable={false} />
        ) : props.videoUrl || (props.activeMode === 'sequence' && props.sequenceFrames?.length) ? (
          <canvas
            ref={canvasRef}
            style={{
              width: canvasSize.w,
              height: canvasSize.h,
              cursor: props.selectedAssetId ? 'move' : 'default',
              maxWidth: '100%',
              maxHeight: '100%',
            }}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
          />
        ) : null}
      </div>
    </div>
  );
});
