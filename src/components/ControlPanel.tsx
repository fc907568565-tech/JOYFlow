import React from 'react';
import {
  Upload, Settings2, Download, ChevronDown, Palette, Crop, SlidersHorizontal,
  FileJson, Maximize, CheckCircle2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { ChromaKeyOptions, ExportFormat, Status } from '../types';
import type { T } from '../i18n';

// === Reusable atoms ===
const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }> = ({ checked, onChange, disabled }) => (
  <button type="button" onClick={() => !disabled && onChange(!checked)} disabled={disabled}
    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${checked && !disabled ? 'bg-[var(--primary)]' : 'bg-neutral-700'} ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}>
    <span className={`pointer-events-none inline-block h-5 w-5 mt-0.5 transform rounded-full bg-white shadow transition duration-200 ${checked && !disabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
  </button>
);

const Slider: React.FC<{ label: string; value: number; min: number; max: number; step?: number; display: string; onChange: (v: number) => void; disabled?: boolean; accent?: string }> = (p) => (
  <div className="space-y-1.5">
    <div className="flex justify-between items-center">
      <span className="text-xs text-neutral-400">{p.label}</span>
      <span className={`text-xs font-mono font-semibold ${p.accent || 'text-[var(--primary)]'}`}>{p.display}</span>
    </div>
    <input type="range" min={p.min} max={p.max} step={p.step ?? 1} value={p.value} disabled={p.disabled}
      onChange={(e) => p.onChange(parseFloat(e.target.value))} className="slider" />
  </div>
);

const Section: React.FC<{ icon: React.ReactNode; title: string; open: boolean; onToggle: () => void; badge?: string; children: React.ReactNode }> = ({ icon, title, open, onToggle, badge, children }) => (
  <div className="border-b border-[var(--border-soft)] pb-3">
    <button onClick={onToggle} className="w-full flex items-center justify-between py-2 group">
      <div className="flex items-center gap-2.5">
        <div className="w-7 h-7 rounded-md bg-[var(--bg-elev-2)] border border-[var(--border-soft)] flex items-center justify-center text-[var(--primary)]">{icon}</div>
        <span className="text-sm font-semibold text-neutral-100">{title}</span>
        {badge && <span className="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 font-mono">{badge}</span>}
      </div>
      <ChevronDown size={16} className={`text-neutral-500 transition-transform ${open ? 'rotate-180' : ''}`} />
    </button>
    <AnimatePresence initial={false}>
      {open && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
          <div className="pt-2">{children}</div>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

const NumField: React.FC<{ label: string; value: string | number; onChange: (v: string | number) => void }> = ({ label, value, onChange }) => (
  <div>
    <label className="text-[11px] text-neutral-500 block mb-1">{label}</label>
    <input type="number" min={32} max={4096} value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full panel-sub px-2.5 py-1.5 text-xs font-mono text-neutral-200 outline-none focus:border-[var(--primary)]/50" />
  </div>
);

// ===== Props =====
interface ControlPanelProps {
  t: T;
  lang: 'zh' | 'en';
  setLang: (l: 'zh' | 'en') => void;
  activeMode: 'video' | 'sequence' | 'gif';
  open: { src: boolean; chroma: boolean; canvas: boolean; optim: boolean };
  setOpen: (next: ControlPanelProps['open']) => void;
  hasFile: boolean;
  videoFileName?: string;
  handleFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  chromaKey: ChromaKeyOptions;
  setChromaKey: (next: ChromaKeyOptions) => void;
  customCanvasEnabled: boolean; setCustomCanvasEnabled: (v: boolean) => void;
  targetWidthInput: string | number; setTargetWidthInput: (v: string | number) => void;
  targetHeightInput: string | number; setTargetHeightInput: (v: string | number) => void;
  contentScale: number; setContentScale: (v: number) => void;
  offsetX: number; setOffsetX: (v: number) => void;
  offsetY: number; setOffsetY: (v: number) => void;
  videoDimensions: { w: number; h: number };
  scale: number; setScale: (v: number) => void;
  exportFormat: ExportFormat; setExportFormat: (v: ExportFormat) => void;
  frameSkip: number; setFrameSkip: (v: number) => void;
  quality: number; setQuality: (v: number) => void;
  bitrate: number; setBitrate: (v: number) => void;
  status: Status;
  startExport: () => void;
  isProcessing: boolean;
  /** 视频模式下点击"素材源"上传区时先打开素材仓库（仓库面板内自带"上传本地"按钮） */
  onOpenLibrary?: () => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = (p) => {
  const { t, activeMode, open } = p;
  const setOpen = (k: keyof typeof open) => p.setOpen({ ...open, [k]: !open[k] });
  const chromaDisabled = activeMode !== 'video';
  const sourceLabel = activeMode === 'video' ? t.selectVideo : activeMode === 'sequence' ? t.selectSequence : t.selectGif;
  const sourceAccept = activeMode === 'video' ? 'video/*' : activeMode === 'sequence' ? 'image/png' : 'image/gif';
  const sourceMultiple = activeMode === 'sequence';

  return (
    <aside className="w-[340px] shrink-0 h-full border-l border-[var(--border-soft)] bg-[var(--bg-elev)]/40 backdrop-blur-md flex flex-col">
      <div className="px-5 py-3 border-b border-[var(--border-soft)] flex items-center gap-2 shrink-0">
        <Settings2 size={14} className="text-[var(--primary)]" />
        <h2 className="text-xs font-bold tracking-wide">{t.controlCenter}</h2>
      </div>

      <div className="flex-1 overflow-y-auto scroll-area px-5 py-4 space-y-2">
        {/* Source */}
        <Section icon={<Upload size={14} />} title={t.sourceSection} open={open.src} onToggle={() => setOpen('src')} badge={p.hasFile ? '✓' : undefined}>
          {activeMode === 'video' && p.onOpenLibrary ? (
            <button type="button" onClick={() => p.onOpenLibrary?.()} className="block w-full text-left cursor-pointer">
              <div className="panel-sub border-dashed hover:border-[var(--primary)]/50 transition-colors p-4 flex flex-col items-center gap-2 text-center">
                {p.hasFile ? (<>
                  <CheckCircle2 size={20} className="text-green-400" />
                  <p className="text-xs text-neutral-300 font-medium truncate max-w-full">{p.videoFileName}</p>
                  <p className="text-[10px] text-neutral-500">{t.replaceFile}</p>
                </>) : (<>
                  <Upload size={20} className="text-neutral-500" />
                  <p className="text-xs text-neutral-300 font-medium">{t.selectVideo}</p>
                  <p className="text-[10px] text-neutral-500">先从素材仓库选择，或在弹窗中上传本地文件</p>
                </>)}
              </div>
            </button>
          ) : (
           <label className="block cursor-pointer">
              <div className="panel-sub border-dashed hover:border-[var(--primary)]/50 transition-colors p-4 flex flex-col items-center gap-2 text-center">
                {p.hasFile ? (<>
                  <CheckCircle2 size={20} className="text-green-400" />
                  <p className="text-xs text-neutral-300 font-medium truncate max-w-full">{p.videoFileName}</p>
                  <p className="text-[10px] text-neutral-500">{t.replaceFile}</p>
                </>) : (<>
                  <Upload size={20} className="text-neutral-500" />
                  <p className="text-xs text-neutral-300 font-medium">{sourceLabel}</p>
                  <p className="text-[10px] text-neutral-500">{t.dragHint}</p>
                </>)}
              </div>
              <input type="file" className="hidden" accept={sourceAccept} multiple={sourceMultiple} onChange={p.handleFileChange} />
            </label>
          )}
        </Section>

        {/* Chroma Key */}
        <Section icon={<Palette size={14} />} title={t.chromaKey} open={open.chroma} onToggle={() => setOpen('chroma')} badge={chromaDisabled ? (p.lang === 'zh' ? '仅视频' : 'Video') : undefined}>
          <div className={chromaDisabled ? 'opacity-40 pointer-events-none' : ''}>
            <div className="flex items-center justify-between panel-sub p-3 mb-3">
              <div className="flex-1 pr-3">
                <p className="text-xs font-semibold text-neutral-200">{t.chromaKeyToggle}</p>
                <p className="text-[10px] text-neutral-500 mt-0.5">{t.chromaKeyDesc}</p>
              </div>
              <Toggle checked={p.chromaKey.enabled} onChange={(v) => p.setChromaKey({ ...p.chromaKey, enabled: v })} disabled={chromaDisabled} />
            </div>
            <div className={`space-y-3 ${!p.chromaKey.enabled ? 'opacity-40 pointer-events-none' : ''}`}>
              <div>
                <p className="text-xs text-neutral-400 mb-1.5">{t.targetColor}</p>
                <div className="flex items-center gap-2">
                  <input type="color" value={p.chromaKey.color} onChange={(e) => p.setChromaKey({ ...p.chromaKey, color: e.target.value })}
                    className="w-10 h-9 rounded-md cursor-pointer bg-transparent border border-[var(--border-soft)]" />
                  <div className="flex-1 panel-sub px-3 py-2 text-xs font-mono">{p.chromaKey.color.toUpperCase()}</div>
                </div>
              </div>
              <Slider label={t.threshold} value={p.chromaKey.threshold} min={0} max={255} display={`${p.chromaKey.threshold}`} onChange={(v) => p.setChromaKey({ ...p.chromaKey, threshold: v })} />
              <Slider label={t.smoothness} value={p.chromaKey.similarity} min={0} max={0.5} step={0.01} display={`${Math.round(p.chromaKey.similarity * 100)}%`} onChange={(v) => p.setChromaKey({ ...p.chromaKey, similarity: v })} />
              <Slider label={t.despill} value={p.chromaKey.despill} min={0} max={1} step={0.01} display={`${Math.round(p.chromaKey.despill * 100)}%`} onChange={(v) => p.setChromaKey({ ...p.chromaKey, despill: v })} accent="text-green-400" />
            </div>
          </div>
        </Section>

        {/* Canvas */}
        <Section icon={<Crop size={14} />} title={t.canvasSection} open={open.canvas} onToggle={() => setOpen('canvas')} badge={p.customCanvasEnabled ? 'ON' : undefined}>
          <div className="flex items-center justify-between panel-sub p-3 mb-3">
            <div className="flex-1 pr-3">
              <p className="text-xs font-semibold text-neutral-200">{t.sizeCropToggle}</p>
              <p className="text-[10px] text-neutral-500 mt-0.5">{t.sizeCropDesc}</p>
            </div>
            <Toggle checked={p.customCanvasEnabled} onChange={p.setCustomCanvasEnabled} />
          </div>
          {p.customCanvasEnabled && (
            <div className="space-y-3 fade-in">
              <div className="grid grid-cols-2 gap-2">
                <NumField label={t.targetWidth} value={p.targetWidthInput} onChange={p.setTargetWidthInput} />
                <NumField label={t.targetHeight} value={p.targetHeightInput} onChange={p.setTargetHeightInput} />
              </div>
              <div>
                <p className="text-[11px] text-neutral-500 mb-1.5">{t.presetSizes}</p>
                <div className="grid grid-cols-2 gap-1.5">
                  {[[512,512],[1024,1024],[1280,720],[720,1280]].map(([w,h]) => (
                    <button key={`${w}x${h}`} onClick={() => { p.setTargetWidthInput(w); p.setTargetHeightInput(h); }}
                      className="py-1.5 px-2 text-[10px] panel-sub hover:border-[var(--primary)]/50 hover:text-white text-neutral-300 transition-all font-mono">{w}×{h}</button>
                  ))}
                </div>
                <button onClick={() => { const w = Math.floor(p.videoDimensions.w * p.scale); const h = Math.floor(p.videoDimensions.h * p.scale); if (w > 0 && h > 0) { p.setTargetWidthInput(w); p.setTargetHeightInput(h); p.setContentScale(1.0); p.setOffsetX(0); p.setOffsetY(0); } }}
                  className="w-full mt-1.5 py-1.5 px-2 text-[10px] panel-sub hover:border-[var(--border-strong)] text-neutral-400 hover:text-neutral-200 flex items-center justify-center gap-1 font-semibold">
                  <Maximize size={10} /> {t.resetToOriginal}
                </button>
              </div>
              <div className="panel-sub p-3 space-y-3">
                <Slider label={t.contentScale} value={p.contentScale} min={0.1} max={5} step={0.01} display={`${Math.round(p.contentScale * 100)}%`} onChange={p.setContentScale} />
                <Slider label={t.offsetX} value={p.offsetX} min={-500} max={500} display={`${p.offsetX > 0 ? '+' : ''}${p.offsetX}px`} onChange={(v) => p.setOffsetX(Math.round(v))} />
                <Slider label={t.offsetY} value={p.offsetY} min={-500} max={500} display={`${p.offsetY > 0 ? '+' : ''}${p.offsetY}px`} onChange={(v) => p.setOffsetY(Math.round(v))} />
              </div>
            </div>
          )}
        </Section>

        {/* Optim */}
        <Section icon={<SlidersHorizontal size={14} />} title={t.optimization} open={open.optim} onToggle={() => setOpen('optim')}>
          <div className="space-y-3">
            <div>
              <p className="text-[11px] text-neutral-500 mb-1.5 flex items-center gap-1.5"><FileJson size={11} /> {t.exportFormat}</p>
              <div className="grid grid-cols-3 gap-2">
                <button onClick={() => p.setExportFormat('LOTTIE')}
                  className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all border ${p.exportFormat === 'LOTTIE' ? 'bg-[var(--primary)] border-[var(--primary)] text-white' : 'panel-sub text-neutral-400 hover:text-neutral-200'}`}>{t.formatLottie}</button>
                <button disabled={activeMode !== 'video'} onClick={() => p.setExportFormat('MP4')}
                  className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all border disabled:opacity-30 disabled:cursor-not-allowed ${p.exportFormat === 'MP4' ? 'bg-[var(--primary)] border-[var(--primary)] text-white' : 'panel-sub text-neutral-400 hover:text-neutral-200'}`}>{t.formatMp4}</button>
                <button disabled={activeMode !== 'video'} onClick={() => p.setExportFormat('GIF')}
                  className={`flex-1 py-2 rounded-md text-xs font-semibold transition-all border disabled:opacity-30 disabled:cursor-not-allowed ${p.exportFormat === 'GIF' ? 'bg-[var(--primary)] border-[var(--primary)] text-white' : 'panel-sub text-neutral-400 hover:text-neutral-200'}`}>{t.formatGif}</button>
              </div>
              {p.exportFormat === 'GIF' && (
                <p className="mt-2 rounded-md border border-cyan-400/15 bg-cyan-400/5 px-2.5 py-2 text-[10px] leading-4 text-cyan-100/60">
                  {p.lang === 'zh'
                    ? `GIF 不包含声音；当前抽帧设置约输出 ${Math.max(1, Math.round(30 / p.frameSkip))} FPS，并支持绿幕透明背景。`
                    : `GIF has no audio. Current frame sampling exports about ${Math.max(1, Math.round(30 / p.frameSkip))} FPS and supports chroma-key transparency.`}
                </p>
              )}
            </div>
            <Slider label={t.frameSkip} value={p.frameSkip} min={1} max={10} display={`1/${p.frameSkip}`} onChange={(v) => p.setFrameSkip(Math.round(v))} accent="text-orange-400" />
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-xs text-neutral-400">{t.scaleFactor}</span>
                <span className="text-xs font-mono font-semibold text-[var(--primary)]">{p.scale * 100}%</span>
              </div>
              <div className="grid grid-cols-4 gap-1.5">
                {[0.25, 0.5, 0.75, 1.0].map(s => (
                  <button key={s} onClick={() => p.setScale(s)}
                    className={`py-1.5 rounded-md text-[10px] font-mono font-semibold transition-all border ${p.scale === s ? 'bg-[var(--primary)] border-[var(--primary)] text-white' : 'panel-sub text-neutral-400 hover:text-neutral-200'}`}>{s.toFixed(2)}x</button>
                ))}
              </div>
            </div>
            {(p.exportFormat === 'LOTTIE' || p.exportFormat === 'GIF') && (
              <Slider label={t.quality} value={p.quality} min={0.1} max={1} step={0.05} display={`${Math.round(p.quality * 100)}%`} onChange={p.setQuality} accent="text-purple-400" />
            )}
            {p.exportFormat === 'MP4' && (
              <Slider label={t.bitrate} value={p.bitrate} min={0.5} max={10} step={0.5} display={`${p.bitrate} Mbps`} onChange={p.setBitrate} accent="text-green-400" />
            )}
          </div>
        </Section>
      </div>

      {/* Footer - Export */}
      <div className="px-5 py-4 border-t border-[var(--border-soft)] bg-[var(--bg-elev)]/80 backdrop-blur-md shrink-0">
        <button onClick={p.startExport} disabled={!p.hasFile || p.isProcessing} className="btn-primary w-full h-11 text-sm">
          {p.status === 'DONE' ? (<><CheckCircle2 size={18} /> {t.reexport}</>) : (<><Download size={18} /> {t.export}</>)}
        </button>
        {p.status === 'DONE' && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
            className="mt-3 p-2.5 bg-green-500/10 border border-green-500/30 rounded-md flex items-start gap-2">
            <CheckCircle2 size={14} className="text-green-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-[11px] font-bold text-green-400">{t.exportSuccess}</p>
              <p className="text-[10px] text-green-200/70">{t.exportSuccessDesc}</p>
            </div>
          </motion.div>
        )}
      </div>
    </aside>
  );
};
