import React, { useRef } from 'react';
import { Play, Pause, SkipBack, Plus, Diamond } from 'lucide-react';
import type { ImageAsset, PropKeyframe } from '../types';
import type { T } from '../i18n';

interface TimelineProps {
  t: T;
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

export const Timeline: React.FC<TimelineProps> = (p) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingCursorRef = useRef(false);
  const draggingKfRef = useRef<{
    assetId: string;
    kfIndex: number;
    trackEl: HTMLDivElement | null;
  } | null>(null);

  const lockSelection = (lock: boolean) => {
    if (lock) {
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'grabbing';
    } else {
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    }
  };

  const seekFromEvent = (e: React.MouseEvent | MouseEvent) => {
    const el = trackRef.current;
    if (!el || p.duration <= 0) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    p.setCurrentTime(ratio * p.duration);
  };

  const onTrackMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingCursorRef.current = true;
    p.setPlaying(false);
    lockSelection(true);
    seekFromEvent(e);
    const onMove = (ev: MouseEvent) => {
      ev.preventDefault();
      if (draggingCursorRef.current) seekFromEvent(ev);
    };
    const onUp = () => {
      draggingCursorRef.current = false;
      lockSelection(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // ===== Keyframe drag =====
  const onKeyframeMouseDown = (e: React.MouseEvent, assetId: string, kfTime: number) => {
    e.preventDefault();
    e.stopPropagation();
    const trackEl = (e.currentTarget as HTMLElement).parentElement as HTMLDivElement;
    draggingKfRef.current = { assetId, kfIndex: 0, trackEl };
    const origTime = kfTime;
    p.setSelectedAssetId(assetId);
    lockSelection(true);

    const onMove = (ev: MouseEvent) => {
      ev.preventDefault();
      const drag = draggingKfRef.current;
      if (!drag || !drag.trackEl || p.duration <= 0) return;
      const rect = drag.trackEl.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const newTime = ratio * p.duration;
      // 更新该素材所有属性中在 origTime 的关键帧
      const next = p.assets.map((a) => {
        if (a.id !== drag.assetId) return a;
        const updateTrack = (track: PropKeyframe[]) =>
          track.map((kf) => Math.abs(kf.time - origTime) < 0.001 ? { ...kf, time: newTime } : kf)
            .sort((x, y) => x.time - y.time);
        return {
          ...a,
          keyframes: {
            x: updateTrack(a.keyframes.x),
            y: updateTrack(a.keyframes.y),
            scale: updateTrack(a.keyframes.scale),
            rotation: updateTrack(a.keyframes.rotation),
            opacity: updateTrack(a.keyframes.opacity),
          },
        };
      });
      p.setAssets(next);
      p.setCurrentTime(newTime);
      // 更新 origTime for subsequent moves
      (onKeyframeMouseDown as any).__origTime = newTime;
    };
    const onUp = () => {
      draggingKfRef.current = null;
      lockSelection(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const cursorPercent = p.duration > 0 ? (p.currentTime / p.duration) * 100 : 0;

  return (
    <div className="panel overflow-hidden select-none">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-soft)]">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { p.setCurrentTime(0); p.setPlaying(false); }}
            className="btn-ghost !py-1 !px-2"
            title={p.t.timelineRewind}
          >
            <SkipBack size={14} />
          </button>
          <button
            onClick={() => p.setPlaying(!p.playing)}
            className="btn-ghost !py-1 !px-2"
            title={p.playing ? p.t.timelinePause : p.t.timelinePlay}
          >
            {p.playing ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <span className="text-xs font-mono text-neutral-300 ml-2 pointer-events-none">
            {fmt(p.currentTime)} <span className="text-neutral-600">/</span> {fmt(p.duration)}
          </span>
        </div>
        <button
          onClick={p.onAddKeyframe}
          disabled={!p.selectedAssetId}
          className="btn-ghost !py-1 !px-2.5 text-xs disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={12} /> {p.t.addKfBtn}
        </button>
      </div>

      {/* Tracks */}
      <div className="relative">
        {/* Time ruler - 与素材区左边对齐 */}
        <div className="flex">
          <div className="w-32 shrink-0 border-r border-[var(--border-soft)]" />
          <div
            ref={trackRef}
            className="relative h-7 bg-[var(--bg-elev-2)] border-b border-[var(--border-soft)] cursor-pointer flex-1"
            onMouseDown={onTrackMouseDown}
          >
            {/* Tick marks */}
            {p.duration > 0 && Array.from({ length: 11 }).map((_, i) => {
              const ratio = i / 10;
              return (
                <div key={i} className="absolute top-0 h-full pointer-events-none" style={{ left: `${ratio * 100}%` }}>
                  <div className="w-px h-2 bg-neutral-700" />
                  <div className="text-[9px] text-neutral-500 font-mono mt-0.5 -translate-x-1/2">{fmt(p.duration * ratio)}</div>
                </div>
              );
            })}
            {/* Cursor */}
            <div
              className="absolute top-0 h-full w-0.5 bg-[var(--primary)] pointer-events-none"
              style={{ left: `${cursorPercent}%` }}
            >
              <div className="w-3 h-3 bg-[var(--primary)] rounded-sm absolute -top-1 -translate-x-1/2 rotate-45" />
            </div>
          </div>
        </div>

        {/* Asset tracks */}
        <div className="max-h-40 overflow-y-auto scroll-area">
          {p.assets.length === 0 ? (
            <div className="text-center py-6 text-xs text-neutral-600">{p.t.noAssets}</div>
          ) : (
            p.assets.map((a) => {
              const selected = a.id === p.selectedAssetId;
              return (
                <div
                  key={a.id}
                  onClick={() => p.setSelectedAssetId(a.id)}
                  className={`flex items-stretch border-b border-[var(--border-soft)] cursor-pointer ${selected ? 'bg-[var(--primary)]/10' : 'hover:bg-white/[0.02]'}`}
                >
                  <div className="w-32 shrink-0 px-3 py-2 flex items-center gap-2 border-r border-[var(--border-soft)]">
                    <img src={a.src} alt={a.name} className="w-5 h-5 object-contain rounded shrink-0" draggable={false} />
                    <span className="text-[11px] text-neutral-300 truncate">{a.name}</span>
                  </div>
                  <div className="relative flex-1 h-9">
                    {/* Cursor reflection */}
                    <div className="absolute top-0 h-full w-0.5 bg-[var(--primary)]/50 pointer-events-none" style={{ left: `${cursorPercent}%` }} />
                    {/* Keyframe marks - 合并所有属性的时间点去重 */}
                    {(() => {
                      const allTimes = new Set<number>();
                      (['x','y','scale','rotation','opacity'] as const).forEach((prop) => {
                        a.keyframes[prop].forEach((kf) => allTimes.add(Math.round(kf.time * 1000) / 1000));
                      });
                      return Array.from(allTimes).sort((a,b) => a-b).map((kfTime, idx) => {
                        const left = p.duration > 0 ? (kfTime / p.duration) * 100 : 0;
                        return (
                          <div
                            key={idx}
                            title={`${fmt(kfTime)} · 拖动改时间`}
                            onMouseDown={(e) => onKeyframeMouseDown(e, a.id, kfTime)}
                            onClick={(e) => { e.stopPropagation(); }}
                            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-ew-resize hover:scale-125 transition-transform z-10"
                            style={{ left: `${left}%` }}
                          >
                            <Diamond size={11} className="text-yellow-400 fill-yellow-400 drop-shadow" />
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};