import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Clapperboard,
  Download,
  FileJson,
  ImagePlus,
  KeyRound,
  LoaderCircle,
  Play,
  RefreshCw,
  Sparkles,
  Upload,
  X,
} from 'lucide-react';
import { pollTaskUntilDone, submitGenerateTask } from '../ai/client';
import {
  presetSupportsKind,
  rememberModelSecrets,
  useModelPresets,
  withRememberedModelSecrets,
} from '../ai/presets';
import { DEFAULT_MODEL_CONFIG, type ModelConfig } from '../ai/types';
import { addToLibrary, loadLibrary, type LibraryAsset } from '../utils/assetLibrary';
import type { SpecialtyItem, SpecialtyProject } from '../utils/specialtyWorkflow';

interface SpecialtyAnimationWorkspaceProps {
  project: SpecialtyProject;
  onProjectChange: (project: SpecialtyProject) => void;
  onBack: () => void;
  onOpenVideoExport: (asset: LibraryAsset) => void;
}

const GREEN_SCREEN = '#00ff00';
const DEFAULT_VIDEO_PRESET_ID = '__jd_seedance_2_fast__';

const buildAnimationPrompt = (name: string, action = '道具完成一次清晰、自然且具有游戏感的功能动画') => (
  `保持【${name}】的造型、比例、材质、颜色、视角和全部识别特征严格一致，${action}。` +
  '固定镜头，主体始终完整居中，不缩放、不切边，不增加其他物体、文字、粒子或装饰。' +
  '背景必须从第一帧到最后一帧保持完全均匀的纯绿色 #00FF00，无阴影、无渐变、无纹理、无环境反射，便于后续逐帧抠除并导出透明 Lottie。' +
  '动画起止姿态稳定，动作节奏清楚，最后停留半秒。'
);

const ACTION_PRESETS = [
  { label: '打开 / 展开', text: '道具的可开合结构缓慢打开并完整展示内部，动作结束后稳定停住' },
  { label: '轻微弹跳', text: '道具原地轻轻弹起并回落，带有克制的挤压回弹，最终回到初始位置' },
  { label: '旋转展示', text: '道具围绕自身垂直轴平稳旋转一周，完整展示正面、侧面和背面' },
  { label: '激活发光', text: '道具从静止状态被激活，主体自身出现柔和光效后逐渐稳定，但不向背景投射颜色' },
] as const;

const fileToDataUrl = (file: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('主体素材读取失败'));
  reader.readAsDataURL(file);
});

const sourceToBlob = async (source: string) => {
  const requestUrl = /^https?:\/\//i.test(source)
    ? `/remote-asset?u=${encodeURIComponent(source)}`
    : source;
  const response = await fetch(requestUrl);
  if (!response.ok) throw new Error(`道具图片读取失败 (HTTP ${response.status})`);
  return response.blob();
};

const createGreenScreenFrame = async (source: string) => {
  const blob = await sourceToBlob(source);
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('道具图片解码失败'));
      image.src = objectUrl;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 700;
    canvas.height = 700;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建绿幕首帧');
    context.fillStyle = GREEN_SCREEN;
    context.fillRect(0, 0, 700, 700);
    const scale = Math.min(700 / image.naturalWidth, 700 / image.naturalHeight);
    const width = image.naturalWidth * scale;
    const height = image.naturalHeight * scale;
    context.drawImage(image, (700 - width) / 2, (700 - height) / 2, width, height);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

export const SpecialtyAnimationWorkspace: React.FC<SpecialtyAnimationWorkspaceProps> = ({
  project,
  onProjectChange,
  onBack,
  onOpenVideoExport,
}) => {
  const animatedItems = useMemo(
    () => project.items.filter((item) => item.outputAssetId),
    [project.items]
  );
  const [assets, setAssets] = useState<Map<string, LibraryAsset>>(new Map());
  const [activeItemId, setActiveItemId] = useState(animatedItems[0]?.id || '');
  const [modelConfig, setModelConfig] = useState<ModelConfig>(DEFAULT_MODEL_CONFIG);
  const [videoPresetId, setVideoPresetId] = useState(DEFAULT_VIDEO_PRESET_ID);
  const [prompt, setPrompt] = useState(() => buildAnimationPrompt(animatedItems[0]?.name || '道具'));
  const [configExpanded, setConfigExpanded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [subjectUploading, setSubjectUploading] = useState(false);
  const [phase, setPhase] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const subjectInputRef = useRef<HTMLInputElement | null>(null);
  const { allPresets, activePresetId, switchPreset } = useModelPresets(setModelConfig);

  const videoPresets = useMemo(
    () => allPresets.filter((preset) => presetSupportsKind(preset, 'video')),
    [allPresets]
  );
  const selectedPreset = videoPresets.find((preset) => preset.id === videoPresetId)
    || videoPresets.find((preset) => preset.id === DEFAULT_VIDEO_PRESET_ID)
    || videoPresets[0];
  const activeItem = animatedItems.find((item) => item.id === activeItemId) || animatedItems[0];
  const sourceAssetId = activeItem?.animationSourceAssetId || activeItem?.outputAssetId;
  const sourceAsset = sourceAssetId ? assets.get(sourceAssetId) : undefined;
  const videoAsset = activeItem?.animationVideoAssetId ? assets.get(activeItem.animationVideoAssetId) : undefined;
  const usingUploadedSubject = Boolean(activeItem?.animationSourceAssetId);

  useEffect(() => {
    let cancelled = false;
    void loadLibrary().then((libraryAssets) => {
      if (!cancelled) setAssets(new Map(libraryAssets.map((asset) => [asset.id, asset])));
    });
    return () => { cancelled = true; };
  }, [project.id]);

  useEffect(() => {
    if (!animatedItems.length) return;
    if (!animatedItems.some((item) => item.id === activeItemId)) setActiveItemId(animatedItems[0].id);
  }, [activeItemId, animatedItems]);

  useEffect(() => {
    if (!activeItem) return;
    setPrompt(activeItem.animationPrompt || buildAnimationPrompt(activeItem.name));
    setErrorMessage('');
  }, [activeItem?.id]);

  useEffect(() => {
    const desired = videoPresets.find((preset) => preset.id === videoPresetId)
      || videoPresets.find((preset) => preset.id === DEFAULT_VIDEO_PRESET_ID)
      || videoPresets[0];
    if (!desired) return;
    if (videoPresetId !== desired.id) setVideoPresetId(desired.id);
    if (activePresetId !== desired.id) switchPreset(desired.id);
    setModelConfig(withRememberedModelSecrets(desired.config));
  }, [activePresetId, switchPreset, videoPresetId, videoPresets]);

  const chooseVideoPreset = (presetId: string) => {
    const preset = videoPresets.find((entry) => entry.id === presetId);
    if (!preset) return;
    setVideoPresetId(presetId);
    switchPreset(presetId);
    setModelConfig(withRememberedModelSecrets(preset.config));
  };

  const updateModelConfig = (patch: Partial<ModelConfig>) => {
    setModelConfig((current) => {
      const next = { ...current, ...patch };
      if ('apiKey' in patch || 'imgbbApiKey' in patch) rememberModelSecrets(next);
      return next;
    });
  };

  const applyActionPreset = (action: string) => {
    if (!activeItem) return;
    setPrompt(buildAnimationPrompt(activeItem.name, action));
  };

  const uploadAnimationSubject = async (file?: File) => {
    if (!activeItem || !file || subjectUploading || generating) return;
    if (!file.type.startsWith('image/')) {
      setErrorMessage('请选择 PNG、JPG 或 WebP 图片作为动画主体。');
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setErrorMessage('主体素材不能超过 25 MB。');
      return;
    }
    setSubjectUploading(true);
    setErrorMessage('');
    try {
      const dataUrl = await fileToDataUrl(file);
      const asset = await addToLibrary({
        url: dataUrl,
        type: 'image',
        name: `${activeItem.name} 动画主体 · ${file.name}`,
        prompt: '用户上传的道具动画主体素材',
        thumbnail: dataUrl,
        projectId: project.id,
        workflowId: project.id,
        stage: 'specialty-animation-source',
        parentAssetId: activeItem.outputAssetId,
        selected: true,
        status: 'source',
        tags: ['特产道具', activeItem.name, '动画主体', '用户上传'],
      });
      setAssets((current) => new Map(current).set(asset.id, asset));
      onProjectChange({
        ...project,
        stage: 'animate',
        items: project.items.map((item) => item.id === activeItem.id
          ? { ...item, animationSourceAssetId: asset.id, animationVideoAssetId: undefined }
          : item),
      });
    } catch (error: any) {
      setErrorMessage(error?.message || '动画主体上传失败');
    } finally {
      setSubjectUploading(false);
    }
  };

  const restoreGeneratedSubject = () => {
    if (!activeItem || generating) return;
    onProjectChange({
      ...project,
      stage: 'animate',
      items: project.items.map((item) => item.id === activeItem.id
        ? { ...item, animationSourceAssetId: undefined, animationVideoAssetId: undefined }
        : item),
    });
    setErrorMessage('');
  };

  const generateAnimation = async () => {
    if (!activeItem || !sourceAsset?.url || generating) return;
    if (!modelConfig.baseUrl.trim() || !modelConfig.model.trim() || !modelConfig.videoGeneratePath.trim()) {
      setConfigExpanded(true);
      setErrorMessage('请先选择并完整配置一个视频模型。');
      return;
    }
    if (!modelConfig.apiKey.trim()) {
      setConfigExpanded(true);
      setErrorMessage('首次生成需要填写 API Key。Key 只保存在当前浏览器。');
      return;
    }
    if (!prompt.trim()) {
      setErrorMessage('请先描述道具需要完成的动画。');
      return;
    }
    setGenerating(true);
    setErrorMessage('');
    setPhase('正在准备 700 × 700 绿幕首帧');
    try {
      const firstFrame = await createGreenScreenFrame(sourceAsset.url);
      setPhase('已提交视频模型，正在生成道具动画');
      const first = await submitGenerateTask(modelConfig, {
        kind: 'video',
        videoMode: 'image2video',
        prompt: prompt.trim(),
        size: '700x700',
        ratio: '1:1',
        resolution: '720p',
        durationSec: 5,
        referenceImages: [],
        firstFrame,
      });
      const result = first.taskId && first.status !== 'succeeded' && modelConfig.taskStatusPath
        ? await pollTaskUntilDone(modelConfig, first.taskId)
        : first;
      if (result.status === 'failed' || !result.urls.length) {
        throw new Error(result.errorMessage || '模型没有返回视频');
      }
      setPhase('正在保存视频到素材仓库');
      const asset = await addToLibrary({
        url: result.urls[0],
        type: 'video',
        name: `${activeItem.name} 道具动画`,
        prompt: prompt.trim(),
        projectId: project.id,
        workflowId: project.id,
        stage: 'specialty-animation',
        parentAssetId: sourceAsset.id,
        model: modelConfig.model,
        generationParams: {
          videoMode: 'image2video',
          durationSec: 5,
          ratio: '1:1',
          greenScreen: GREEN_SCREEN,
        },
        selected: true,
        status: 'final',
        tags: ['特产道具', activeItem.name, '道具动画', '绿幕视频', '待导出Lottie'],
      });
      setAssets((current) => new Map(current).set(asset.id, asset));
      onProjectChange({
        ...project,
        stage: 'animate',
        items: project.items.map((item) => item.id === activeItem.id
          ? { ...item, animationVideoAssetId: asset.id, animationPrompt: prompt.trim() }
          : item),
      });
      setPhase('');
    } catch (error: any) {
      setErrorMessage(error?.message || '道具动画生成失败');
      setPhase('');
    } finally {
      setGenerating(false);
    }
  };

  const downloadVideo = () => {
    if (!videoAsset) return;
    const anchor = document.createElement('a');
    anchor.href = videoAsset.url;
    anchor.download = `${activeItem?.name || 'prop'}-animation.mp4`;
    anchor.target = '_blank';
    anchor.rel = 'noreferrer';
    anchor.click();
  };

  return (
    <div className="flex min-h-0 flex-1 bg-[#090b0c] text-white">
      <input
        ref={subjectInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          void uploadAnimationSubject(file);
        }}
      />
      <aside className="flex w-[285px] shrink-0 flex-col border-r border-white/8 bg-[#0d1010]">
        <div className="border-b border-white/8 p-5">
          <button className="flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-neutral-300 hover:text-white" onClick={onBack}>
            <ArrowLeft size={15} /> 返回透明素材
          </button>
          <p className="mt-5 text-xs uppercase text-violet-300">Prop Animation</p>
          <h2 className="mt-1 text-xl font-semibold">道具动画</h2>
          <p className="mt-2 text-xs leading-5 text-neutral-500">动画是可选分支。只为需要动态表现的道具制作，其他道具继续保留静态 PNG。</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <p className="mb-3 px-1 text-xs text-neutral-500">按需选择 · 不要求全部完成</p>
          <div className="space-y-2">
            {animatedItems.map((item, index) => {
              const sourceId = item.animationSourceAssetId || item.outputAssetId;
              const source = sourceId ? assets.get(sourceId) : undefined;
              const active = item.id === activeItem?.id;
              return (
                <button
                  key={item.id}
                  className={`flex w-full items-center gap-3 rounded-md border p-2 text-left ${active ? 'border-violet-400/45 bg-violet-400/8' : 'border-white/8 hover:border-white/20'}`}
                  onClick={() => setActiveItemId(item.id)}
                >
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-[#00ff00]">
                    {source && <img src={source.thumbnail || source.url} alt={item.name} className="h-full w-full object-contain" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-neutral-200">{index + 1}. {item.name}</p>
                    <p className={`mt-1 text-[11px] ${item.animationVideoAssetId ? 'text-violet-300' : item.animationSourceAssetId ? 'text-cyan-300' : 'text-neutral-600'}`}>{item.animationVideoAssetId ? '动画已生成' : item.animationSourceAssetId ? '使用上传主体 · 待生成' : '静态素材已完成 · 动画可选'}</p>
                  </div>
                  {item.animationVideoAssetId && <Check size={15} className="shrink-0 text-violet-300" />}
                </button>
              );
            })}
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/8 px-6">
          <div>
            <p className="text-sm font-medium">03 道具动画生成</p>
            <p className="mt-1 text-xs text-neutral-600">{activeItem?.name || '暂无道具'} · {usingUploadedSubject ? '上传主体' : '当前道具'} · 单图生视频</p>
          </div>
          {videoAsset && (
            <div className="flex items-center gap-2">
              <button className="flex h-9 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-neutral-300 hover:text-white" onClick={downloadVideo}><Download size={14} /> 下载原视频</button>
              <button className="flex h-9 items-center gap-2 rounded-md bg-violet-300 px-4 text-sm font-semibold text-[#140d18] hover:bg-violet-200" onClick={() => onOpenVideoExport(videoAsset)}><FileJson size={15} /> 去背景并导出 Lottie</button>
            </div>
          )}
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-5 overflow-y-auto p-6 xl:grid-cols-2">
          <section className="flex min-h-[420px] flex-col rounded-lg border border-white/8 bg-[#0d1112] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div><p className="text-sm font-medium">动画主体与首帧</p><p className="mt-1 text-xs text-neutral-600">{usingUploadedSubject ? '使用你上传的主体素材' : '使用当前道具透明 PNG'}，自动合成到标准绿幕</p></div>
              <span className="rounded bg-[#00ff00]/15 px-2 py-1 text-[10px] text-emerald-300">#00FF00</span>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-[#050705] p-4">
              <div className="aspect-square h-full max-h-[700px] max-w-full overflow-hidden rounded-md border border-emerald-300/25 bg-[#00ff00] shadow-2xl">
                {sourceAsset && <img src={sourceAsset.url} alt={`${activeItem?.name || ''} 动画首帧`} className="h-full w-full object-contain" />}
              </div>
            </div>
          </section>

          <section className="flex min-h-[420px] flex-col rounded-lg border border-white/8 bg-[#0d1112] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div><p className="text-sm font-medium">动画结果</p><p className="mt-1 text-xs text-neutral-600">保留绿幕视频，下一步再逐帧转透明背景</p></div>
              {videoAsset && <span className="flex items-center gap-1.5 text-[11px] text-violet-300"><Check size={12} /> 已保存到仓库</span>}
            </div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md border border-white/8 bg-black">
              {videoAsset ? (
                <video src={videoAsset.url} controls autoPlay loop muted className="h-full w-full object-contain" />
              ) : generating ? (
                <div className="text-center">
                  <LoaderCircle size={34} className="mx-auto animate-spin text-violet-300" />
                  <p className="mt-4 text-sm text-neutral-200">{phase || '正在生成道具动画'}</p>
                  <p className="mt-2 text-xs text-neutral-600">视频模型可能需要数分钟，请保持页面打开</p>
                </div>
              ) : (
                <div className="text-center text-neutral-600"><Play size={34} className="mx-auto" /><p className="mt-3 text-sm">设置动作后开始生成</p></div>
              )}
            </div>
          </section>
        </div>
      </main>

      <aside className="w-[375px] shrink-0 overflow-y-auto border-l border-white/8 bg-[#101314] p-5">
        <div className="flex items-center gap-2"><Clapperboard size={16} className="text-violet-300" /><h3 className="font-medium">动画设置</h3></div>

        <section className="mt-5 rounded-md border border-white/8 bg-black/15 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-medium text-neutral-300">动画主体素材</p>
              <p className="mt-1 text-[10px] text-neutral-600">{usingUploadedSubject ? '当前使用：上传素材' : '当前使用：道具透明图'}</p>
            </div>
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-white/10 bg-[#00ff00]">
              {sourceAsset ? <img src={sourceAsset.thumbnail || sourceAsset.url} alt="动画主体" className="h-full w-full object-contain" /> : <ImagePlus size={18} className="m-[18px] text-neutral-500" />}
            </div>
          </div>
          <button disabled={subjectUploading || generating} className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-md border border-violet-300/25 bg-violet-300/[0.06] text-xs text-violet-200 hover:bg-violet-300/10 disabled:opacity-40" onClick={() => subjectInputRef.current?.click()}>
            {subjectUploading ? <LoaderCircle size={14} className="animate-spin" /> : <Upload size={14} />}
            {subjectUploading ? '正在导入主体' : usingUploadedSubject ? '替换上传主体' : '上传其他主体素材'}
          </button>
          {usingUploadedSubject && (
            <button disabled={generating} className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-md text-xs text-neutral-500 hover:bg-white/[0.03] hover:text-white disabled:opacity-40" onClick={restoreGeneratedSubject}><X size={13} /> 改回当前道具</button>
          )}
          <p className="mt-3 text-[10px] leading-4 text-neutral-600">上传后会直接替换动画主体，但不会覆盖原来的静态道具。推荐透明 PNG；带背景图片会把原背景一起带入首帧。</p>
        </section>

        <section className="mt-4 rounded-md border border-white/8 bg-black/15 p-4">
          <label className="mb-2 block text-xs text-neutral-500">视频模型</label>
          <select className="h-11 w-full rounded-md border border-white/10 bg-[#15191a] px-3 text-sm outline-none focus:border-violet-400/50" value={selectedPreset?.id || videoPresetId} onChange={(event) => chooseVideoPreset(event.target.value)}>
            {videoPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}{preset.recommended ? ' · 推荐' : ''}</option>)}
          </select>
          {selectedPreset?.styleDescription && <p className="mt-2 text-[11px] leading-5 text-neutral-600">{selectedPreset.styleDescription}</p>}
          <button className="mt-3 flex w-full items-center gap-2 border-t border-white/8 pt-3 text-left text-xs text-neutral-400 hover:text-white" onClick={() => setConfigExpanded((current) => !current)}>
            <KeyRound size={13} className="text-violet-300" />
            <span>{modelConfig.apiKey.trim() ? 'API Key 已填写' : '填写 API Key'}</span>
            <span className="ml-auto text-neutral-600">{configExpanded ? '收起' : '展开'}</span>
          </button>
          {configExpanded && (
            <div className="mt-3">
              <input type="password" autoComplete="off" className="h-10 w-full rounded-md border border-white/10 bg-black/30 px-3 text-xs outline-none focus:border-violet-400/50" value={modelConfig.apiKey} onChange={(event) => updateModelConfig({ apiKey: event.target.value })} placeholder="填写你自己的 API Key" />
              <p className="mt-2 text-[10px] leading-4 text-neutral-600">接口地址、模型和轮询参数已随预设保留；Key 只保存在当前浏览器。</p>
            </div>
          )}
        </section>

        <section className="mt-4 rounded-md border border-white/8 bg-black/15 p-4">
          <p className="text-xs font-medium text-neutral-400">快速动作</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {ACTION_PRESETS.map((preset) => <button key={preset.label} className="h-9 rounded-md border border-white/8 text-xs text-neutral-400 hover:border-violet-400/30 hover:text-white" onClick={() => applyActionPreset(preset.text)}>{preset.label}</button>)}
          </div>
        </section>

        <label className="mt-4 block">
          <span className="mb-2 block text-xs font-medium text-neutral-400">动画描述</span>
          <textarea className="h-48 w-full resize-none rounded-md border border-white/10 bg-black/25 p-3 text-xs leading-5 text-neutral-200 outline-none focus:border-violet-400/45" value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        </label>

        <div className="mt-4 rounded-md border border-emerald-400/15 bg-emerald-400/[0.04] p-3 text-[11px] leading-5 text-neutral-500">
          生成时固定使用纯绿幕首帧。进入导出后会自动启用绿幕抠除、700 × 700 画布和 Lottie 输出，你仍可手动微调阈值与去绿边强度。
        </div>
        {errorMessage && <div className="mt-4 rounded-md border border-red-400/20 bg-red-400/8 px-3 py-3 text-xs leading-5 text-red-300">{errorMessage}</div>}

        <button disabled={!activeItem || !sourceAsset || generating} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-md bg-gradient-to-r from-violet-400 to-cyan-400 text-sm font-semibold text-[#0d1012] disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void generateAnimation()}>
          {generating ? <LoaderCircle size={16} className="animate-spin" /> : videoAsset ? <RefreshCw size={16} /> : <Sparkles size={16} />}
          {generating ? phase || '正在生成' : videoAsset ? '重新生成道具动画' : '生成道具动画'}
        </button>
      </aside>
    </div>
  );
};
