import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BrainCircuit, Layers3 } from 'lucide-react';

import type { SemanticLayerObject } from '../utils/semanticLayerSegmentation';

interface SemanticLayerEditorProps {
  sourceUrl: string | null;
  resultUrl: string | null;
  objects: SemanticLayerObject[];
  disabled?: boolean;
  progress?: number;
  progressLabel?: string;
}

interface FittedImageRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const checkerboard = 'bg-[linear-gradient(45deg,#151b26_25%,transparent_25%),linear-gradient(-45deg,#151b26_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#151b26_75%),linear-gradient(-45deg,transparent_75%,#151b26_75%)] [background-position:0_0,0_14px,14px_-14px,-14px_0] [background-size:28px_28px]';
const categoryStyle = {
  subject: 'border-cyan-300 bg-cyan-300/12 text-cyan-100',
  stage: 'border-emerald-300 bg-emerald-300/12 text-emerald-100',
  prop: 'border-amber-300 bg-amber-300/12 text-amber-100',
} as const;

export const SemanticLayerEditor: React.FC<SemanticLayerEditorProps> = ({
  sourceUrl,
  resultUrl,
  objects,
  disabled = false,
  progress = 0,
  progressLabel = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const [containerSize, setContainerSize] = useState({ width: 1, height: 1 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => setContainerSize({ width: container.clientWidth || 1, height: container.clientHeight || 1 });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const imageRect = useMemo<FittedImageRect>(() => {
    const scale = Math.min(containerSize.width / imageSize.width, containerSize.height / imageSize.height);
    const width = imageSize.width * scale;
    const height = imageSize.height * scale;
    return {
      left: (containerSize.width - width) / 2,
      top: (containerSize.height - height) / 2,
      width,
      height,
    };
  }, [containerSize, imageSize]);

  return (
    <div className="grid min-h-0 flex-1 grid-cols-2 gap-4">
      <div className="flex min-h-0 flex-col">
        <div className="mb-2 flex items-center justify-between gap-2 text-xs font-medium text-neutral-400">
          <span className="flex items-center gap-2"><BrainCircuit size={13} /> AI 自动识别关联对象</span>
          <span className="font-mono text-neutral-600">{objects.length} 个画面层</span>
        </div>
        <div ref={containerRef} className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-[#070b11]">
          {sourceUrl ? (
            <img
              src={sourceUrl}
              alt="AI 语义分层原图"
              draggable={false}
              onLoad={(event) => setImageSize({ width: event.currentTarget.naturalWidth || 1, height: event.currentTarget.naturalHeight || 1 })}
              className="pointer-events-none h-full w-full select-none object-contain"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-neutral-600">正在准备原始素材...</div>
          )}
          {objects.map((object) => {
            const [x1, y1, x2, y2] = object.box;
            return (
              <span
                key={object.id}
                title={object.reason || object.name}
                className={`pointer-events-none absolute z-10 rounded-md border-2 shadow-[0_0_0_1px_rgba(0,0,0,.45)] ${categoryStyle[object.category]}`}
                style={{
                  left: imageRect.left + x1 * imageRect.width,
                  top: imageRect.top + y1 * imageRect.height,
                  width: (x2 - x1) * imageRect.width,
                  height: (y2 - y1) * imageRect.height,
                }}
              >
                <small className="absolute -top-6 left-0 whitespace-nowrap rounded bg-[#080c12]/90 px-1.5 py-1 text-[9px] font-semibold backdrop-blur">{object.name}</small>
              </span>
            );
          })}
          {disabled && (
            <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#070b11]/78 px-8 text-center backdrop-blur-sm">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-400/15 text-violet-200"><BrainCircuit size={21} className="animate-pulse" /></span>
              <strong className="mt-4 text-sm font-semibold text-white">{progressLabel || '正在理解主体、小舞台与道具'}</strong>
              <p className="mt-2 text-xs text-neutral-500">{progress}%</p>
              <div className="mt-4 h-1.5 w-48 overflow-hidden rounded-full bg-white/8">
                <div className="h-full rounded-full bg-gradient-to-r from-violet-400 to-cyan-400 transition-[width] duration-300" style={{ width: `${progress}%` }} />
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="flex min-h-0 flex-col">
        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-violet-200"><Layers3 size={13} /> 关联对象合并结果</div>
        <div className={`relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-violet-300/15 ${checkerboard}`}>
          {resultUrl ? (
            <img src={resultUrl} alt="AI 语义分层透明结果" className="h-full w-full object-contain" />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/8 text-neutral-500"><Layers3 size={20} /></span>
              <strong className="mt-4 text-sm font-medium text-neutral-400">等待 AI 自动分层</strong>
              <p className="mt-2 max-w-[270px] text-xs leading-5 text-neutral-600">AI 会自动保留核心主体、承载舞台和主题相关道具，排除背景板、文字和水印。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

