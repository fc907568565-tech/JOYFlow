import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Play, Pause, SkipBack, Diamond, ChevronRight, ChevronDown } from 'lucide-react';
import type { ImageAsset, PropKeyframe, TransformProp } from '../types';
import type { T } from '../i18n';
import { getTransformAtTime, upsertPropKeyframe, addKeyframeAllProps } from '../utils/interpolate';

interface BottomPanelProps {
  t: T;
  lang: 'zh' | 'en';
  duration: number;
  currentTime: number;
  setCurrentTime: (t: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  assets: ImageAsset[];
  setAssets: (next: ImageAsset[]) => void;
  selectedAssetId: string | null;
  setSelectedAssetId: (id: string | null) => void;
  onAddKeyframe: () => void;
}

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s - Math.floor(s)) * 100);
  return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
};

const TIMELINE_FPS = 30;
const fmtSecondTick = (s: number) => `${Math.max(0, Math.round(s))}s`;
const fmtFrame = (s: number) => `${Math.max(0, Math.round(s * TIMELINE_FPS))}f`;

type PropRow = { key: string; props: TransformProp[]; label: { zh: string; en: string } };
const PROP_ROWS: PropRow[] = [
  { key: 'pos', props: ['x', 'y'], label: { zh: '位置', en: 'Position' } },
  { key: 'scale', props: ['scale'], label: { zh: '缩放', en: 'Scale' } },
  { key: 'rotation', props: ['rotation'], label: { zh: '旋转', en: 'Rotation' } },
  { key: 'opacity', props: ['opacity'], label: { zh: '不透明度', en: 'Opacity' } },
];

export const BottomPanel: React.FC<BottomPanelProps> = (p) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingCursorRef = useRef(false);
  const seekFrameRef = useRef<number>(0);
  const pendingSeekRef = useRef<number | null>(null);
  const [expandedAssets, setExpandedAssets] = useState<Set<string>>(new Set());
  // 左侧属性区宽度（可拖拽调整）
  const [labelWidth, setLabelWidth] = useState(220);
  // 时间轴缩放
  const [viewStart, setViewStart] = useState(0);
  const [viewEnd, setViewEnd] = useState(1);
  // 双击编辑状态
  const [editingVal, setEditingVal] = useState<{ assetId: string; prop: TransformProp } | null>(null);
  const [editInput, setEditInput] = useState('');
  const [visualTime, setVisualTime] = useState(p.currentTime);

  const toggleExpand = (id: string) => {
    setExpandedAssets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const lockSelection = (lock: boolean) => {
    document.body.style.userSelect = lock ? 'none' : '';
    document.body.style.cursor = lock ? 'grabbing' : '';
  };

  // 将屏幕位置转换为时间（考虑 viewStart/viewEnd 缩放）
  const posToTime = (clientX: number) => {
    const el = trackRef.current;
    if (!el || p.duration <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return (viewStart + ratio * (viewEnd - viewStart)) * p.duration;
  };

  const timeToPercent = (time: number) => {
    const range = viewEnd - viewStart;
    if (range <= 0 || p.duration <= 0) return 0;
    return ((time / p.duration - viewStart) / range) * 100;
  };

  useEffect(() => {
    setVisualTime((current) => {
      const shouldSnap = !p.playing || Math.abs(current - p.currentTime) > 0.18;
      return shouldSnap ? p.currentTime : current;
    });
  }, [p.currentTime, p.playing]);

  useEffect(() => {
    if (!p.playing || p.duration <= 0) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(0.08, (now - last) / 1000);
      last = now;
      setVisualTime((time) => {
        const next = time + delta;
        return p.duration > 0 ? next % p.duration : 0;
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [p.playing, p.duration]);

  const flushSeek = () => {
    seekFrameRef.current = 0;
    const time = pendingSeekRef.current;
    if (time == null) return;
    pendingSeekRef.current = null;
    p.setCurrentTime(time);
  };

  const seekFromEvent = (e: React.MouseEvent | MouseEvent) => {
    pendingSeekRef.current = Math.max(0, Math.min(p.duration, posToTime(e.clientX)));
    if (!seekFrameRef.current) seekFrameRef.current = requestAnimationFrame(flushSeek);
  };

  const onTrackMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingCursorRef.current = true;
    p.setPlaying(false);
    lockSelection(true);
    seekFromEvent(e);
    const onMove = (ev: MouseEvent) => { ev.preventDefault(); if (draggingCursorRef.current) seekFromEvent(ev); };
    const onUp = () => {
      draggingCursorRef.current = false;
      if (seekFrameRef.current) {
        cancelAnimationFrame(seekFrameRef.current);
        seekFrameRef.current = 0;
      }
      flushSeek();
      lockSelection(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // 关键帧拖拽
  const onKfMouseDown = (e: React.MouseEvent, assetId: string, prop: TransformProp, kfTime: number) => {
    e.preventDefault(); e.stopPropagation();
    lockSelection(true);
    let cur = kfTime;
    const onMove = (ev: MouseEvent) => {
      ev.preventDefault();
      const newTime = Math.max(0, Math.min(p.duration, posToTime(ev.clientX)));
      const next = p.assets.map((a) => {
        if (a.id !== assetId) return a;
        const track = a.keyframes[prop].map((kf) => Math.abs(kf.time - cur) < 0.001 ? { ...kf, time: newTime } : kf).sort((x, y) => x.time - y.time);
        return { ...a, keyframes: { ...a.keyframes, [prop]: track } };
      });
      p.setAssets(next); p.setCurrentTime(newTime); cur = newTime;
    };
    const onUp = () => { lockSelection(false); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };

  // 拖动改值：只修改当前时刻的帧（±0.05s），没有则改 defaultTransform
  const onValDragStart = (e: React.MouseEvent, assetId: string, prop: TransformProp, startVal: number) => {
    e.preventDefault();
    const startX = e.clientX;
    document.body.style.cursor = 'ew-resize'; document.body.style.userSelect = 'none';
    const sensitivity = prop === 'opacity' ? 0.005 : prop === 'scale' ? 0.01 : 1;
    const onMove = (ev: MouseEvent) => {
      let newVal = startVal + (ev.clientX - startX) * sensitivity;
      if (prop === 'opacity') newVal = Math.max(0, Math.min(1, newVal));
      const next = p.assets.map((a) => {
        if (a.id !== assetId) return a;
        const track = a.keyframes[prop];
        // 只修改当前时刻附近的帧
        const exactIdx = track.findIndex((kf) => Math.abs(kf.time - p.currentTime) < 0.05);
        if (exactIdx >= 0) {
          return { ...a, keyframes: { ...a.keyframes, [prop]: track.map((kf, i) => i === exactIdx ? { ...kf, value: newVal } : kf) } };
        }
        // 没有当前时刻的帧 → 修改 defaultTransform
        return { ...a, defaultTransform: { ...a.defaultTransform, [prop]: newVal } };
      });
      p.setAssets(next);
    };
    const onUp = () => { document.body.style.cursor = ''; document.body.style.userSelect = ''; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };

  // 双击编辑确认
  const commitEdit = (assetId: string, prop: TransformProp) => {
    let val = parseFloat(editInput);
    if (isNaN(val)) { setEditingVal(null); return; }
    if (prop === 'opacity') { val = Math.max(0, Math.min(1, val / 100)); }
    const next = p.assets.map((a) => {
      if (a.id !== assetId) return a;
      const track = a.keyframes[prop];
      const exactIdx = track.findIndex((kf) => Math.abs(kf.time - p.currentTime) < 0.05);
      if (exactIdx >= 0) {
        return { ...a, keyframes: { ...a.keyframes, [prop]: track.map((kf, i) => i === exactIdx ? { ...kf, value: val } : kf) } };
      }
      return { ...a, defaultTransform: { ...a.defaultTransform, [prop]: val } };
    });
    p.setAssets(next);
    setEditingVal(null);
  };

  // 单属性关键帧 toggle：有帧删除，无帧添加
  const togglePropKf = (assetId: string, prop: TransformProp, val: number) => {
    p.setAssets(p.assets.map((a) => {
      if (a.id !== assetId) return a;
      const track = a.keyframes[prop];
      const existIdx = track.findIndex((kf) => Math.abs(kf.time - p.currentTime) < 0.01);
      if (existIdx >= 0) {
        // 已有帧 → 删除
        return { ...a, keyframes: { ...a.keyframes, [prop]: track.filter((_, i) => i !== existIdx) } };
      }
      // 没有帧 → 添加
      const kfVal = a.defaultTransform[prop];
      return { ...a, keyframes: { ...a.keyframes, [prop]: upsertPropKeyframe(track, p.currentTime, kfVal) } };
    }));
  };

  // 总轨道行关键帧拖拽（移动该时间点所有属性的关键帧）
  const onAllPropsKfDrag = (e: React.MouseEvent, assetId: string, kfTime: number) => {
    e.preventDefault(); e.stopPropagation();
    lockSelection(true);
    let cur = kfTime;
    let moved = false;
    const allProps: TransformProp[] = ['x', 'y', 'scale', 'rotation', 'opacity'];
    const onMove = (ev: MouseEvent) => {
      ev.preventDefault();
      const newTime = Math.max(0, Math.min(p.duration, posToTime(ev.clientX)));
      if (Math.abs(newTime - cur) < 0.001) return;
      moved = true;
      const next = p.assets.map((a) => {
        if (a.id !== assetId) return a;
        const newKfs = { ...a.keyframes };
        allProps.forEach((prop) => {
          newKfs[prop] = a.keyframes[prop].map((kf) =>
            Math.abs(kf.time - cur) < 0.001 ? { ...kf, time: newTime } : kf
          ).sort((x, y) => x.time - y.time);
        });
        return { ...a, keyframes: newKfs };
      });
      p.setAssets(next); p.setCurrentTime(newTime); cur = newTime;
    };
    const onUp = () => {
      lockSelection(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (!moved) p.setCurrentTime(kfTime);
    };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };

  // 拖拽分隔条
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = labelWidth;
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => { setLabelWidth(Math.max(140, Math.min(400, startW + ev.clientX - startX))); };
    const onUp = () => { document.body.style.cursor = ''; document.body.style.userSelect = ''; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };

  // 缩放条拖拽
  const zoomBarRef = useRef<HTMLDivElement>(null);
  const onZoomBarDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const bar = zoomBarRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const clickRatio = (e.clientX - rect.left) / rect.width;
    // 判断是拖左手柄、右手柄还是中间平移
    const leftHandleR = viewStart;
    const rightHandleR = viewEnd;
    const HANDLE_W = 8 / rect.width;

    let mode: 'left' | 'right' | 'pan' = 'pan';
    if (Math.abs(clickRatio - leftHandleR) < HANDLE_W) mode = 'left';
    else if (Math.abs(clickRatio - rightHandleR) < HANDLE_W) mode = 'right';
    else if (clickRatio < leftHandleR || clickRatio > rightHandleR) {
      // 点击空白区，跳到该位置居中
      const range = viewEnd - viewStart;
      const newStart = Math.max(0, Math.min(1 - range, clickRatio - range / 2));
      setViewStart(newStart); setViewEnd(newStart + range);
      return;
    }
    const startX = e.clientX;
    const startVS = viewStart, startVE = viewEnd;
    document.body.style.cursor = mode === 'pan' ? 'grab' : 'ew-resize'; document.body.style.userSelect = 'none';
    const onMove = (ev: MouseEvent) => {
      const dx = (ev.clientX - startX) / rect.width;
      if (mode === 'left') { setViewStart(Math.max(0, Math.min(startVE - 0.02, startVS + dx))); }
      else if (mode === 'right') { setViewEnd(Math.min(1, Math.max(startVS + 0.02, startVE + dx))); }
      else { const range = startVE - startVS; const ns = Math.max(0, Math.min(1 - range, startVS + dx)); setViewStart(ns); setViewEnd(ns + range); }
    };
    const onUp = () => { document.body.style.cursor = ''; document.body.style.userSelect = ''; window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
    window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
  };

  const displayTime = p.playing ? visualTime : p.currentTime;
  const cursorPercent = timeToPercent(displayTime);
  const ROW_H = 'h-7';
  const RULER_H = 'h-7';
  const visibleRange = viewEnd - viewStart;
  const visibleStartSec = p.duration * viewStart;
  const visibleEndSec = p.duration * viewEnd;
  const firstWholeSecond = Math.ceil(visibleStartSec);
  const lastWholeSecond = Math.floor(visibleEndSec);
  const wholeSecondCount = Math.max(0, lastWholeSecond - firstWholeSecond + 1);
  const secondStep = Math.max(1, Math.ceil(wholeSecondCount / 14));
  const secondTicks = p.duration > 0
    ? Array.from({ length: wholeSecondCount }, (_, i) => firstWholeSecond + i)
        .filter((second) => second % secondStep === 0)
    : [];

  return (
    <div className="timeline-editor-shell shrink-0 select-none flex flex-col" style={{ height: 280 }}>
      {/* 播放控制栏 */}
      <div className="timeline-topbar flex items-center justify-between px-3 py-1.5 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="timeline-tab">
            <Diamond size={13} className="text-[var(--primary)]" />
            <span>{p.t.timeline}</span>
          </div>
          <button onClick={() => { p.setCurrentTime(0); p.setPlaying(false); }} className="timeline-icon-button" title={p.t.timelineRewind}><SkipBack size={14} /></button>
          <button onClick={() => p.setPlaying(!p.playing)} className="timeline-icon-button" title={p.playing ? p.t.timelinePause : p.t.timelinePlay}>
            {p.playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <span className="timeline-timecode pointer-events-none">
            {fmt(displayTime)} <span className="text-neutral-600">/</span> {fmt(p.duration)}
          </span>
        </div>
        {p.selectedAssetId && (
          <button onClick={p.onAddKeyframe} className="timeline-add-button">
            <Diamond size={12} /> {p.lang === 'zh' ? '全属性帧' : 'All KF'}
          </button>
        )}
      </div>

      {/* 缩放横条（时间轴范围控制器） */}
      <div className="timeline-zoom-strip shrink-0 flex items-center">
        <div style={{ width: labelWidth }} className="timeline-zoom-label shrink-0 h-5" />
        <div ref={zoomBarRef} className="flex-1 relative h-5 cursor-pointer" onMouseDown={onZoomBarDown}>
          <div className="absolute inset-y-1.5 left-0 right-0 bg-black/35 rounded-full" />
          {/* 可见范围条 */}
          <div className="absolute top-1.5 bottom-1.5 rounded-full bg-slate-500/70 hover:bg-slate-400/80 transition-colors"
            style={{ left: `${viewStart * 100}%`, right: `${(1 - viewEnd) * 100}%` }}
          >
            {/* 左手柄 */}
            <div className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-l-full bg-cyan-300/55 hover:bg-cyan-300" />
            {/* 右手柄 */}
            <div className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize rounded-r-full bg-cyan-300/55 hover:bg-cyan-300" />
          </div>
        </div>
      </div>

      {/* 时间轴 + 属性轨道 */}
      <div className="flex-1 flex overflow-hidden">
        {/* 左侧标签列 */}
        <div style={{ width: labelWidth }} className="timeline-label-pane shrink-0 flex flex-col relative">
          <div className={`${RULER_H} timeline-label-header shrink-0 flex items-center px-3 gap-2`}>
            <span className="text-[11px] font-semibold text-slate-400">{p.lang === 'zh' ? '图层' : 'Layers'}</span>
            <span className="text-[10px] text-slate-600">{p.assets.length}</span>
          </div>
          <div className="flex-1 overflow-y-auto scroll-area">
            {p.assets.map((a) => {
              const sel = a.id === p.selectedAssetId;
              const expanded = expandedAssets.has(a.id);
              const assetTr = getTransformAtTime(a.keyframes, p.currentTime, a.defaultTransform);
              return (
                <div key={a.id}>
                  <div className={`${ROW_H} timeline-label-row flex items-center px-2 gap-1.5 cursor-pointer ${sel ? 'is-selected' : ''}`}>
                    <button onClick={(e) => { e.stopPropagation(); toggleExpand(a.id); }} className="text-slate-500 hover:text-slate-200 p-0.5 shrink-0">
                      {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </button>
                    <img src={a.src} alt="" className="w-5 h-5 object-contain rounded shrink-0" draggable={false} />
                    <span className="text-[11px] text-slate-200 truncate flex-1" onClick={() => p.setSelectedAssetId(a.id)}>{a.name}</span>
                  </div>
                  {expanded && PROP_ROWS.map((row) => {
                    const hasKf = row.props.some((pr) => a.keyframes[pr].some((kf) => Math.abs(kf.time - p.currentTime) < 0.01));
                    return (
                      <div key={row.key} className={`${ROW_H} timeline-prop-row flex items-center justify-between pl-7 pr-2`}>
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => row.props.forEach((pr) => togglePropKf(a.id, pr, assetTr[pr]))}
                            className={`p-0.5 ${hasKf ? 'text-cyan-300' : 'text-slate-600 hover:text-cyan-300'}`}
                            title={hasKf ? (p.lang === 'zh' ? '删除关键帧' : 'Delete KF') : (p.lang === 'zh' ? '添加关键帧' : 'Add KF')}>
                            <Diamond size={10} className={hasKf ? 'fill-cyan-300' : ''} />
                          </button>
                          <span className="text-[11px] text-slate-400 shrink-0">{row.label[p.lang]}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {row.props.map((pr) => {
                            const val = assetTr[pr];
                            const display = pr === 'opacity' ? `${Math.round(val * 100)}%` : pr === 'scale' ? val.toFixed(2) : pr === 'rotation' ? `${val.toFixed(1)}°` : val.toFixed(1);
                            const isEditing = editingVal?.assetId === a.id && editingVal?.prop === pr;
                            return isEditing ? (
                              <input key={pr}
                                autoFocus
                                className="w-16 text-[11px] font-mono bg-neutral-900 border border-[var(--primary)] rounded px-1 py-0.5 text-white outline-none"
                                value={editInput}
                                onChange={(e) => setEditInput(e.target.value)}
                                onBlur={() => commitEdit(a.id, pr)}
                                onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(a.id, pr); if (e.key === 'Escape') setEditingVal(null); }}
                              />
                            ) : (
                              <span key={pr} className="text-[11px] font-mono text-cyan-300 cursor-ew-resize hover:text-white select-none px-1 py-0.5 rounded hover:bg-white/5"
                                onMouseDown={(e) => onValDragStart(e, a.id, pr, val)}
                                onDoubleClick={() => {
                                  const editVal = pr === 'opacity' ? `${Math.round(val * 100)}` : pr === 'rotation' ? val.toFixed(1) : pr === 'scale' ? val.toFixed(2) : val.toFixed(1);
                                  setEditingVal({ assetId: a.id, prop: pr }); setEditInput(editVal);
                                }}>
                                {row.props.length > 1 ? `${pr.toUpperCase()} ${display}` : display}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
          {/* 拖拽分隔条 */}
          <div className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-cyan-300/45 transition-colors z-20" onMouseDown={onResizeStart} />
        </div>

        {/* 右侧轨道区 */}
        <div className="timeline-track-pane flex-1 flex flex-col overflow-hidden">
          {/* Ruler */}
          <div ref={trackRef} className={`timeline-ruler relative ${RULER_H} shrink-0 cursor-pointer`} onMouseDown={onTrackMouseDown}>
            {secondTicks.map((time) => {
              const ratio = visibleRange > 0 ? ((time / p.duration) - viewStart) / visibleRange : 0;
              return (
                <div key={time} className="absolute top-0 h-full pointer-events-none" style={{ left: `${ratio * 100}%` }}>
                  <div className="w-px h-2.5 bg-slate-600/75" />
                  <span className="text-[9px] text-slate-500 font-mono absolute top-2.5 -translate-x-1/2">{fmtSecondTick(time)}</span>
                </div>
              );
            })}
            {cursorPercent >= 0 && cursorPercent <= 100 && (
              <div className="timeline-playhead absolute top-0 h-full pointer-events-none" style={{ left: `${cursorPercent}%` }}>
                <div className="timeline-playhead-badge">{fmtFrame(displayTime)}</div>
              </div>
            )}
          </div>

          {/* 轨道内容 */}
          <div className="flex-1 overflow-y-auto scroll-area">
            {p.assets.map((a) => {
              const sel = a.id === p.selectedAssetId;
              const expanded = expandedAssets.has(a.id);
              const allTimes = new Set<number>();
              PROP_ROWS.forEach((row) => row.props.forEach((prop) => a.keyframes[prop].forEach((kf) => allTimes.add(Math.round(kf.time * 1000) / 1000))));

              return (
                <div key={a.id}>
                  <div className={`timeline-track-row relative ${ROW_H} ${sel ? 'is-selected' : ''}`}>
                    {cursorPercent >= 0 && cursorPercent <= 100 && <div className="timeline-playhead-shadow absolute top-0 h-full pointer-events-none" style={{ left: `${cursorPercent}%` }} />}
                    {a.visible && <div className={`timeline-clip ${sel ? 'is-selected' : ''}`} />}
                    {Array.from(allTimes).map((kfTime, idx) => {
                      const left = timeToPercent(kfTime);
                      if (left < -2 || left > 102) return null;
                      return (
                        <div key={idx} className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10 cursor-ew-resize hover:scale-125 transition-transform"
                          style={{ left: `${left}%` }}
                          onMouseDown={(e) => onAllPropsKfDrag(e, a.id, kfTime)}>
                          <Diamond size={9} className="text-cyan-300 fill-cyan-300/70 drop-shadow" />
                        </div>
                      );
                    })}
                  </div>
                  {expanded && PROP_ROWS.map((row) => (
                    <div key={row.key} className={`timeline-prop-track-row relative ${ROW_H}`}>
                      {cursorPercent >= 0 && cursorPercent <= 100 && <div className="timeline-playhead-shadow is-muted absolute top-0 h-full pointer-events-none" style={{ left: `${cursorPercent}%` }} />}
                      {row.props.map((prop) =>
                        a.keyframes[prop].map((kf, idx) => {
                          const left = timeToPercent(kf.time);
                          if (left < -2 || left > 102) return null;
                          return (
                            <div key={`${prop}-${idx}`}
                              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-ew-resize hover:scale-150 transition-transform z-10"
                              style={{ left: `${left}%` }}
                              onMouseDown={(e) => onKfMouseDown(e, a.id, prop, kf.time)}
                              title={`${prop} ${fmt(kf.time)}`}>
                              <Diamond size={10} className="text-cyan-300 fill-cyan-300" />
                            </div>
                          );
                        })
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};
