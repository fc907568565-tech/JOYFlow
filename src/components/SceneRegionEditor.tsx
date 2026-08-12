import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Brush,
  Eraser,
  Focus,
  RotateCcw,
  ScanSearch,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export interface SceneEditRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
}

interface SceneRegionEditorProps {
  sourceUrl: string;
  selectionEnabled?: boolean;
  onSelectionChange: (maskDataUrl: string, region: SceneEditRegion | null) => void;
}

type PaintTool = 'brush' | 'eraser';

const makeEditMask = (
  source: ImageData,
  width: number,
  height: number,
): { dataUrl: string; region: SceneEditRegion | null } => {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  const outputCanvas = document.createElement('canvas');
  outputCanvas.width = width;
  outputCanvas.height = height;
  const outputContext = outputCanvas.getContext('2d');
  if (!outputContext) return { dataUrl: '', region: null };

  const output = outputContext.createImageData(width, height);
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const offset = pixel * 4;
    const selected = source.data[offset + 3] > 8;
    output.data[offset] = 0;
    output.data[offset + 1] = 0;
    output.data[offset + 2] = 0;
    output.data[offset + 3] = selected ? 0 : 255;
    if (!selected) continue;
    const x = pixel % width;
    const y = Math.floor(pixel / width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }

  if (maxX < minX || maxY < minY) return { dataUrl: '', region: null };
  outputContext.putImageData(output, 0, 0);
  return {
    dataUrl: outputCanvas.toDataURL('image/png'),
    region: {
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      imageWidth: width,
      imageHeight: height,
    },
  };
};

export const SceneRegionEditor: React.FC<SceneRegionEditorProps> = ({
  sourceUrl,
  selectionEnabled = true,
  onSelectionChange,
}) => {
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const onSelectionChangeRef = useRef(onSelectionChange);
  const historyRef = useRef<string[]>([]);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState<PaintTool>('brush');
  const [brushSize, setBrushSize] = useState(96);
  const [zoom, setZoom] = useState(1);
  const [fitToWindow, setFitToWindow] = useState(true);
  const [historyCount, setHistoryCount] = useState(0);

  useEffect(() => {
    onSelectionChangeRef.current = onSelectionChange;
  }, [onSelectionChange]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const updateSize = () => setStageSize({ width: stage.clientWidth, height: stage.clientHeight });
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    historyRef.current = [];
    setHistoryCount(0);
    setFitToWindow(true);
    setZoom(1);
    onSelectionChangeRef.current('', null);
  }, [sourceUrl]);

  const fitScale = useMemo(() => {
    if (!imageSize.width || !imageSize.height || !stageSize.width || !stageSize.height) return 1;
    return Math.min(
      Math.max(0.08, (stageSize.width - 40) / imageSize.width),
      Math.max(0.08, (stageSize.height - 40) / imageSize.height),
      1,
    );
  }, [imageSize, stageSize]);
  const displayScale = fitToWindow ? fitScale : zoom;
  const displayWidth = Math.max(1, imageSize.width * displayScale);
  const displayHeight = Math.max(1, imageSize.height * displayScale);

  const reportSelection = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !canvas.width || !canvas.height) return;
    const selection = makeEditMask(
      context.getImageData(0, 0, canvas.width, canvas.height),
      canvas.width,
      canvas.height,
    );
    onSelectionChangeRef.current(selection.dataUrl, selection.region);
  };

  const initializeCanvas = () => {
    const image = imageRef.current;
    const canvas = canvasRef.current;
    if (!image || !canvas || !image.naturalWidth || !image.naturalHeight) return;
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    setImageSize({ width: image.naturalWidth, height: image.naturalHeight });
    historyRef.current = [];
    setHistoryCount(0);
    onSelectionChangeRef.current('', null);
  };

  const canvasPoint = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - bounds.left) / bounds.width) * canvas.width,
      y: ((event.clientY - bounds.top) / bounds.height) * canvas.height,
    };
  };

  const paintLine = (from: { x: number; y: number }, to: { x: number; y: number }) => {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    context.save();
    context.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over';
    context.strokeStyle = 'rgba(34, 211, 238, 0.48)';
    context.fillStyle = 'rgba(34, 211, 238, 0.48)';
    context.lineWidth = brushSize;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
    if (from.x === to.x && from.y === to.y) {
      context.beginPath();
      context.arc(to.x, to.y, brushSize / 2, 0, Math.PI * 2);
      context.fill();
    }
    context.restore();
  };

  const startPainting = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const point = canvasPoint(event);
    if (!canvas || !point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    historyRef.current = [...historyRef.current.slice(-14), canvas.toDataURL('image/png')];
    setHistoryCount(historyRef.current.length);
    drawingRef.current = true;
    lastPointRef.current = point;
    paintLine(point, point);
  };

  const continuePainting = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current || !lastPointRef.current) return;
    const point = canvasPoint(event);
    if (!point) return;
    paintLine(lastPointRef.current, point);
    lastPointRef.current = point;
  };

  const finishPainting = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    reportSelection();
  };

  const restoreCanvas = (dataUrl: string) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    const image = new Image();
    image.onload = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      reportSelection();
    };
    image.src = dataUrl;
  };

  const undo = () => {
    const previous = historyRef.current.pop();
    if (!previous) return;
    setHistoryCount(historyRef.current.length);
    restoreCanvas(previous);
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    historyRef.current = [...historyRef.current.slice(-14), canvas.toDataURL('image/png')];
    setHistoryCount(historyRef.current.length);
    context.clearRect(0, 0, canvas.width, canvas.height);
    onSelectionChangeRef.current('', null);
  };

  const zoomBy = (delta: number) => {
    setFitToWindow(false);
    setZoom((current) => Math.min(2, Math.max(0.25, current + delta)));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-black/45">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#15191a] px-3 py-2">
        {selectionEnabled ? (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs ${tool === 'brush' ? 'bg-cyan-300 text-[#071012]' : 'text-neutral-300 hover:bg-white/8'}`}
              onClick={() => setTool('brush')}
            >
              <Brush size={13} /> 涂抹选区
            </button>
            <button
              type="button"
              className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs ${tool === 'eraser' ? 'bg-white text-black' : 'text-neutral-300 hover:bg-white/8'}`}
              onClick={() => setTool('eraser')}
            >
              <Eraser size={13} /> 擦除
            </button>
            <div className="ml-1 flex items-center gap-2 border-l border-white/10 pl-3">
              <span className="text-[10px] text-neutral-500">画笔</span>
              <input
                aria-label="画笔大小"
                className="w-24 accent-cyan-300"
                type="range"
                min="24"
                max="240"
                step="8"
                value={brushSize}
                onChange={(event) => setBrushSize(Number(event.target.value))}
              />
              <span className="w-8 text-right text-[10px] tabular-nums text-neutral-400">{brushSize}</span>
            </div>
            <button type="button" disabled={!historyCount} className="ml-1 flex h-8 items-center gap-1 rounded-md px-2 text-xs text-neutral-400 hover:bg-white/8 hover:text-white disabled:opacity-30" onClick={undo}><RotateCcw size={13} /> 撤销</button>
            <button type="button" className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-neutral-400 hover:bg-white/8 hover:text-red-300" onClick={clear}><Trash2 size={13} /> 清除</button>
          </div>
        ) : (
          <div className="flex h-8 items-center gap-2 rounded-md bg-violet-400/[0.08] px-3 text-xs text-violet-200">
            <ScanSearch size={13} /> 整体调整模式 · 无需涂抹选区
          </div>
        )}
        <div className="flex items-center gap-1">
          <button type="button" className="flex h-8 items-center gap-1 rounded-md px-2 text-[11px] text-neutral-400 hover:bg-white/8 hover:text-white" onClick={() => setFitToWindow(true)}><Focus size={13} /> 适应窗口</button>
          <button type="button" className={`flex h-8 items-center gap-1 rounded-md px-2 text-[11px] hover:bg-white/8 hover:text-white ${!fitToWindow && zoom === 1 ? 'text-cyan-300' : 'text-neutral-400'}`} onClick={() => { setFitToWindow(false); setZoom(1); }}><ScanSearch size={13} /> 原图 100%</button>
          <button type="button" aria-label="缩小图片" className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-white/8 hover:text-white" onClick={() => zoomBy(-0.15)}><ZoomOut size={14} /></button>
          <span className="w-10 text-center text-[10px] tabular-nums text-neutral-500">{Math.round(displayScale * 100)}%</span>
          <button type="button" aria-label="放大图片" className="flex h-8 w-8 items-center justify-center rounded-md text-neutral-400 hover:bg-white/8 hover:text-white" onClick={() => zoomBy(0.15)}><ZoomIn size={14} /></button>
        </div>
      </div>

      <div ref={stageRef} className="relative min-h-[440px] flex-1 overflow-auto overscroll-contain bg-[#070909]">
        <div className="flex min-h-full min-w-full items-center justify-center p-5">
          <div
            className="relative shrink-0 overflow-hidden rounded-md bg-black shadow-[0_20px_70px_rgba(0,0,0,0.6)]"
            style={{ width: displayWidth, height: displayHeight }}
          >
            <img
              ref={imageRef}
              src={sourceUrl}
              alt="待局部调整的原图"
              draggable={false}
              className="absolute inset-0 h-full w-full select-none object-fill"
              onLoad={initializeCanvas}
            />
            <canvas
              ref={canvasRef}
              className={`absolute inset-0 h-full w-full ${selectionEnabled ? (tool === 'brush' ? 'cursor-crosshair' : 'cursor-cell') : 'pointer-events-none opacity-0'}`}
              style={{ touchAction: 'none' }}
              onPointerDown={startPainting}
              onPointerMove={continuePainting}
              onPointerUp={finishPainting}
              onPointerCancel={finishPainting}
              onPointerLeave={finishPainting}
            />
          </div>
        </div>
        <div className="pointer-events-none sticky bottom-3 mx-auto flex w-fit items-center gap-2 rounded-full border border-white/10 bg-black/75 px-3 py-1.5 text-[10px] text-neutral-400 backdrop-blur-md">
          <span className={`h-2 w-2 rounded-full ${selectionEnabled ? 'bg-cyan-300' : 'bg-violet-300'}`} /> {selectionEnabled ? '蓝色区域将被修改' : '整张图片将作为调整基础'}
          {imageSize.width > 0 && <span className="text-neutral-600">· {imageSize.width} × {imageSize.height}px</span>}
        </div>
      </div>
    </div>
  );
};
