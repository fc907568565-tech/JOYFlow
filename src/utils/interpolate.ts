import type { PropKeyframe, AssetKeyframes, AssetTransform, TransformProp } from '../types';

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** 在单属性轨道上插值得到某时刻的值 */
export function getValueAtTime(track: PropKeyframe[], time: number, fallback: number): number {
  if (track.length === 0) return fallback;
  if (track.length === 1) return track[0].value;
  if (time <= track[0].time) return track[0].value;
  if (time >= track[track.length - 1].time) return track[track.length - 1].value;
  for (let i = 0; i < track.length - 1; i++) {
    if (time >= track[i].time && time <= track[i + 1].time) {
      const t = (time - track[i].time) / (track[i + 1].time - track[i].time);
      return lerp(track[i].value, track[i + 1].value, t);
    }
  }
  return track[track.length - 1].value;
}

/** 从全部 5 条轨道插值得到完整 transform */
export function getTransformAtTime(kfs: AssetKeyframes, time: number, defaults?: AssetTransform): AssetTransform {
  const d = defaults || { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 };
  return {
    x: getValueAtTime(kfs.x, time, d.x),
    y: getValueAtTime(kfs.y, time, d.y),
    scale: getValueAtTime(kfs.scale, time, d.scale),
    rotation: getValueAtTime(kfs.rotation, time, d.rotation),
    opacity: getValueAtTime(kfs.opacity, time, d.opacity),
  };
}

/** 在单属性轨道上插入或更新关键帧（0.001s 精度匹配） */
export function upsertPropKeyframe(track: PropKeyframe[], time: number, value: number): PropKeyframe[] {
  const idx = track.findIndex((k) => Math.abs(k.time - time) < 0.001);
  let next: PropKeyframe[];
  if (idx >= 0) {
    next = track.map((k, i) => (i === idx ? { time, value } : k));
  } else {
    next = [...track, { time, value }];
  }
  return next.sort((a, b) => a.time - b.time);
}

/** 删除某时刻某属性关键帧 */
export function removePropKeyframe(track: PropKeyframe[], time: number): PropKeyframe[] {
  return track.filter((k) => Math.abs(k.time - time) >= 0.001);
}

/** 在所有属性上一次性添加关键帧（手动操作） */
export function addKeyframeAllProps(kfs: AssetKeyframes, time: number, tr: AssetTransform): AssetKeyframes {
  return {
    x: upsertPropKeyframe(kfs.x, time, tr.x),
    y: upsertPropKeyframe(kfs.y, time, tr.y),
    scale: upsertPropKeyframe(kfs.scale, time, tr.scale),
    rotation: upsertPropKeyframe(kfs.rotation, time, tr.rotation),
    opacity: upsertPropKeyframe(kfs.opacity, time, tr.opacity),
  };
}

/** 创建空关键帧组（无预设帧） */
export function createInitialKeyframes(): AssetKeyframes {
  return {
    x: [],
    y: [],
    scale: [],
    rotation: [],
    opacity: [],
  };
}