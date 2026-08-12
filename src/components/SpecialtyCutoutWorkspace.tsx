import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Clapperboard,
  Download,
  Image as ImageIcon,
  LoaderCircle,
  PackageCheck,
  RotateCcw,
  Save,
  SlidersHorizontal,
  WandSparkles,
} from 'lucide-react';
import { addToLibrary, loadLibrary, type LibraryAsset } from '../utils/assetLibrary';
import {
  DEFAULT_SPECIALTY_CUTOUT_SETTINGS,
  renderSpecialtyCutout,
} from '../utils/specialtyCutout';
import { runSmartCutout } from '../utils/smartCutoutService';
import type {
  SpecialtyCutoutSettings,
  SpecialtyItem,
  SpecialtyProject,
} from '../utils/specialtyWorkflow';

interface SpecialtyCutoutWorkspaceProps {
  project: SpecialtyProject;
  onProjectChange: (project: SpecialtyProject) => void;
  onBack: () => void;
  onAnimate: (project: SpecialtyProject) => void;
}

interface SettingSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}

type CutoutMode = 'smart' | 'manual';

const checkerboardStyle: React.CSSProperties = {
  backgroundColor: '#f4f4f5',
  backgroundImage: 'linear-gradient(45deg, #dedfe1 25%, transparent 25%), linear-gradient(-45deg, #dedfe1 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #dedfe1 75%), linear-gradient(-45deg, transparent 75%, #dedfe1 75%)',
  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0',
  backgroundSize: '20px 20px',
};

const SettingSlider: React.FC<SettingSliderProps> = ({
  label,
  value,
  min,
  max,
  suffix = '',
  onChange,
}) => (
  <label className="block">
    <span className="mb-2 flex items-center justify-between text-sm text-neutral-300">
      <span>{label}</span>
      <span className="font-mono text-xs text-cyan-300">{value}{suffix}</span>
    </span>
    <input
      type="range"
      min={min}
      max={max}
      value={value}
      className="w-full accent-cyan-400"
      onInput={(event) => onChange(Number(event.currentTarget.value))}
    />
  </label>
);

const mergeSettings = (item?: SpecialtyItem): SpecialtyCutoutSettings => ({
  ...DEFAULT_SPECIALTY_CUTOUT_SETTINGS,
  ...(item?.cutoutSettings || {}),
});

export const SpecialtyCutoutWorkspace: React.FC<SpecialtyCutoutWorkspaceProps> = ({
  project,
  onProjectChange,
  onBack,
  onAnimate,
}) => {
  const selectedItems = useMemo(
    () => project.items.filter((item) => item.selectedAssetId),
    [project.items]
  );
  const [assets, setAssets] = useState<Map<string, LibraryAsset>>(new Map());
  const [activeItemId, setActiveItemId] = useState(selectedItems[0]?.id || '');
  const activeItem = selectedItems.find((item) => item.id === activeItemId) || selectedItems[0];
  const sourceAsset = activeItem?.selectedAssetId ? assets.get(activeItem.selectedAssetId) : undefined;
  const outputAsset = activeItem?.outputAssetId ? assets.get(activeItem.outputAssetId) : undefined;
  const [settings, setSettings] = useState<SpecialtyCutoutSettings>(() => mergeSettings(activeItem));
  const [cutoutMode, setCutoutMode] = useState<CutoutMode>('smart');
  const [previewUrl, setPreviewUrl] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [rendering, setRendering] = useState(false);
  const [progressLabel, setProgressLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const previewRequestRef = useRef(0);
  const smartPreviewCacheRef = useRef<Map<string, string>>(new Map());
  const smartRequestCacheRef = useRef<Map<string, Promise<string>>>(new Map());

  const getSmartCutout = (
    sourceUrl: string,
    onProgress?: Parameters<typeof runSmartCutout>[1],
  ) => {
    const cached = smartPreviewCacheRef.current.get(sourceUrl);
    if (cached) return Promise.resolve(cached);
    const pending = smartRequestCacheRef.current.get(sourceUrl);
    if (pending) return pending;
    const request = runSmartCutout(sourceUrl, onProgress)
      .then((url) => {
        smartPreviewCacheRef.current.set(sourceUrl, url);
        smartRequestCacheRef.current.delete(sourceUrl);
        return url;
      })
      .catch((error) => {
        smartRequestCacheRef.current.delete(sourceUrl);
        throw error;
      });
    smartRequestCacheRef.current.set(sourceUrl, request);
    return request;
  };

  useEffect(() => {
    let cancelled = false;
    void loadLibrary().then((libraryAssets) => {
      if (!cancelled) setAssets(new Map(libraryAssets.map((asset) => [asset.id, asset])));
    });
    return () => { cancelled = true; };
  }, [project.id]);

  useEffect(() => {
    if (!selectedItems.length) return;
    if (!selectedItems.some((item) => item.id === activeItemId)) setActiveItemId(selectedItems[0].id);
  }, [activeItemId, selectedItems]);

  useEffect(() => {
    setSettings(mergeSettings(activeItem));
  }, [activeItem?.id]);

  useEffect(() => {
    if (!sourceAsset?.url) {
      setPreviewUrl('');
      return;
    }
    if (cutoutMode === 'smart') {
      const cached = smartPreviewCacheRef.current.get(sourceAsset.url);
      if (cached) {
        previewRequestRef.current += 1;
        setPreviewUrl(cached);
        setPreviewError('');
        setRendering(false);
        setProgressLabel('');
        return;
      }
    }
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    const frame = window.requestAnimationFrame(() => {
      setRendering(true);
      setPreviewError('');
      const renderTask = cutoutMode === 'smart'
        ? getSmartCutout(sourceAsset.url, ({ percent, label }) => setProgressLabel(`${label} ${percent}%`))
        : renderSpecialtyCutout(sourceAsset.url, settings, 700, 720);
      void renderTask
        .then((url) => {
          if (previewRequestRef.current === requestId) setPreviewUrl(url);
        })
        .catch((error: any) => {
          if (previewRequestRef.current === requestId) setPreviewError(error?.message || '透明图处理失败');
        })
        .finally(() => {
          if (previewRequestRef.current === requestId) {
            setRendering(false);
            setProgressLabel('');
          }
        });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (previewRequestRef.current === requestId) previewRequestRef.current += 1;
    };
  }, [cutoutMode, settings, sourceAsset?.url]);

  const updateSetting = (key: keyof SpecialtyCutoutSettings, value: number) => {
    setSettings((current) => ({ ...current, [key]: value }));
  };

  const addOutputAsset = async (
    item: SpecialtyItem,
    dataUrl: string,
    appliedSettings: SpecialtyCutoutSettings
  ) => addToLibrary({
    url: dataUrl,
    type: 'image',
    name: `${item.name} 透明道具 700x700`,
    prompt: `${item.name} 特产道具透明规范素材`,
    thumbnail: dataUrl,
    width: 700,
    height: 700,
    projectId: project.id,
    workflowId: project.id,
    stage: 'specialty-output',
    parentAssetId: item.selectedAssetId,
    selected: true,
    status: 'final',
    generationParams: { ...appliedSettings, outputSize: 700, cutoutMode },
    tags: ['特产道具', item.name, '透明PNG', '700x700'],
  });

  const saveCurrent = async () => {
    if (!activeItem || !sourceAsset?.url || saving) return;
    setSaving(true);
    try {
      const dataUrl = cutoutMode === 'smart'
        ? await getSmartCutout(sourceAsset.url)
        : await renderSpecialtyCutout(sourceAsset.url, settings);
      const asset = await addOutputAsset(activeItem, dataUrl, settings);
      setAssets((current) => new Map(current).set(asset.id, asset));
      onProjectChange({
        ...project,
        items: project.items.map((item) => item.id === activeItem.id
          ? { ...item, outputAssetId: asset.id, cutoutSettings: settings, animationVideoAssetId: undefined, animationPrompt: undefined, animationSourceAssetId: undefined }
          : item),
      });
    } catch (error: any) {
      setPreviewError(error?.message || '保存透明素材失败');
    } finally {
      setSaving(false);
    }
  };

  const processAll = async () => {
    if (!selectedItems.length || batchProgress) return;
    const nextItems = [...project.items];
    setBatchProgress({ current: 0, total: selectedItems.length });
    try {
      for (let index = 0; index < selectedItems.length; index += 1) {
        const item = selectedItems[index];
        const source = item.selectedAssetId ? assets.get(item.selectedAssetId) : undefined;
        if (!source?.url) throw new Error(`找不到“${item.name}”的候选图片`);
        const appliedSettings = item.id === activeItem?.id ? settings : mergeSettings(item);
        const dataUrl = cutoutMode === 'smart'
          ? await getSmartCutout(source.url)
          : await renderSpecialtyCutout(source.url, appliedSettings);
        const asset = await addOutputAsset(item, dataUrl, appliedSettings);
        setAssets((current) => new Map(current).set(asset.id, asset));
        const itemIndex = nextItems.findIndex((entry) => entry.id === item.id);
        nextItems[itemIndex] = {
          ...nextItems[itemIndex],
          outputAssetId: asset.id,
          cutoutSettings: appliedSettings,
          animationVideoAssetId: undefined,
          animationPrompt: undefined,
          animationSourceAssetId: undefined,
        };
        setBatchProgress({ current: index + 1, total: selectedItems.length });
      }
      onProjectChange({ ...project, items: nextItems });
    } catch (error: any) {
      setPreviewError(error?.message || '批量处理失败');
    } finally {
      setBatchProgress(null);
    }
  };

  const enterAnimation = async () => {
    if (!activeItem || !sourceAsset?.url || !previewUrl || rendering || saving || batchProgress) return;
    setSaving(true);
    setPreviewError('');
    try {
      const savedSettings = mergeSettings(activeItem);
      const settingsUnchanged = JSON.stringify(savedSettings) === JSON.stringify(settings);
      const savedMode = outputAsset?.generationParams?.cutoutMode;
      if (activeItem.outputAssetId && settingsUnchanged && savedMode === cutoutMode) {
        onAnimate({ ...project, stage: 'animate' });
        return;
      }
      const dataUrl = cutoutMode === 'smart'
        ? await getSmartCutout(sourceAsset.url)
        : await renderSpecialtyCutout(sourceAsset.url, settings);
      const asset = await addOutputAsset(activeItem, dataUrl, settings);
      setAssets((current) => new Map(current).set(asset.id, asset));
      const nextProject: SpecialtyProject = {
        ...project,
        stage: 'animate',
        items: project.items.map((item) => item.id === activeItem.id
          ? {
            ...item,
            outputAssetId: asset.id,
            cutoutSettings: settings,
            animationVideoAssetId: undefined,
            animationPrompt: undefined,
            animationSourceAssetId: undefined,
          }
          : item),
      };
      onAnimate(nextProject);
    } catch (error: any) {
      setPreviewError(error?.message || '自动保存透明素材失败');
    } finally {
      setSaving(false);
    }
  };

  const downloadCurrent = async () => {
    if (!activeItem || downloading || (!outputAsset?.url && !sourceAsset?.url)) return;
    const fileName = `${activeItem.name}-700x700.png`;
    const showSaveFilePicker = (window as any).showSaveFilePicker as undefined | ((options: unknown) => Promise<any>);
    let fileHandle: any;
    if (showSaveFilePicker) {
      try {
        fileHandle = await showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: 'PNG 图片', accept: { 'image/png': ['.png'] } }],
        });
      } catch (error: any) {
        if (error?.name === 'AbortError') return;
      }
    }
    setDownloading(true);
    setPreviewError('');
    try {
      const url = cutoutMode === 'smart'
        ? await getSmartCutout(sourceAsset!.url)
        : outputAsset?.url || await renderSpecialtyCutout(sourceAsset!.url, settings);
      const response = await fetch(url);
      if (!response.ok) throw new Error('PNG 文件准备失败');
      const blob = await response.blob();
      if (fileHandle) {
        const writable = await fileHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
    } catch (error: any) {
      setPreviewError(error?.message || 'PNG 下载失败，请重试');
    } finally {
      setDownloading(false);
    }
  };

  const completedCount = selectedItems.filter((item) => item.outputAssetId).length;
  const canDownload = Boolean(activeItem && (outputAsset?.url || sourceAsset?.url));

  return (
    <div className="flex min-h-0 flex-1 bg-[#090b0c] text-white">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-white/8 bg-[#0d1010]">
        <div className="border-b border-white/8 p-5">
          <button className="flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-neutral-300 hover:text-white" onClick={onBack}>
            <ArrowLeft size={15} /> 返回候选
          </button>
          <p className="mt-5 text-xs uppercase text-cyan-300">Specialty Props</p>
          <h2 className="mt-1 text-xl font-semibold">智能抠图与尺寸规范</h2>
          <p className="mt-2 text-xs leading-5 text-neutral-500">自动保留完整道具、底座和关联部件，并统一输出透明 PNG。</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="mb-3 flex items-center justify-between px-1 text-xs text-neutral-500">
            <span>待处理 {selectedItems.length}</span>
            <span className="text-emerald-300">已完成 {completedCount}</span>
          </div>
          <div className="space-y-2">
            {selectedItems.map((item, index) => {
              const source = item.selectedAssetId ? assets.get(item.selectedAssetId) : undefined;
              const active = item.id === activeItem?.id;
              return (
                <button
                  key={item.id}
                  className={`flex w-full items-center gap-3 rounded-md border p-2 text-left ${active ? 'border-cyan-400/45 bg-cyan-400/8' : 'border-white/8 hover:border-white/20'}`}
                  onClick={() => setActiveItemId(item.id)}
                >
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-white">
                    {source ? <img src={source.thumbnail || source.url} alt={item.name} className="h-full w-full object-contain" /> : <ImageIcon size={18} className="m-4 text-neutral-500" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-neutral-200">{index + 1}. {item.name}</p>
                    <p className={`mt-1 text-[11px] ${item.outputAssetId ? 'text-emerald-300' : 'text-neutral-600'}`}>{item.outputAssetId ? '透明素材已保存' : '等待处理'}</p>
                  </div>
                  {item.outputAssetId && <Check size={15} className="shrink-0 text-emerald-300" />}
                </button>
              );
            })}
          </div>
        </div>
        <div className="border-t border-white/8 p-4">
          <button
            disabled={!selectedItems.length || Boolean(batchProgress)}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-white text-sm font-semibold text-black disabled:opacity-40"
            onClick={() => void processAll()}
          >
            {batchProgress ? <LoaderCircle size={16} className="animate-spin" /> : <PackageCheck size={16} />}
            {batchProgress ? `智能抠图 ${batchProgress.current}/${batchProgress.total}` : '批量智能抠图全部'}
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/8 px-6">
          <div>
            <p className="text-sm font-medium">02 透明素材确认</p>
            <p className="mt-1 text-xs text-neutral-600">{activeItem ? activeItem.name : '暂无选中素材'} · 700 × 700 px</p>
          </div>
          <div className="flex items-center gap-2">
            <button disabled={!activeItem || !previewUrl || rendering || saving || Boolean(batchProgress)} className="flex h-9 items-center gap-2 rounded-md bg-violet-300 px-4 text-sm font-semibold text-[#130d18] hover:bg-violet-200 disabled:cursor-not-allowed disabled:opacity-35" onClick={() => void enterAnimation()}>{saving ? <LoaderCircle size={14} className="animate-spin" /> : <Clapperboard size={14} />} {saving ? '正在自动保存' : '可选：制作道具动画'}</button>
            <button disabled={!canDownload || downloading} className="flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-neutral-300 hover:border-cyan-400/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-35" onClick={() => void downloadCurrent()}>{downloading ? <LoaderCircle size={14} className="animate-spin" /> : <Download size={14} />} {downloading ? '正在准备' : '下载 PNG'}</button>
            <button disabled={!activeItem || !previewUrl || saving} className="flex h-9 items-center gap-2 rounded-md bg-cyan-400 px-4 text-sm font-semibold text-[#061315] disabled:opacity-35" onClick={() => void saveCurrent()}>{saving ? <LoaderCircle size={14} className="animate-spin" /> : <Save size={14} />} 保存当前到仓库</button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-8">
          <div className="relative aspect-square w-full max-w-[700px] overflow-hidden border border-white/10 shadow-2xl" style={checkerboardStyle}>
            {previewUrl && <img src={previewUrl} alt={`${activeItem?.name || ''} 透明预览`} className="h-full w-full object-contain" />}
            {rendering && !previewUrl && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/35"><LoaderCircle size={28} className="animate-spin text-cyan-300" /><span className="text-xs text-neutral-300">{progressLabel || (cutoutMode === 'smart' ? '正在智能识别完整道具' : '正在更新预览')}</span></div>}
            {rendering && previewUrl && <div className="absolute right-3 top-3 flex h-8 items-center gap-2 rounded-md bg-black/65 px-3 text-xs text-white"><LoaderCircle size={13} className="animate-spin text-cyan-300" /> {progressLabel || '实时更新'}</div>}
            {!previewUrl && !rendering && <div className="absolute inset-0 flex flex-col items-center justify-center text-neutral-500"><ImageIcon size={32} /><p className="mt-3 text-sm">等待透明预览</p></div>}
          </div>
        </div>
        {previewError && <div className="mx-8 mb-5 rounded-md border border-red-400/20 bg-red-400/8 px-4 py-3 text-sm text-red-300">{previewError}</div>}
      </main>

      <aside className="w-[340px] shrink-0 overflow-y-auto border-l border-white/8 bg-[#101314] p-5">
        <div className="flex items-center gap-2"><WandSparkles size={16} className="text-cyan-300" /><h3 className="font-medium">道具抠图方式</h3></div>
        <div className="mt-4 grid grid-cols-2 gap-1 rounded-lg border border-white/8 bg-black/25 p-1">
          <button type="button" onClick={() => setCutoutMode('smart')} className={`h-9 rounded-md text-xs font-medium ${cutoutMode === 'smart' ? 'bg-cyan-300 text-[#061315]' : 'text-neutral-500 hover:text-white'}`}>智能抠图</button>
          <button type="button" onClick={() => setCutoutMode('manual')} className={`h-9 rounded-md text-xs font-medium ${cutoutMode === 'manual' ? 'bg-white/12 text-white' : 'text-neutral-500 hover:text-white'}`}>手动调整</button>
        </div>
        {cutoutMode === 'smart' ? (
          <div className="mt-6 rounded-md border border-cyan-300/15 bg-cyan-300/[0.055] p-5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-300/12 text-cyan-200"><WandSparkles size={18} /></span>
            <h4 className="mt-4 text-sm font-semibold text-cyan-50">自动保留完整道具组合</h4>
            <p className="mt-2 text-xs leading-5 text-cyan-50/45">识别道具主体、底座和强关联部件，再精修透明边缘与白边。无需调整参数，预览结果即为最终保存结果。</p>
            <div className="mt-4 rounded-md border border-white/8 bg-black/15 px-3 py-3 text-[11px] leading-5 text-neutral-500">统一输出 700 × 700 透明 PNG；批量处理会逐张调用同一套智能策略。</div>
          </div>
        ) : (
        <>
        <div className="mt-6 flex items-center justify-between">
          <div className="flex items-center gap-2"><SlidersHorizontal size={16} className="text-neutral-400" /><h3 className="text-sm font-medium">手动透明与色彩</h3></div>
          <button className="flex h-8 items-center gap-1.5 rounded-md border border-white/10 px-2.5 text-xs text-neutral-400 hover:text-white" onClick={() => setSettings({ ...DEFAULT_SPECIALTY_CUTOUT_SETTINGS })}><RotateCcw size={12} /> 重置</button>
        </div>
        <div className="mt-4 space-y-6">
          <section className="space-y-5 rounded-md border border-white/8 bg-black/15 p-4">
            <p className="text-xs font-medium text-neutral-500">背景去除</p>
            <SettingSlider label="去除强度" value={settings.threshold} min={10} max={90} onChange={(value) => updateSetting('threshold', value)} />
            <SettingSlider label="边缘柔化" value={settings.feather} min={0} max={35} onChange={(value) => updateSetting('feather', value)} />
            <SettingSlider label="阴影清理" value={settings.shadowCleanup} min={0} max={100} onChange={(value) => updateSetting('shadowCleanup', value)} />
            <SettingSlider label="白边净化" value={settings.edgeCleanup} min={0} max={100} onChange={(value) => updateSetting('edgeCleanup', value)} />
            <SettingSlider label="主体留白" value={settings.padding} min={4} max={30} suffix="%" onChange={(value) => updateSetting('padding', value)} />
          </section>
          <section className="space-y-5 rounded-md border border-white/8 bg-black/15 p-4">
            <p className="text-xs font-medium text-neutral-500">基础调色</p>
            <SettingSlider label="亮度" value={settings.brightness} min={-30} max={30} onChange={(value) => updateSetting('brightness', value)} />
            <SettingSlider label="对比度" value={settings.contrast} min={-40} max={40} onChange={(value) => updateSetting('contrast', value)} />
            <SettingSlider label="饱和度" value={settings.saturation} min={-50} max={50} onChange={(value) => updateSetting('saturation', value)} />
            <SettingSlider label="色温" value={settings.temperature} min={-30} max={30} onChange={(value) => updateSetting('temperature', value)} />
          </section>
        </div>
        <div className="mt-5 rounded-md border border-white/8 p-4 text-xs leading-5 text-neutral-500">
          阴影清理会追踪与画布边缘连通的中性灰阴影；白边净化会还原半透明边缘中的白色底色。彩色复杂背景仍建议使用语义分割模型或手动蒙版。
        </div>
        </>
        )}
      </aside>
    </div>
  );
};
