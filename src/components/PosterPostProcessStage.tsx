import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  LoaderCircle,
  RotateCcw,
  SlidersHorizontal,
} from 'lucide-react';
import { addToLibrary, type LibraryAsset } from '../utils/assetLibrary';
import {
  DEFAULT_POSTER_POST_PROCESS,
  normalizePosterPostProcessSettings,
  renderPosterPostProcess,
  type PosterPostProcessSettings,
} from '../utils/posterPostProcess';

interface PosterPostProcessStageProps {
  sourceAsset: LibraryAsset;
  projectId: string;
  projectName: string;
  initialSettings?: Partial<PosterPostProcessSettings> | null;
  dynamicEnabled: boolean;
  onBack: () => void;
  onContinueOriginal: (settings: PosterPostProcessSettings) => void;
  onCommit: (asset: LibraryAsset, settings: PosterPostProcessSettings) => void;
  onSettingsChange?: (settings: PosterPostProcessSettings) => void;
}

type NumericSetting = {
  key: keyof PosterPostProcessSettings;
  label: string;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
};

const BASIC_CONTROLS: NumericSetting[] = [
  { key: 'exposure', label: '曝光', min: -2, max: 2, step: 0.05, suffix: ' EV' },
  { key: 'contrast', label: '对比度', min: -100, max: 100 },
  { key: 'highlights', label: '高光', min: -100, max: 100 },
  { key: 'shadows', label: '阴影', min: -100, max: 100 },
  { key: 'whites', label: '白色色阶', min: -100, max: 100 },
  { key: 'blacks', label: '黑色色阶', min: -100, max: 100 },
];

const COLOR_CONTROLS: NumericSetting[] = [
  { key: 'temperature', label: '色温', min: -100, max: 100 },
  { key: 'tint', label: '色调', min: -100, max: 100 },
  { key: 'saturation', label: '饱和度', min: -100, max: 100 },
  { key: 'vibrance', label: '自然饱和度', min: -100, max: 100 },
  { key: 'hue', label: '整体色相', min: -180, max: 180, suffix: '°' },
];

const RGB_CONTROLS: NumericSetting[] = [
  { key: 'redBalance', label: '红色平衡', min: -100, max: 100 },
  { key: 'greenBalance', label: '绿色平衡', min: -100, max: 100 },
  { key: 'blueBalance', label: '蓝色平衡', min: -100, max: 100 },
];

const EFFECT_CONTROLS: NumericSetting[] = [
  { key: 'fade', label: '褪色', min: 0, max: 100 },
  { key: 'vignette', label: '暗角', min: 0, max: 100 },
  { key: 'grain', label: '颗粒', min: 0, max: 100 },
  { key: 'sharpen', label: '锐化', min: 0, max: 100 },
];

const valueLabel = (value: number, suffix = '') => {
  const prefix = value > 0 ? '+' : '';
  const number = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  return `${prefix}${number}${suffix}`;
};

const AdjustmentSlider: React.FC<{
  control: NumericSetting;
  value: number;
  onChange: (value: number) => void;
}> = ({ control, value, onChange }) => (
  <label className="block py-1.5">
    <span className="mb-2 flex items-center justify-between text-xs">
      <span className="text-neutral-300">{control.label}</span>
      <span className="min-w-14 text-right font-mono text-[11px] text-neutral-500">{valueLabel(value, control.suffix)}</span>
    </span>
    <input
      className="post-process-range block w-full"
      type="range"
      min={control.min}
      max={control.max}
      step={control.step || 1}
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  </label>
);

const PanelSection: React.FC<{
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}> = ({ title, hint, defaultOpen = true, children }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-white/8 py-4 last:border-b-0">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen((value) => !value)}>
        <span>
          <span className="block text-sm font-medium text-white">{title}</span>
          {hint && <span className="mt-0.5 block text-[11px] text-neutral-600">{hint}</span>}
        </span>
        {open ? <ChevronUp size={15} className="text-neutral-500" /> : <ChevronDown size={15} className="text-neutral-500" />}
      </button>
      {open && <div className="mt-4">{children}</div>}
    </section>
  );
};

const ToneCurveEditor: React.FC<{
  value: number[];
  onChange: (value: number[]) => void;
}> = ({ value, onChange }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const [activePoint, setActivePoint] = useState<number | null>(null);
  const padding = 10;
  const plotSize = 180;
  const pointPosition = (index: number, output: number) => ({
    x: padding + index * (plotSize / 4),
    y: padding + plotSize - output / 255 * plotSize,
  });
  const points = value.map((output, index) => pointPosition(index, output));

  const movePoint = (event: React.PointerEvent<SVGSVGElement>) => {
    if (activePoint === null || !svgRef.current) return;
    const bounds = svgRef.current.getBoundingClientRect();
    const y = Math.max(padding, Math.min(padding + plotSize, (event.clientY - bounds.top) / bounds.height * (plotSize + padding * 2)));
    const output = Math.round((1 - (y - padding) / plotSize) * 255);
    const next = [...value];
    next[activePoint] = output;
    onChange(next);
  };

  return (
    <div className="rounded-md border border-white/10 bg-black/35 p-3">
      <div className="mb-2 flex items-center justify-between text-[11px] text-neutral-500">
        <span>暗部</span><span>拖动曲线节点</span><span>亮部</span>
      </div>
      <svg
        ref={svgRef}
        viewBox="0 0 200 200"
        className="block aspect-square w-full touch-none rounded bg-[#080a0b]"
        onPointerMove={movePoint}
        onPointerUp={() => setActivePoint(null)}
        onPointerCancel={() => setActivePoint(null)}
      >
        {[0, 1, 2, 3, 4].map((line) => (
          <React.Fragment key={line}>
            <line x1={padding + line * 45} y1={padding} x2={padding + line * 45} y2={padding + plotSize} stroke="rgba(255,255,255,.07)" />
            <line x1={padding} y1={padding + line * 45} x2={padding + plotSize} y2={padding + line * 45} stroke="rgba(255,255,255,.07)" />
          </React.Fragment>
        ))}
        <line x1={padding} y1={padding + plotSize} x2={padding + plotSize} y2={padding} stroke="rgba(255,255,255,.13)" strokeDasharray="4 4" />
        <polyline points={points.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke="#22d3ee" strokeWidth="2" />
        {points.map((point, index) => (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={activePoint === index ? 6 : 5}
            fill={activePoint === index ? '#ffffff' : '#0d1112'}
            stroke="#22d3ee"
            strokeWidth="2"
            className="cursor-ns-resize"
            onPointerDown={(event) => {
              event.preventDefault();
              setActivePoint(index);
              svgRef.current?.setPointerCapture(event.pointerId);
            }}
          />
        ))}
      </svg>
      <div className="mt-3 grid grid-cols-5 gap-1 text-center font-mono text-[10px] text-neutral-600">
        {value.map((point, index) => <span key={index}>{Math.round(point)}</span>)}
      </div>
      <button className="mt-3 w-full rounded border border-white/8 py-2 text-[11px] text-neutral-500 hover:bg-white/5 hover:text-white" onClick={() => onChange([...DEFAULT_POSTER_POST_PROCESS.curve])}>
        重置为直线
      </button>
    </div>
  );
};

export const PosterPostProcessStage: React.FC<PosterPostProcessStageProps> = ({
  sourceAsset,
  projectId,
  projectName,
  initialSettings,
  dynamicEnabled,
  onBack,
  onContinueOriginal,
  onCommit,
  onSettingsChange,
}) => {
  const [settings, setSettings] = useState<PosterPostProcessSettings>(() => normalizePosterPostProcessSettings(initialSettings));
  const [previewRendering, setPreviewRendering] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [compareOriginal, setCompareOriginal] = useState(false);
  const [zoom, setZoom] = useState(100);
  const renderVersionRef = useRef(0);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  const update = <K extends keyof PosterPostProcessSettings>(key: K, value: PosterPostProcessSettings[K]) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  useEffect(() => {
    const version = ++renderVersionRef.current;
    setPreviewRendering(true);
    setError('');
    const timer = window.setTimeout(() => {
      if (!previewCanvasRef.current) return;
      void renderPosterPostProcess(sourceAsset.url, settings, {
        maxSide: 820,
        targetCanvas: previewCanvasRef.current,
        includeDataUrl: false,
      })
        .then(() => {
          if (version !== renderVersionRef.current) return;
        })
        .catch((renderError) => {
          if (version !== renderVersionRef.current) return;
          setError(renderError instanceof Error ? renderError.message : '预览处理失败');
        })
        .finally(() => {
          if (version === renderVersionRef.current) setPreviewRendering(false);
        });
    }, 16);
    return () => window.clearTimeout(timer);
  }, [sourceAsset.id, sourceAsset.url, settings]);

  useEffect(() => {
    if (!onSettingsChange) return;
    const timer = window.setTimeout(() => onSettingsChange(settings), 360);
    return () => window.clearTimeout(timer);
  }, [settings, onSettingsChange]);

  const savePostProcess = async () => {
    setSaving(true);
    setError('');
    try {
      const rendered = await renderPosterPostProcess(sourceAsset.url, settings, { mimeType: 'image/png' });
      const asset = await addToLibrary({
        url: rendered.dataUrl,
        thumbnail: previewCanvasRef.current?.toDataURL('image/jpeg', 0.86),
        type: 'image',
        prompt: `${projectName} · 海报后期`,
        projectId,
        workflowId: projectId,
        stage: 'post-process',
        parentAssetId: sourceAsset.id,
        selected: true,
        status: 'approved',
        generationParams: { postProcess: settings },
        tags: ['角色海报后期', 'local-process', 'color-grading'],
      });
      onCommit(asset, settings);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : '后期版本保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 bg-[#090b0c]">
      <main className="relative flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-white/8 px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md border border-cyan-300/15 bg-cyan-300/[0.05] text-cyan-300">
              <SlidersHorizontal size={17} />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">海报后期</h2>
              <p className="flex items-center gap-1.5 text-[11px] text-neutral-600">
                <span className={`h-1.5 w-1.5 rounded-full ${previewRendering ? 'animate-pulse bg-cyan-300' : 'bg-emerald-400'}`} />
                {previewRendering ? '正在实时更新画布' : '实时预览已同步'} · 不调用模型
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 rounded-md border border-white/8 px-3 py-2 text-xs text-neutral-500">
              缩放
              <input className="post-process-range w-24" type="range" min="35" max="160" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
              <span className="w-9 text-right font-mono text-[10px]">{zoom}%</span>
            </label>
            <button
              className={`flex h-9 items-center gap-2 rounded-md border px-3 text-xs transition-colors ${compareOriginal ? 'border-cyan-300/45 bg-cyan-300/10 text-cyan-200' : 'border-white/10 text-neutral-400 hover:bg-white/5 hover:text-white'}`}
              onPointerDown={() => setCompareOriginal(true)}
              onPointerUp={() => setCompareOriginal(false)}
              onPointerLeave={() => setCompareOriginal(false)}
              title="按住查看原图"
            >
              <Eye size={14} /> 按住看原图
            </button>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 overflow-auto bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.035),transparent_56%)] p-8">
          <div className="flex min-h-full min-w-full items-center justify-center">
            <div className="relative shrink-0 overflow-hidden rounded-md border border-white/10 bg-black shadow-[0_24px_80px_rgba(0,0,0,.46)]" style={{ width: `${zoom}%`, maxWidth: zoom <= 100 ? '100%' : 'none' }}>
              <canvas ref={previewCanvasRef} className="block h-auto w-full" aria-label="海报后期实时预览" />
              {compareOriginal && <img src={sourceAsset.url} alt="原始静态海报" className="absolute inset-0 h-full w-full object-contain" />}
              <div className="pointer-events-none absolute left-3 top-3 rounded bg-black/60 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-white/65 backdrop-blur">
                {compareOriginal ? 'Before · 原图' : 'After · 后期'}
              </div>
            </div>
          </div>
        </div>

        <div className="shrink-0 border-t border-white/8 bg-[#0c0f10] px-5 py-4">
          {error && <div className="mb-3 rounded-md border border-red-400/20 bg-red-400/[0.06] px-3 py-2 text-xs text-red-300">{error}</div>}
          <div className="flex items-center justify-between gap-4">
            <button className="flex h-11 items-center gap-2 rounded-md border border-white/10 px-4 text-sm text-neutral-300 hover:bg-white/5" onClick={onBack}>
              <ArrowLeft size={15} /> 返回静态海报
            </button>
            <div className="flex items-center gap-2">
              <button className="h-11 rounded-md border border-white/10 px-4 text-sm text-neutral-400 hover:bg-white/5 hover:text-white" onClick={() => onContinueOriginal(settings)}>
                不调整，使用原图继续
              </button>
              <button disabled={saving} className="flex h-11 min-w-52 items-center justify-center gap-2 rounded-md bg-white px-5 text-sm font-semibold text-black hover:bg-neutral-200 disabled:opacity-45" onClick={() => void savePostProcess()}>
                {saving ? <LoaderCircle size={16} className="animate-spin" /> : <Check size={16} />}
                {saving ? '正在生成全尺寸版本' : dynamicEnabled ? '应用后期并制作动态海报' : '应用后期并进入导出'}
                {!saving && <ArrowRight size={15} />}
              </button>
            </div>
          </div>
        </div>
      </main>

      <aside className="flex w-[390px] shrink-0 flex-col border-l border-white/8 bg-[#0e1112]">
        <div className="shrink-0 border-b border-white/8 px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-white">调整参数</p>
              <p className="mt-1 text-[11px] text-neutral-600">拖动参数，左侧画布实时同步</p>
            </div>
            <button className="flex items-center gap-1.5 rounded border border-white/8 px-2.5 py-1.5 text-[11px] text-neutral-500 hover:bg-white/5 hover:text-white" onClick={() => setSettings(normalizePosterPostProcessSettings())}>
              <RotateCcw size={12} /> 全部重置
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8">
          <PanelSection title="基础明暗" hint="曝光、对比度、高光与阴影">
            {BASIC_CONTROLS.map((control) => <AdjustmentSlider key={String(control.key)} control={control} value={settings[control.key] as number} onChange={(value) => update(control.key, value as never)} />)}
          </PanelSection>

          <PanelSection title="色彩" hint="白平衡、饱和度、色相与 RGB 平衡">
            {COLOR_CONTROLS.map((control) => <AdjustmentSlider key={String(control.key)} control={control} value={settings[control.key] as number} onChange={(value) => update(control.key, value as never)} />)}
            <div className="my-4 h-px bg-white/6" />
            {RGB_CONTROLS.map((control) => <AdjustmentSlider key={String(control.key)} control={control} value={settings[control.key] as number} onChange={(value) => update(control.key, value as never)} />)}
          </PanelSection>

          <PanelSection title="色阶" hint="输入黑白场、伽马与输出范围">
            <AdjustmentSlider control={{ key: 'inputBlack', label: '输入黑场', min: 0, max: Math.max(0, settings.inputWhite - 1) }} value={settings.inputBlack} onChange={(value) => update('inputBlack', value)} />
            <AdjustmentSlider control={{ key: 'inputWhite', label: '输入白场', min: Math.min(255, settings.inputBlack + 1), max: 255 }} value={settings.inputWhite} onChange={(value) => update('inputWhite', value)} />
            <AdjustmentSlider control={{ key: 'gamma', label: '中间调伽马', min: 0.2, max: 3, step: 0.02 }} value={settings.gamma} onChange={(value) => update('gamma', value)} />
            <AdjustmentSlider control={{ key: 'outputBlack', label: '输出黑场', min: 0, max: Math.max(0, settings.outputWhite - 1) }} value={settings.outputBlack} onChange={(value) => update('outputBlack', value)} />
            <AdjustmentSlider control={{ key: 'outputWhite', label: '输出白场', min: Math.min(255, settings.outputBlack + 1), max: 255 }} value={settings.outputWhite} onChange={(value) => update('outputWhite', value)} />
          </PanelSection>

          <PanelSection title="曲线" hint="五点亮度曲线，调整暗部、中间调和亮部" defaultOpen={false}>
            <ToneCurveEditor value={settings.curve} onChange={(value) => update('curve', value)} />
          </PanelSection>

          <PanelSection title="阴影 / 高光着色" hint="分别为暗部与亮部叠加色相" defaultOpen={false}>
            <div className="mb-4 grid grid-cols-2 gap-3">
              <label className="rounded-md border border-white/8 bg-black/20 p-3">
                <span className="mb-2 block text-[11px] text-neutral-500">阴影颜色</span>
                <span className="flex items-center gap-2"><input type="color" value={settings.shadowColor} onChange={(event) => update('shadowColor', event.target.value)} className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent" /><span className="font-mono text-[10px] text-neutral-500">{settings.shadowColor}</span></span>
              </label>
              <label className="rounded-md border border-white/8 bg-black/20 p-3">
                <span className="mb-2 block text-[11px] text-neutral-500">高光颜色</span>
                <span className="flex items-center gap-2"><input type="color" value={settings.highlightColor} onChange={(event) => update('highlightColor', event.target.value)} className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent" /><span className="font-mono text-[10px] text-neutral-500">{settings.highlightColor}</span></span>
              </label>
            </div>
            <AdjustmentSlider control={{ key: 'shadowTone', label: '阴影着色', min: 0, max: 100 }} value={settings.shadowTone} onChange={(value) => update('shadowTone', value)} />
            <AdjustmentSlider control={{ key: 'highlightTone', label: '高光着色', min: 0, max: 100 }} value={settings.highlightTone} onChange={(value) => update('highlightTone', value)} />
            <AdjustmentSlider control={{ key: 'toneBalance', label: '明暗平衡', min: -100, max: 100 }} value={settings.toneBalance} onChange={(value) => update('toneBalance', value)} />
          </PanelSection>

          <PanelSection title="渐变映射" hint="按明度将阴影、中间调和高光映射为指定颜色" defaultOpen={false}>
            <label className="mb-4 flex items-center justify-between rounded-md border border-white/8 bg-black/20 p-3 text-xs text-neutral-300">
              启用渐变映射
              <input type="checkbox" checked={settings.gradientEnabled} onChange={(event) => update('gradientEnabled', event.target.checked)} className="h-4 w-4 accent-cyan-400" />
            </label>
            <div className="mb-4 overflow-hidden rounded-md border border-white/10">
              <div className="h-9" style={{ background: `linear-gradient(90deg, ${settings.gradientShadow}, ${settings.gradientMid}, ${settings.gradientHighlight})` }} />
              <div className="grid grid-cols-3 gap-px bg-white/8 p-px">
                {([
                  ['gradientShadow', settings.gradientShadow, '阴影'],
                  ['gradientMid', settings.gradientMid, '中间调'],
                  ['gradientHighlight', settings.gradientHighlight, '高光'],
                ] as const).map(([key, color, label]) => (
                  <label key={key} className="flex flex-col items-center gap-1 bg-[#0d1011] py-2 text-[10px] text-neutral-600">
                    <input type="color" value={color} onChange={(event) => update(key, event.target.value)} className="h-7 w-10 cursor-pointer border-0 bg-transparent" />
                    {label}
                  </label>
                ))}
              </div>
            </div>
            <AdjustmentSlider control={{ key: 'gradientAmount', label: '映射强度', min: 0, max: 100 }} value={settings.gradientAmount} onChange={(value) => update('gradientAmount', value)} />
          </PanelSection>

          <PanelSection title="质感" hint="褪色、暗角、颗粒与锐化" defaultOpen={false}>
            {EFFECT_CONTROLS.map((control) => <AdjustmentSlider key={String(control.key)} control={control} value={settings[control.key] as number} onChange={(value) => update(control.key, value as never)} />)}
          </PanelSection>
        </div>
      </aside>
    </div>
  );
};
