import React from 'react';
import {
  Eye, EyeOff, Trash2, Plus, Copy, Film, Layers,
  ChevronsUp, ChevronsDown, Upload,
} from 'lucide-react';
import type { ImageAsset } from '../types';
import type { T } from '../i18n';

interface LayerPanelProps {
  t: T;
  lang: 'zh' | 'en';
  assets: ImageAsset[];
  setAssets: (next: ImageAsset[]) => void;
  selectedAssetId: string | null;
  setSelectedAssetId: (id: string | null) => void;
  onAssetUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenLibrary?: () => void;
}

export const LayerPanel: React.FC<LayerPanelProps> = (p) => {
  const { t, lang, assets } = p;

  const updateAsset = (id: string, mut: (a: ImageAsset) => ImageAsset) => {
    p.setAssets(assets.map((a) => (a.id === id ? mut(a) : a)));
  };

  return (
    <aside className="w-[220px] shrink-0 h-full border-r border-[var(--border-soft)] bg-[var(--bg-elev)]/40 backdrop-blur-md flex flex-col">
      {/* Header */}
      <div className="px-3 py-3 border-b border-[var(--border-soft)] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Layers size={14} className="text-[var(--primary)]" />
          <span className="text-xs font-bold tracking-wide">{lang === 'zh' ? '图层' : 'Layers'}</span>
          {assets.length > 0 && (
            <span className="text-[10px] text-neutral-500 font-mono">{assets.length}</span>
          )}
        </div>
        <button
          className="cursor-pointer text-neutral-400 hover:text-[var(--primary)] transition-colors p-1"
          title={lang === 'zh' ? '添加素材' : 'Add asset'}
          onClick={() => p.onOpenLibrary ? p.onOpenLibrary() : undefined}
        >
          <Plus size={14} />
        </button>
      </div>

      {/* Layer list */}
      <div className="flex-1 overflow-y-auto scroll-area">
        {assets.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-neutral-600 px-4">
            <Upload size={20} />
            <p className="text-[11px] text-center">{t.noAssets}</p>
          </div>
        ) : (
          <div className="py-1">
            {assets.map((a, idx) => {
              const sel = a.id === p.selectedAssetId;
              const total = assets.length;
              return (
                <div
                  key={a.id}
                  onClick={() => p.setSelectedAssetId(a.id)}
                  className={`group flex items-center gap-1.5 px-2 py-1.5 cursor-pointer transition-colors border-l-2 ${
                    sel ? 'border-[var(--primary)] bg-[var(--primary)]/8' : 'border-transparent hover:bg-white/[0.03]'
                  }`}
                >
                  {/* 缩略图 */}
                  <img src={a.src} alt={a.name} className="w-6 h-6 object-contain rounded shrink-0" draggable={false} />

                  {/* 名称 + 层级标签 */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-neutral-200 truncate leading-tight">{a.name}</p>
                    <p className="text-[9px] text-neutral-600 leading-tight">
                      {a.zBelowVideo ? (lang === 'zh' ? '视频下' : 'Below') : (lang === 'zh' ? '视频上' : 'Above')}
                    </p>
                  </div>

                  {/* 操作按钮 - hover 显示 */}
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button
                      onClick={(e) => { e.stopPropagation(); if (idx > 0) { const n = [...assets]; [n[idx-1], n[idx]] = [n[idx], n[idx-1]]; p.setAssets(n); } }}
                      disabled={idx === 0}
                      className="text-neutral-500 hover:text-neutral-100 p-0.5 disabled:opacity-20"
                      title={lang === 'zh' ? '上移' : 'Up'}
                    >
                      <ChevronsUp size={11} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); if (idx < total - 1) { const n = [...assets]; [n[idx+1], n[idx]] = [n[idx], n[idx+1]]; p.setAssets(n); } }}
                      disabled={idx === total - 1}
                      className="text-neutral-500 hover:text-neutral-100 p-0.5 disabled:opacity-20"
                      title={lang === 'zh' ? '下移' : 'Down'}
                    >
                      <ChevronsDown size={11} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); updateAsset(a.id, (x) => ({ ...x, zBelowVideo: !x.zBelowVideo })); }}
                      className={`p-0.5 ${a.zBelowVideo ? 'text-orange-400' : 'text-blue-400'}`}
                      title={a.zBelowVideo ? (lang === 'zh' ? '移到视频上' : 'Above video') : (lang === 'zh' ? '移到视频下' : 'Below video')}
                    >
                      <Film size={11} />
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); updateAsset(a.id, (x) => ({ ...x, visible: !x.visible })); }}
                      className="text-neutral-500 hover:text-neutral-200 p-0.5"
                    >
                      {a.visible ? <Eye size={11} /> : <EyeOff size={11} />}
                    </button>
                  </div>

                  {/* 可见性常驻指示 */}
                  {!a.visible && (
                    <EyeOff size={10} className="text-neutral-700 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 底部操作 */}
      {p.selectedAssetId && (
        <div className="px-2 py-2 border-t border-[var(--border-soft)] flex items-center gap-1 shrink-0">
          <button
            onClick={() => {
              const a = assets.find(x => x.id === p.selectedAssetId);
              if (!a) return;
              const dup: ImageAsset = { ...a, id: `asset_${Date.now()}`, name: a.name + ' copy', keyframes: {
                x: a.keyframes.x.map(k => ({...k})), y: a.keyframes.y.map(k => ({...k})),
                scale: a.keyframes.scale.map(k => ({...k})), rotation: a.keyframes.rotation.map(k => ({...k})),
                opacity: a.keyframes.opacity.map(k => ({...k})),
              }};
              p.setAssets([...assets, dup]);
            }}
            className="btn-ghost !py-1 !px-2 text-[10px]"
          >
            <Copy size={11} /> {lang === 'zh' ? '复制' : 'Dup'}
          </button>
          <button
            onClick={() => {
              p.setAssets(assets.filter(x => x.id !== p.selectedAssetId));
              p.setSelectedAssetId(null);
            }}
            className="btn-ghost !py-1 !px-2 text-[10px] hover:!text-red-400"
          >
            <Trash2 size={11} /> {lang === 'zh' ? '删除' : 'Del'}
          </button>
        </div>
      )}
    </aside>
  );
};