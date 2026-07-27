// ===== Shared Types =====

export type Lang = 'zh' | 'en';
export type Mode = 'video' | 'sequence' | 'gif' | 'ai' | 'atlas' | 'specialty';
export type ExportFormat = 'LOTTIE' | 'MP4';
export type Status = 'IDLE' | 'PROCESSING' | 'DONE';

export interface ProcessedFrame {
  id: string;
  data: string; // base64 webp/png
}

/** 单属性关键帧 */
export interface PropKeyframe {
  time: number;
  value: number;
}

/** 5 条独立关键帧轨道 */
export interface AssetKeyframes {
  x: PropKeyframe[];
  y: PropKeyframe[];
  scale: PropKeyframe[];
  rotation: PropKeyframe[];
  opacity: PropKeyframe[];
}

/** 合成后的属性快照（用于绘制） */
export interface AssetTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
}

export type TransformProp = keyof AssetKeyframes;

export interface ImageAsset {
  id: string;
  name: string;
  src: string;
  width: number;
  height: number;
  visible: boolean;
  zBelowVideo?: boolean;
  keyframes: AssetKeyframes;
  /** 没有关键帧时的默认 transform（素材初始位置） */
  defaultTransform: AssetTransform;
}

/** 时间轴元数据 */
export interface TimelineState {
  duration: number;
  currentTime: number;
  playing: boolean;
}

export interface LoadedImage {
  id: string;
  el: HTMLImageElement;
}

export interface I18nDict {
  [k: string]: string;
}

export interface ChromaKeyOptions {
  enabled: boolean;
  color: string;
  threshold: number;
  similarity: number;
  despill: number;
}
