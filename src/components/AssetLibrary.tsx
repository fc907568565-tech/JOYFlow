import React, { useState, useEffect, useRef } from 'react';
import { Package, Trash2, X, Image as ImageIcon, Film, Search, Upload, Maximize2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { loadLibrary, removeFromLibrary, clearLibrary, type LibraryAsset } from '../utils/assetLibrary';

interface AssetLibraryProps {
  open: boolean;
  onClose: () => void;
  onSelectAsset?: (asset: LibraryAsset) => void;
  title?: string;
  layerClassName?: string;
  /** 本地上传回调�如果提供则在仓库面板中显示上传按钮（用于叠加素材） */
  onLocalUpload?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** 上传"素材源"专用回调，如视频模式下上传本地视频作为源；提供则显示单独按钮 */
  onSourceUpload?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** 素材源上传接受的类型，默认 video/* */
  sourceUploadAccept?: string;
  /** 打开时默认过滤类型 */
  defaultFilter?: 'all' | 'image' | 'video';
}

const isVideoUrl = (url: string) => /\.(mp4|webm|mov)(\?|$)/i.test(url);

export const AssetLibrary: React.FC<AssetLibraryProps> = ({ open, onClose, onSelectAsset, title = '素材仓库', layerClassName = 'z-[100]', onLocalUpload, onSourceUpload, sourceUploadAccept, defaultFilter }) => {
  const [assets, setAssets] = useState<LibraryAsset[]>([]);
  const [filter, setFilter] = useState<'all' | 'image' | 'video'>(defaultFilter || 'all');
  const [searchText, setSearchText] = useState('');
  const [previewAsset, setPreviewAsset] = useState<LibraryAsset | null>(null);
  const localFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    if (open) {
      void loadLibrary().then((items) => {
        if (!cancelled) setAssets(items);
      });
      if (defaultFilter) setFilter(defaultFilter);
    } else {
      setPreviewAsset(null);
    }
    return () => { cancelled = true; };
  }, [open, defaultFilter]);

  useEffect(() => {
    if (!previewAsset) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewAsset(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewAsset]);

  const filteredAssets = assets.filter((a) => {
    if (filter !== 'all' && a.type !== filter) return false;
    if (searchText && !a.prompt.toLowerCase().includes(searchText.toLowerCase())) return false;
    return true;
  });

  const handleDelete = async (id: string) => {
    await removeFromLibrary(id);
    setAssets((prev) => prev.filter((a) => a.id !== id));
  };

  const handleClear = async () => {
    if (!confirm('确定清空所有素材？此操作不可撤销。')) return;
    await clearLibrary();
    setAssets([]);
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className={`fixed inset-0 ${layerClassName} flex items-center justify-center`}
      >
        {/* 背景蒙层 */}
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

        {/* 面板 */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="relative w-[800px] max-w-[90vw] h-[600px] max-h-[80vh] bg-[var(--bg-main)] border border-[var(--border-soft)] rounded-2xl flex flex-col overflow-hidden shadow-2xl"
        >
          {/* 头部 */}
          <div className="px-5 py-4 border-b border-[var(--border-soft)] flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2.5">
              <Package size={18} className="text-[var(--primary)]" />
              <h2 className="text-sm font-bold">{title}</h2>
              <span className="text-[10px] text-neutral-500 ml-2">{assets.length} 个素材</span>
            </div>
            <div className="flex items-center gap-2">
              {onLocalUpload && (
              <label className="flex items-center gap-1 text-[10px] text-[var(--primary)] hover:text-[var(--primary)]/80 cursor-pointer transition-colors">
                <Upload size={12} />
                上传本地
                <input
                  ref={localFileRef}
                  type="file"
                  className="hidden"
                  accept="image/png,image/jpeg,image/webp,video/mp4,video/webm"
                  multiple
                  onChange={(e) => {
                    onLocalUpload(e);
                    onClose();
                  }}
                />
              </label>
              )}
              {onSourceUpload && (
                <label className="flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300 cursor-pointer transition-colors">
                  <Upload size={12} />
                  上传本地作为源
                  <input
                    type="file"
                    className="hidden"
                    accept={sourceUploadAccept || 'video/*'}
                    onChange={(e) => {
                      onSourceUpload(e);
                      onClose();
                    }}
                  />
                </label>
              )}
              {assets.length > 0 && (
                <button className="text-[10px] text-red-400 hover:text-red-300 transition-colors" onClick={handleClear}>清空全部</button>
              )}
              <button className="p-1.5 rounded-lg hover:bg-neutral-800 transition-colors" onClick={onClose}>
                <X size={16} className="text-neutral-400" />
              </button>
            </div>
          </div>

          {/* 工具栏 */}
          <div className="px-5 py-3 border-b border-[var(--border-soft)] flex items-center gap-3 shrink-0">
            <div className="flex gap-1.5">
              {([['all', '全部'], ['image', '图片'], ['video', '视频']] as const).map(([key, label]) => (
                <button
                  key={key}
                  className={`px-2.5 py-1 rounded text-[10px] font-medium border transition-all ${filter === key ? 'bg-[var(--primary)]/20 border-[var(--primary)]/50 text-[var(--primary)]' : 'border-neutral-700 text-neutral-500 hover:text-neutral-300'}`}
                  onClick={() => setFilter(key)}
                >
                  {key === 'image' && <ImageIcon size={10} className="inline mr-1" />}
                  {key === 'video' && <Film size={10} className="inline mr-1" />}
                  {label}
                </button>
              ))}
            </div>
            <div className="flex-1 flex items-center gap-1.5 panel-sub px-2.5 py-1.5 rounded-lg">
              <Search size={12} className="text-neutral-500" />
              <input
                className="flex-1 bg-transparent text-xs outline-none placeholder:text-neutral-600"
                placeholder="搜索描述..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
              />
            </div>
          </div>

          {/* 内容区 */}
          <div className="flex-1 min-h-0 overflow-y-auto scroll-area p-5">
            {filteredAssets.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center gap-3 text-neutral-500">
                <Package size={36} className="text-neutral-700" />
                <p className="text-xs">{assets.length === 0 ? '仓库为空，生成素材后可存入仓库' : '没有匹配的素材'}</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                {filteredAssets.map((asset) => (
                  <motion.div key={asset.id} layout className="relative group rounded-xl overflow-hidden bg-neutral-900 border border-neutral-800 hover:border-[var(--primary)]/50 transition-colors cursor-pointer" onClick={() => onSelectAsset?.(asset)}>
                    <div className="aspect-video w-full flex items-center justify-center bg-neutral-900/80">
                      {asset.type === 'video' || isVideoUrl(asset.url) ? (
                        <video src={asset.url} className="w-full h-full object-cover" muted preload="metadata" />
                      ) : (
                        <img src={asset.thumbnail || asset.url} alt="" className="w-full h-full object-cover" />
                      )}
                    </div>
                    <div className="p-2.5">
                      <p className="text-[10px] text-neutral-400 line-clamp-2 leading-relaxed">{asset.prompt || '无描述'}</p>
                      {(asset.width || asset.height || asset.fileSize) && (
                        <p className="text-[9px] text-neutral-500 mt-1">
                          {asset.width && asset.height ? `${asset.width} x ${asset.height}` : ''}
                          {asset.fileSize ? `${asset.width && asset.height ? ' · ' : ''}${(asset.fileSize / 1024 / 1024).toFixed(1)} MB` : ''}
                        </p>
                      )}
                      <div className="mt-1 flex items-center justify-between gap-2 text-[9px] text-neutral-600">
                        <span>{new Date(asset.createdAt).toLocaleDateString()}</span>
                        <span>{asset.storageMode === 'remote' ? '远程引用' : '已缓存原文件'}</span>
                      </div>
                    </div>
                    {/* 删除按钮 */}
                    <button
                      type="button"
                      className="absolute top-2 right-9 p-1.5 rounded-full bg-black/65 hover:bg-[var(--primary)] transition-colors"
                      title="放大预览"
                      aria-label="放大预览"
                      onClick={(e) => { e.stopPropagation(); setPreviewAsset(asset); }}
                    >
                      <Maximize2 size={11} className="text-white" />
                    </button>
                    <button
                      className="absolute top-2 right-2 p-1.5 rounded-full bg-black/60 opacity-0 group-hover:opacity-100 hover:bg-red-500/80 transition-all"
                      onClick={(e) => { e.stopPropagation(); handleDelete(asset.id); }}
                    >
                      <Trash2 size={11} className="text-white" />
                    </button>
                    {/* 类型标签 */}
                    <div className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[9px] bg-black/60 text-neutral-300">
                      {asset.type === 'video' ? '视频' : '图片'}
                    </div>
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        </motion.div>

        <AnimatePresence>
          {previewAsset && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-20 flex items-center justify-center bg-black/90 backdrop-blur-md p-6"
              onClick={() => setPreviewAsset(null)}
            >
              <button
                type="button"
                className="absolute top-5 right-5 p-2 rounded-lg border border-white/15 bg-black/60 text-neutral-300 hover:text-white hover:bg-white/10 transition-colors"
                title="关闭预览"
                aria-label="关闭预览"
                onClick={() => setPreviewAsset(null)}
              >
                <X size={18} />
              </button>
              <motion.div
                initial={{ scale: 0.96, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.96, opacity: 0 }}
                className="max-w-[92vw] max-h-[88vh] flex flex-col items-center gap-3"
                onClick={(event) => event.stopPropagation()}
              >
                {previewAsset.type === 'video' || isVideoUrl(previewAsset.url) ? (
                  <video src={previewAsset.url} controls autoPlay className="max-w-full max-h-[78vh] object-contain rounded-lg bg-black" />
                ) : (
                  <img src={previewAsset.url} alt={previewAsset.prompt || '素材预览'} className="max-w-full max-h-[78vh] object-contain rounded-lg" />
                )}
                <div className="max-w-3xl text-center">
                  <p className="text-xs text-neutral-300 line-clamp-2">{previewAsset.prompt || '无描述'}</p>
                  <p className="text-[10px] text-neutral-600 mt-1">点击空白区域或按 Esc 关闭</p>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  );
};
