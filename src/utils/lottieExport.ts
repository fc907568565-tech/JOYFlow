import type { ProcessedFrame, ImageAsset } from '../types';
import { getTransformAtTime } from './interpolate';

/** 单一帧序列 Lottie：每帧一张合成图作为图层 */
export function buildSequencedLottie(
  frames: ProcessedFrame[],
  w: number,
  h: number,
  fps: number
) {
  return {
    v: '5.7.1', fr: fps, ip: 0, op: frames.length,
    w, h, nm: 'LottieKey_Export', ddd: 0,
    assets: frames.map((f) => ({ id: f.id, w, h, u: '', p: f.data, e: 1 })),
    layers: frames.map((f, i) => ({
      ty: 2, nm: `Frame ${i}`, refId: f.id,
      ks: {
        o: { a: 0, k: 100, ix: 11 },
        r: { a: 0, k: 0, ix: 10 },
        p: { a: 0, k: [w / 2, h / 2, 0], ix: 2 },
        a: { a: 0, k: [w / 2, h / 2, 0], ix: 1 },
        s: { a: 0, k: [100, 100, 100], ix: 6 },
      },
      ao: 0, ip: i, op: i + 1, st: 0, bm: 0,
    })),
    markers: [],
  };
}

/**
 * 多图层 Lottie：底层为视频帧序列，叠加层为 PNG 素材带关键帧动画。
 * Lottie 渲染顺序：layers 数组中越靠前的越在顶层。
 *   - aboveLayers: 显示在视频之上（数组前部）
 *   - belowLayers: 显示在视频之下（在 videoLayers 之后）
 */
export function buildCompositeLottie(
  videoFrames: ProcessedFrame[],
  w: number,
  h: number,
  fps: number,
  assets: ImageAsset[]
) {
  const totalDur = videoFrames.length;
  const assetEntries: any[] = videoFrames.map((f) => ({ id: f.id, w, h, u: '', p: f.data, e: 1 }));
  assets.forEach((a) => {
    assetEntries.push({ id: a.id, w: a.width, h: a.height, u: '', p: a.src, e: 1 });
  });

  // 视频底层
  const videoLayers = videoFrames.map((f, i) => ({
    ty: 2, nm: `Frame ${i}`, refId: f.id,
    ks: {
      o: { a: 0, k: 100, ix: 11 },
      r: { a: 0, k: 0, ix: 10 },
      p: { a: 0, k: [w / 2, h / 2, 0], ix: 2 },
      a: { a: 0, k: [w / 2, h / 2, 0], ix: 1 },
      s: { a: 0, k: [100, 100, 100], ix: 6 },
    },
    ao: 0, ip: i, op: i + 1, st: 0, bm: 0,
  }));

  // 把素材编译成 Lottie 图层
  const compileAsset = (a: ImageAsset) => {
    const pK: any[] = [];
    const sK: any[] = [];
    const rK: any[] = [];
    const oK: any[] = [];
    for (let i = 0; i < totalDur; i++) {
      const time = i / fps;
      const tr = getTransformAtTime(a.keyframes, time, a.defaultTransform);
      const isLast = i === totalDur - 1;
      if (isLast) {
        pK.push({ t: i, s: [tr.x, tr.y, 0] });
        sK.push({ t: i, s: [tr.scale * 100, tr.scale * 100, 100] });
        rK.push({ t: i, s: [tr.rotation] });
        oK.push({ t: i, s: [tr.opacity * 100] });
      } else {
        const ntr = getTransformAtTime(a.keyframes, (i + 1) / fps, a.defaultTransform);
        pK.push({ t: i, s: [tr.x, tr.y, 0], e: [ntr.x, ntr.y, 0], i: { x: 0.5, y: 0.5 }, o: { x: 0.5, y: 0.5 } });
        sK.push({ t: i, s: [tr.scale * 100, tr.scale * 100, 100], e: [ntr.scale * 100, ntr.scale * 100, 100], i: { x: 0.5, y: 0.5 }, o: { x: 0.5, y: 0.5 } });
        rK.push({ t: i, s: [tr.rotation], e: [ntr.rotation], i: { x: 0.5, y: 0.5 }, o: { x: 0.5, y: 0.5 } });
        oK.push({ t: i, s: [tr.opacity * 100], e: [ntr.opacity * 100], i: { x: 0.5, y: 0.5 }, o: { x: 0.5, y: 0.5 } });
      }
    }
    return {
      ty: 2, nm: `Asset ${a.name}`, refId: a.id,
      ks: {
        o: { a: 1, k: oK, ix: 11 },
        r: { a: 1, k: rK, ix: 10 },
        p: { a: 1, k: pK, ix: 2 },
        a: { a: 0, k: [a.width / 2, a.height / 2, 0], ix: 1 },
        s: { a: 1, k: sK, ix: 6 },
      },
      ao: 0, ip: 0, op: totalDur, st: 0, bm: 0,
    };
  };

  const visible = assets.filter((a) => a.visible);
  const aboveLayers = visible.filter((a) => !a.zBelowVideo).map(compileAsset);
  const belowLayers = visible.filter((a) => a.zBelowVideo).map(compileAsset);

  return {
    v: '5.7.1', fr: fps, ip: 0, op: totalDur,
    w, h, nm: 'LottieKey_Composite', ddd: 0,
    assets: assetEntries,
    // 顺序：在视频之上的素材 → 视频帧 → 在视频之下的素材
    layers: [...aboveLayers, ...videoLayers, ...belowLayers],
    markers: [],
  };
}

export function downloadJson(json: any, name = 'lottie_export') {
  const blob = new Blob([JSON.stringify(json)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}