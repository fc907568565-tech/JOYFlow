import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Gift,
  History,
  Image as ImageIcon,
  LoaderCircle,
  Package,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { pollTaskUntilDone, submitGenerateTask } from '../ai/client';
import { presetSupportsKind, useModelPresets } from '../ai/presets';
import { DEFAULT_MODEL_CONFIG, type ModelConfig } from '../ai/types';
import { addToLibrary, loadLibrary, type LibraryAsset } from '../utils/assetLibrary';
import { SpecialtyCutoutWorkspace } from './SpecialtyCutoutWorkspace';
import {
  createSpecialtyProject,
  deleteSpecialtyProject,
  loadActiveSpecialtyProject,
  loadSpecialtyProjectHistory,
  saveSpecialtyProject,
  type SpecialtyItem,
  type SpecialtyProject,
} from '../utils/specialtyWorkflow';

const STYLE_REFERENCE_URLS = [
  `${import.meta.env.BASE_URL}specialty-style/style-icons.png`,
  `${import.meta.env.BASE_URL}specialty-style/style-scene.png`,
];

const fileToDataUrl = (file: Blob): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = reject;
  reader.readAsDataURL(file);
});

const materializeReferenceImage = async (source: string): Promise<string> => {
  if (/^data:image\//i.test(source)) return source;
  const response = await fetch(source);
  if (!response.ok) throw new Error(`参考图读取失败 (HTTP ${response.status})`);
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('添加的参考文件不是有效图片');
  return fileToDataUrl(blob);
};

const buildSpecialtyPrompt = (name: string, hasObjectReference: boolean) => `
生成一个独立的中国地方特产游戏道具图标，物品名称为【${name}】。
3D卡通休闲游戏图标，3D哑光质感，卡通渲染，边缘柔和且没有尖锐棱角，统一等距视角，色彩明快高级，高饱和度，造型有张力，Q萌、可爱、精致、圆润、拟物质感，中式国风物件。
图1与图2只用于参考整体3D游戏道具风格、材质、色彩与造型语言，不复制其中的具体物品、文字、界面和场景。${hasObjectReference ? '图3只用于确认该特产的真实外形、结构和关键识别特征，不参考图3的摄影背景与画面风格。' : ''}
画面中只出现一个完整的【${name}】，主体居中，比例清晰，不切边，不添加其他道具，不出现人物、文字、Logo、边框、卡片或装饰图案。纯白色背景，柔和自然光影，正方形构图，方便后续抠图制作透明素材。
`.trim();

const newItem = (name: string): SpecialtyItem => ({
  id: `specialty_item_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  name,
  candidateAssetIds: [],
  status: 'idle',
});

export const SpecialtyWorkspace: React.FC = () => {
  const [project, setProject] = useState<SpecialtyProject>(() => (
    loadActiveSpecialtyProject() || createSpecialtyProject()
  ));
  const [modelConfig, setModelConfig] = useState<ModelConfig>(DEFAULT_MODEL_CONFIG);
  const [nameInput, setNameInput] = useState('');
  const [assetMap, setAssetMap] = useState<Map<string, LibraryAsset>>(new Map());
  const [generating, setGenerating] = useState(false);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<SpecialtyProject[]>(() => loadSpecialtyProjectHistory());
  const referenceInputRef = useRef<HTMLInputElement>(null);
  const styleDataRef = useRef<string[] | null>(null);
  const { allPresets, activePresetId, switchPreset } = useModelPresets(setModelConfig);

  const imagePresets = useMemo(
    () => allPresets.filter((preset) => presetSupportsKind(preset, 'image')),
    [allPresets]
  );

  const finishedCount = project.items.filter((item) => item.status === 'succeeded').length;
  const selectedCount = project.items.filter((item) => item.selectedAssetId).length;
  const allSelected = project.items.length > 0 && selectedCount === project.items.length;

  useEffect(() => {
    let cancelled = false;
    void loadLibrary().then((assets) => {
      if (!cancelled) setAssetMap(new Map(assets.map((asset) => [asset.id, asset])));
    });
    return () => { cancelled = true; };
  }, [project.id]);

  useEffect(() => {
    const desired = imagePresets.find((preset) => preset.id === project.modelPresetId)
      || imagePresets.find((preset) => preset.id === '__doubao_seedream_45__')
      || imagePresets[0];
    if (desired && activePresetId !== desired.id) switchPreset(desired.id);
  }, [activePresetId, imagePresets, project.id, project.modelPresetId, switchPreset]);

  const updateProject = (updater: (current: SpecialtyProject) => SpecialtyProject) => {
    setProject((current) => {
      const next = saveSpecialtyProject(updater(current));
      setHistory(loadSpecialtyProjectHistory());
      return next;
    });
  };

  const updateItem = (itemId: string, updater: (item: SpecialtyItem) => SpecialtyItem) => {
    updateProject((current) => ({
      ...current,
      items: current.items.map((item) => item.id === itemId ? updater(item) : item),
    }));
  };

  const addNames = () => {
    const incoming = nameInput
      .split(/[，,、;；\n]+/)
      .map((name) => name.trim())
      .filter(Boolean);
    if (!incoming.length) return;
    updateProject((current) => {
      const existing = new Set(current.items.map((item) => item.name.toLowerCase()));
      const additions = incoming
        .filter((name) => !existing.has(name.toLowerCase()))
        .map((name) => {
          existing.add(name.toLowerCase());
          return newItem(name);
        });
      return { ...current, items: [...current.items, ...additions] };
    });
    setNameInput('');
  };

  const chooseReference = async (files: FileList | null) => {
    const file = files?.[0];
    const itemId = uploadTargetId;
    if (!file || !itemId) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      const item = project.items.find((entry) => entry.id === itemId);
      if (!item) return;
      const asset = await addToLibrary({
        url: dataUrl,
        type: 'image',
        name: `${item.name} 结构参考`,
        prompt: `${item.name} 特产外形结构参考`,
        thumbnail: dataUrl,
        projectId: project.id,
        workflowId: project.id,
        stage: 'specialty-reference',
        selected: true,
        status: 'reference',
        tags: ['特产道具', '结构参考'],
      });
      setAssetMap((current) => new Map(current).set(asset.id, asset));
      updateItem(itemId, (current) => ({ ...current, referenceAssetId: asset.id }));
    } catch {
      alert('参考图读取失败，请重新选择');
    } finally {
      setUploadTargetId(null);
      if (referenceInputRef.current) referenceInputRef.current.value = '';
    }
  };

  const loadStyleReferences = async () => {
    if (styleDataRef.current) return styleDataRef.current;
    const data = await Promise.all(STYLE_REFERENCE_URLS.map(async (url) => {
      const response = await fetch(url);
      if (!response.ok) throw new Error('固定风格参考图读取失败');
      return fileToDataUrl(await response.blob());
    }));
    styleDataRef.current = data;
    return data;
  };

  const generateItem = async (
    item: SpecialtyItem,
    config: ModelConfig,
    styleReferences: string[],
    candidateCount: number
  ) => {
    updateItem(item.id, (current) => ({
      ...current,
      status: 'running',
      errorMessage: undefined,
      candidateAssetIds: [],
      selectedAssetId: undefined,
      outputAssetId: undefined,
      cutoutSettings: undefined,
    }));
    try {
      const objectReferenceUrl = item.referenceAssetId ? assetMap.get(item.referenceAssetId)?.url : undefined;
      const objectReference = objectReferenceUrl
        ? await materializeReferenceImage(objectReferenceUrl)
        : undefined;
      const referenceImages = [...styleReferences, ...(objectReference ? [objectReference] : [])];
      const candidateAssetIds: string[] = [];
      const addedAssets: LibraryAsset[] = [];
      for (let index = 0; index < candidateCount; index += 1) {
        const first = await submitGenerateTask(config, {
          kind: 'image',
          imageMode: 'image2image',
          prompt: buildSpecialtyPrompt(item.name, Boolean(objectReference)),
          size: '2K',
          ratio: '1:1',
          numImages: 1,
          referenceImages,
        });
        const result = first.taskId && first.status !== 'succeeded' && config.taskStatusPath
          ? await pollTaskUntilDone(config, first.taskId)
          : first;
        if (result.status === 'failed' || result.urls.length === 0) {
          throw new Error(result.errorMessage || '模型未返回图片');
        }
        for (const url of result.urls.slice(0, 1)) {
          const asset = await addToLibrary({
            url,
            type: 'image',
            name: `${item.name} 候选 ${candidateAssetIds.length + 1}`,
            prompt: buildSpecialtyPrompt(item.name, Boolean(objectReference)),
            thumbnail: url,
            projectId: project.id,
            workflowId: project.id,
            stage: 'specialty-candidate',
            parentAssetId: item.referenceAssetId,
            model: config.model,
            generationParams: { size: '2K', ratio: '1:1', itemName: item.name },
            selected: false,
            status: 'candidate',
            tags: ['特产道具', item.name, '待抠图'],
          });
          candidateAssetIds.push(asset.id);
          addedAssets.push(asset);
        }
      }
      setAssetMap((current) => {
        const next = new Map(current);
        addedAssets.forEach((asset) => next.set(asset.id, asset));
        return next;
      });
      updateItem(item.id, (current) => ({
        ...current,
        status: 'succeeded',
        candidateAssetIds,
        selectedAssetId: candidateAssetIds.length === 1 ? candidateAssetIds[0] : undefined,
        outputAssetId: undefined,
        cutoutSettings: undefined,
      }));
    } catch (error: any) {
      updateItem(item.id, (current) => ({
        ...current,
        status: 'failed',
        errorMessage: error?.message || '生成失败',
      }));
    }
  };

  const generateAll = async (onlyItem?: SpecialtyItem) => {
    const queue = onlyItem ? [onlyItem] : project.items;
    if (!queue.length || generating) return;
    const preset = imagePresets.find((item) => item.id === project.modelPresetId);
    const config = preset?.config || modelConfig;
    setGenerating(true);
    try {
      const styleReferences = await loadStyleReferences();
      let cursor = 0;
      const worker = async () => {
        while (cursor < queue.length) {
          const item = queue[cursor];
          cursor += 1;
          await generateItem(item, config, styleReferences, project.candidateCount);
        }
      };
      await Promise.all(Array.from({ length: Math.min(2, queue.length) }, () => worker()));
    } catch (error: any) {
      alert(error?.message || '批量生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const startNewProject = () => {
    if (project.items.length && !confirm('新建任务会保留当前任务到历史记录，是否继续？')) return;
    const next = createSpecialtyProject();
    setProject(next);
    setNameInput('');
    setHistory(loadSpecialtyProjectHistory());
  };

  const resumeProject = (saved: SpecialtyProject) => {
    const next = saveSpecialtyProject(saved);
    setProject(next);
    setHistoryOpen(false);
  };

  const removeHistoryProject = (saved: SpecialtyProject) => {
    if (!confirm(`确定删除任务“${saved.name}”吗？\n素材仓库中的图片会保留。`)) return;
    const deletedActive = deleteSpecialtyProject(saved.id);
    if (deletedActive) setProject(createSpecialtyProject());
    setHistory(loadSpecialtyProjectHistory());
  };

  if ((project.stage || 'generate') === 'cutout') {
    return (
      <SpecialtyCutoutWorkspace
        project={project}
        onProjectChange={(next) => {
          const saved = saveSpecialtyProject(next);
          setProject(saved);
          setHistory(loadSpecialtyProjectHistory());
        }}
        onBack={() => updateProject((current) => ({ ...current, stage: 'generate' }))}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 bg-[#090b0c] text-white">
      <input
        ref={referenceInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => void chooseReference(event.target.files)}
      />

      <aside className="flex w-[390px] shrink-0 flex-col border-r border-white/8 bg-[#0d1010]">
        <div className="border-b border-white/8 px-6 py-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase text-emerald-300">Specialty Props</p>
              <h2 className="mt-1 text-xl font-semibold">特产道具生产</h2>
            </div>
            <div className="flex gap-2">
              <button className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-neutral-400 hover:text-white" title="历史任务" onClick={() => { setHistory(loadSpecialtyProjectHistory()); setHistoryOpen(true); }}><History size={15} /></button>
              <button className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-neutral-400 hover:text-white" title="新建任务" onClick={startNewProject}><Plus size={16} /></button>
            </div>
          </div>
          <input
            className="mt-4 h-10 w-full border-b border-white/10 bg-transparent text-sm text-neutral-200 outline-none focus:border-emerald-400/60"
            value={project.name}
            onChange={(event) => updateProject((current) => ({ ...current, name: event.target.value }))}
          />
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-neutral-200">生成模型</label>
              <span className="text-[11px] text-neutral-600">仅显示图片模型</span>
            </div>
            <select
              className="h-11 w-full rounded-md border border-white/10 bg-[#15191a] px-3 text-sm outline-none focus:border-emerald-400/50"
              value={project.modelPresetId}
              onChange={(event) => {
                switchPreset(event.target.value);
                updateProject((current) => ({ ...current, modelPresetId: event.target.value }));
              }}
            >
              {imagePresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </select>
            <p className="mt-2 text-xs leading-5 text-neutral-600">推荐 Seedream 4.5；切换模型不会清空道具清单与已有结果。</p>
          </section>

          <section>
            <div className="mb-3 flex items-center justify-between">
              <label className="text-sm font-medium text-neutral-200">固定风格参考</label>
              <span className="text-[11px] text-emerald-300">已自动应用 2 张</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {STYLE_REFERENCE_URLS.map((url, index) => (
                <div key={url} className="relative aspect-[4/3] overflow-hidden rounded-md border border-white/10 bg-black">
                  <img src={url} alt={`固定风格参考 ${index + 1}`} className="h-full w-full object-cover" />
                  <span className="absolute bottom-1.5 left-1.5 rounded bg-black/70 px-2 py-1 text-[10px]">风格 {index + 1}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <label className="mb-2 block text-sm font-medium text-neutral-200">特产道具名称</label>
            <div className="flex gap-2">
              <input
                className="h-11 min-w-0 flex-1 rounded-md border border-white/10 bg-[#15191a] px-3 text-sm outline-none focus:border-emerald-400/50"
                value={nameInput}
                placeholder="输入一个或多个名称"
                onChange={(event) => setNameInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') { event.preventDefault(); addNames(); }
                }}
              />
              <button className="flex h-11 w-11 items-center justify-center rounded-md bg-white text-black hover:bg-neutral-200" title="添加道具" onClick={addNames}><Plus size={17} /></button>
            </div>
            <p className="mt-2 text-xs leading-5 text-neutral-600">支持逗号、顿号或换行批量添加。完整关键词模板由系统自动拼接。</p>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-medium text-neutral-200">每项候选</label>
              <span className="text-[11px] text-neutral-600">候选越多耗时越长</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[1, 2].map((count) => (
                <button key={count} className={`h-10 rounded-md border text-sm ${project.candidateCount === count ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200' : 'border-white/10 text-neutral-400 hover:text-white'}`} onClick={() => updateProject((current) => ({ ...current, candidateCount: count }))}>{count} 个版本</button>
              ))}
            </div>
          </section>
        </div>

        <div className="border-t border-white/8 p-5">
          <button disabled={generating || project.items.length === 0} className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-gradient-to-r from-emerald-400 to-cyan-500 text-sm font-semibold text-[#071312] disabled:cursor-not-allowed disabled:opacity-40" onClick={() => void generateAll()}>
            {generating ? <LoaderCircle size={17} className="animate-spin" /> : <Sparkles size={17} />}
            {generating ? '正在批量生成' : `生成整组道具 ${project.items.length ? `(${project.items.length})` : ''}`}
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/8 px-6">
          <div>
            <p className="text-sm font-medium">01 道具清单与批量生成</p>
            <p className="mt-1 text-xs text-neutral-600">每个名称独立生成，避免物品混合和后续拆分失败</p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-neutral-500">共 {project.items.length}</span>
            <span className="text-emerald-300">完成 {finishedCount}</span>
            <span className="text-cyan-300">选定 {selectedCount}</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {project.items.length === 0 ? (
            <div className="flex min-h-[520px] flex-col items-center justify-center rounded-lg border border-dashed border-white/10 text-neutral-600">
              <Gift size={42} />
              <p className="mt-4 text-base text-neutral-300">先添加需要生产的特产道具</p>
              <p className="mt-2 text-sm">例如：京八件、蝴蝶酥、雪花膏、醒狮钥匙扣</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 2xl:grid-cols-3">
              {project.items.map((item) => {
                const reference = item.referenceAssetId ? assetMap.get(item.referenceAssetId) : undefined;
                const candidates = item.candidateAssetIds.map((id) => assetMap.get(id)).filter(Boolean) as LibraryAsset[];
                return (
                  <article key={item.id} className="overflow-hidden rounded-lg border border-white/10 bg-[#101415]">
                    <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-semibold">{item.name}</h3>
                        <p className="mt-1 text-[11px] text-neutral-600">{reference ? '已附加结构参考图' : '使用固定风格参考'}</p>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          className={`flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs ${reference ? 'border-emerald-400/30 text-emerald-300' : 'border-white/10 text-neutral-500 hover:text-white'}`}
                          disabled={generating}
                          onClick={() => { setUploadTargetId(item.id); referenceInputRef.current?.click(); }}
                        >
                          <Upload size={12} /> {reference ? '更换参考' : '添加参考'}
                        </button>
                        <button className="flex h-8 w-8 items-center justify-center rounded-md border border-white/10 text-neutral-600 hover:text-red-300" title="移除道具" disabled={generating} onClick={() => updateProject((current) => ({ ...current, items: current.items.filter((entry) => entry.id !== item.id) }))}><X size={14} /></button>
                      </div>
                    </div>

                    <div className="p-4">
                      {item.status === 'running' ? (
                        <div className="flex min-h-64 flex-col items-center justify-center rounded-md bg-black/30 text-neutral-500">
                          <LoaderCircle size={24} className="animate-spin text-emerald-300" />
                          <p className="mt-3 text-sm">正在生成 {item.name}</p>
                        </div>
                      ) : candidates.length ? (
                        <div className={`grid gap-3 ${candidates.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                          {candidates.map((asset) => {
                            const selected = item.selectedAssetId === asset.id;
                            return (
                              <button key={asset.id} className={`relative aspect-square overflow-hidden rounded-md border bg-white ${selected ? 'border-emerald-400 ring-2 ring-emerald-400/25' : 'border-white/10 hover:border-white/30'}`} onClick={() => updateItem(item.id, (current) => ({ ...current, selectedAssetId: asset.id, outputAssetId: undefined, cutoutSettings: undefined }))}>
                                <img src={asset.url} alt={`${item.name} 候选`} className="h-full w-full object-contain" />
                                <span className={`absolute bottom-2 right-2 flex h-7 items-center gap-1 rounded-md px-2 text-[11px] ${selected ? 'bg-emerald-400 text-black' : 'bg-black/70 text-white'}`}>{selected && <Check size={12} />}{selected ? '已选用' : '选择'}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex min-h-64 flex-col items-center justify-center rounded-md border border-dashed border-white/8 bg-black/20 text-neutral-600">
                          {reference ? <img src={reference.url} alt={`${item.name} 结构参考`} className="mb-3 h-28 w-28 rounded-md object-contain" /> : <ImageIcon size={28} />}
                          <p className="mt-2 text-sm">等待生成</p>
                        </div>
                      )}

                      {item.status === 'failed' && <p className="mt-3 rounded-md bg-red-500/8 px-3 py-2 text-xs text-red-300">{item.errorMessage || '生成失败'}</p>}
                      <div className="mt-3 flex items-center justify-between">
                        <span className="flex items-center gap-1.5 text-[11px] text-neutral-600"><Package size={12} /> 候选结果自动保存在仓库</span>
                        <button disabled={generating} className="flex h-8 items-center gap-1.5 rounded-md border border-white/10 px-3 text-xs text-neutral-400 hover:text-white disabled:opacity-40" onClick={() => void generateAll(item)}><RefreshCw size={12} /> {candidates.length ? '重新生成' : '单独生成'}</button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex h-16 shrink-0 items-center justify-between border-t border-white/8 bg-[#0d1010] px-6">
          <p className="text-xs text-neutral-600">所有结果保留原始分辨率；抠图时再统一规范为透明背景 700 × 700 px。</p>
          <button
            disabled={!allSelected}
            className="flex h-10 items-center gap-2 rounded-md bg-cyan-400 px-5 text-sm font-semibold text-[#061315] disabled:bg-transparent disabled:text-neutral-500 disabled:ring-1 disabled:ring-white/10 disabled:opacity-35"
            onClick={() => updateProject((current) => ({ ...current, stage: 'cutout' }))}
          >
            {allSelected ? <Check size={15} /> : <LoaderCircle size={15} />} {allSelected ? '进入抠图与 700 × 700 规范' : `还需选择 ${project.items.length - selectedCount} 项`}
          </button>
        </div>
      </main>

      {historyOpen && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm" onClick={() => setHistoryOpen(false)}>
          <div className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-white/12 bg-[#101314]" onClick={(event) => event.stopPropagation()}>
            <div className="flex h-16 items-center justify-between border-b border-white/8 px-5">
              <div><h3 className="text-lg font-semibold">特产道具历史任务</h3><p className="mt-1 text-xs text-neutral-600">候选图片保存在素材仓库，删除任务不会删除素材</p></div>
              <button className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-neutral-400" onClick={() => setHistoryOpen(false)}><X size={16} /></button>
            </div>
            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-5">
              {history.map((saved) => (
                <div key={saved.id} className={`flex items-center gap-4 rounded-md border p-4 ${saved.id === project.id ? 'border-emerald-400/35 bg-emerald-400/[0.05]' : 'border-white/8'}`}>
                  <button className="min-w-0 flex-1 text-left" onClick={() => resumeProject(saved)}>
                    <p className="truncate text-sm font-medium">{saved.name}</p>
                    <p className="mt-1 text-xs text-neutral-600">{saved.items.length} 项 · 已选定 {saved.items.filter((item) => item.selectedAssetId).length} 项 · {new Date(saved.updatedAt).toLocaleString()}</p>
                  </button>
                  <button className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 text-neutral-500 hover:border-red-400/30 hover:text-red-300" title="删除任务" onClick={() => removeHistoryProject(saved)}><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
