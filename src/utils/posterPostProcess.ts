export interface PosterPostProcessSettings {
  exposure: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  saturation: number;
  vibrance: number;
  temperature: number;
  tint: number;
  hue: number;
  redBalance: number;
  greenBalance: number;
  blueBalance: number;
  inputBlack: number;
  inputWhite: number;
  gamma: number;
  outputBlack: number;
  outputWhite: number;
  curve: number[];
  shadowColor: string;
  shadowTone: number;
  highlightColor: string;
  highlightTone: number;
  toneBalance: number;
  gradientEnabled: boolean;
  gradientShadow: string;
  gradientMid: string;
  gradientHighlight: string;
  gradientAmount: number;
  fade: number;
  vignette: number;
  grain: number;
  sharpen: number;
}

export const DEFAULT_POSTER_POST_PROCESS: PosterPostProcessSettings = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  saturation: 0,
  vibrance: 0,
  temperature: 0,
  tint: 0,
  hue: 0,
  redBalance: 0,
  greenBalance: 0,
  blueBalance: 0,
  inputBlack: 0,
  inputWhite: 255,
  gamma: 1,
  outputBlack: 0,
  outputWhite: 255,
  curve: [0, 64, 128, 192, 255],
  shadowColor: '#31507a',
  shadowTone: 0,
  highlightColor: '#f5c58a',
  highlightTone: 0,
  toneBalance: 0,
  gradientEnabled: false,
  gradientShadow: '#14243b',
  gradientMid: '#a35f67',
  gradientHighlight: '#f3d59c',
  gradientAmount: 0,
  fade: 0,
  vignette: 0,
  grain: 0,
  sharpen: 0,
};

export const normalizePosterPostProcessSettings = (
  value?: Partial<PosterPostProcessSettings> | null,
): PosterPostProcessSettings => ({
  ...DEFAULT_POSTER_POST_PROCESS,
  ...(value || {}),
  curve: Array.isArray(value?.curve) && value!.curve.length === 5
    ? value!.curve.map((point) => Number(point) || 0)
    : [...DEFAULT_POSTER_POST_PROCESS.curve],
});

const clamp = (value: number, min = 0, max = 255) => Math.max(min, Math.min(max, value));

const hexToRgb = (hex: string): [number, number, number] => {
  const clean = hex.replace('#', '').trim();
  const expanded = clean.length === 3 ? clean.split('').map((character) => character + character).join('') : clean;
  const parsed = Number.parseInt(expanded, 16);
  return Number.isFinite(parsed)
    ? [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255]
    : [0, 0, 0];
};

const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;

const rgbToHsl = (red: number, green: number, blue: number): [number, number, number] => {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  if (max === min) return [0, 0, lightness];
  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = max === r
    ? (g - b) / delta + (g < b ? 6 : 0)
    : max === g
      ? (b - r) / delta + 2
      : (r - g) / delta + 4;
  hue /= 6;
  return [hue, saturation, lightness];
};

const hslToRgb = (hue: number, saturation: number, lightness: number): [number, number, number] => {
  if (saturation === 0) {
    const value = lightness * 255;
    return [value, value, value];
  }
  const hueToRgb = (p: number, q: number, input: number) => {
    let t = input;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return [
    hueToRgb(p, q, hue + 1 / 3) * 255,
    hueToRgb(p, q, hue) * 255,
    hueToRgb(p, q, hue - 1 / 3) * 255,
  ];
};

const applyCurve = (value: number, curve: number[]) => {
  const normalized = clamp(value) / 255 * 4;
  const lower = Math.min(3, Math.floor(normalized));
  const amount = normalized - lower;
  return mix(curve[lower], curve[lower + 1], amount);
};

const gradientColor = (
  lightness: number,
  shadow: [number, number, number],
  middle: [number, number, number],
  highlight: [number, number, number],
): [number, number, number] => {
  if (lightness <= 0.5) {
    const amount = lightness * 2;
    return [mix(shadow[0], middle[0], amount), mix(shadow[1], middle[1], amount), mix(shadow[2], middle[2], amount)];
  }
  const amount = (lightness - 0.5) * 2;
  return [mix(middle[0], highlight[0], amount), mix(middle[1], highlight[1], amount), mix(middle[2], highlight[2], amount)];
};

const loadImage = (source: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('静态海报读取失败'));
  image.src = source;
});

export interface PosterRenderResult {
  dataUrl: string;
  width: number;
  height: number;
  histogram: number[];
}

export const renderPosterPostProcess = async (
  source: string,
  rawSettings: Partial<PosterPostProcessSettings>,
  options: {
    maxSide?: number;
    mimeType?: 'image/png' | 'image/jpeg';
    quality?: number;
    targetCanvas?: HTMLCanvasElement;
    includeDataUrl?: boolean;
  } = {},
): Promise<PosterRenderResult> => {
  const settings = normalizePosterPostProcessSettings(rawSettings);
  const image = await loadImage(source);
  const maxSide = options.maxSide || Number.POSITIVE_INFINITY;
  const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = options.targetCanvas || document.createElement('canvas');
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('当前浏览器不支持海报后期处理');
  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const data = imageData.data;
  const exposureFactor = 2 ** settings.exposure;
  const contrast = clamp(settings.contrast, -100, 100) * 2.2;
  const contrastFactor = (259 * (contrast + 255)) / (255 * (259 - contrast));
  const inputRange = Math.max(1, settings.inputWhite - settings.inputBlack);
  const outputRange = Math.max(0, settings.outputWhite - settings.outputBlack);
  const curve = settings.curve.map((point) => clamp(point));
  const shadowColor = hexToRgb(settings.shadowColor);
  const highlightColor = hexToRgb(settings.highlightColor);
  const gradientShadow = hexToRgb(settings.gradientShadow);
  const gradientMid = hexToRgb(settings.gradientMid);
  const gradientHighlight = hexToRgb(settings.gradientHighlight);
  const gradientAmount = settings.gradientEnabled ? clamp(settings.gradientAmount, 0, 100) / 100 : 0;
  const histogram = Array.from({ length: 64 }, () => 0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      let red = data[index] * exposureFactor;
      let green = data[index + 1] * exposureFactor;
      let blue = data[index + 2] * exposureFactor;

      const applyLevels = (channel: number) => {
        const normalized = clamp((channel - settings.inputBlack) / inputRange, 0, 1);
        return settings.outputBlack + (normalized ** (1 / Math.max(0.1, settings.gamma))) * outputRange;
      };
      red = applyLevels(red);
      green = applyLevels(green);
      blue = applyLevels(blue);

      red = contrastFactor * (red - 128) + 128;
      green = contrastFactor * (green - 128) + 128;
      blue = contrastFactor * (blue - 128) + 128;
      let luminance = clamp((red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255, 0, 1);
      const tonalShift = (
        settings.shadows / 100 * (1 - luminance) ** 2 * 84
        + settings.highlights / 100 * luminance ** 2 * 84
        + settings.blacks / 100 * (1 - luminance) ** 3 * 48
        + settings.whites / 100 * luminance ** 3 * 48
      );
      red += tonalShift;
      green += tonalShift;
      blue += tonalShift;

      red += settings.temperature * 0.34 + settings.tint * 0.12 + settings.redBalance * 0.34;
      green += -settings.tint * 0.25 + settings.greenBalance * 0.34;
      blue += -settings.temperature * 0.34 + settings.tint * 0.12 + settings.blueBalance * 0.34;

      let [hue, saturation, lightness] = rgbToHsl(clamp(red), clamp(green), clamp(blue));
      hue = (hue + settings.hue / 360 + 1) % 1;
      const saturationBoost = settings.saturation / 100;
      const vibranceBoost = settings.vibrance / 100 * (1 - saturation);
      saturation = clamp(saturation + saturationBoost * Math.max(0.15, saturation) + vibranceBoost * 0.62, 0, 1);
      [red, green, blue] = hslToRgb(hue, saturation, lightness);

      red = applyCurve(red, curve);
      green = applyCurve(green, curve);
      blue = applyCurve(blue, curve);
      luminance = clamp((red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255, 0, 1);

      const balance = settings.toneBalance / 200;
      const shadowWeight = clamp((0.56 + balance - luminance) * 2.2, 0, 1) * settings.shadowTone / 100;
      const highlightWeight = clamp((luminance - (0.44 + balance)) * 2.2, 0, 1) * settings.highlightTone / 100;
      red = mix(red, shadowColor[0], shadowWeight * 0.55);
      green = mix(green, shadowColor[1], shadowWeight * 0.55);
      blue = mix(blue, shadowColor[2], shadowWeight * 0.55);
      red = mix(red, highlightColor[0], highlightWeight * 0.55);
      green = mix(green, highlightColor[1], highlightWeight * 0.55);
      blue = mix(blue, highlightColor[2], highlightWeight * 0.55);

      if (gradientAmount > 0) {
        const mapped = gradientColor(luminance, gradientShadow, gradientMid, gradientHighlight);
        red = mix(red, mapped[0], gradientAmount);
        green = mix(green, mapped[1], gradientAmount);
        blue = mix(blue, mapped[2], gradientAmount);
      }

      const fade = settings.fade / 100;
      red = mix(red, 128 + (red - 128) * 0.72, fade);
      green = mix(green, 128 + (green - 128) * 0.72, fade);
      blue = mix(blue, 128 + (blue - 128) * 0.72, fade);

      if (settings.vignette > 0) {
        const dx = (x / Math.max(1, width - 1) - 0.5) * 2;
        const dy = (y / Math.max(1, height - 1) - 0.5) * 2;
        const distance = Math.sqrt(dx * dx + dy * dy) / 1.414;
        const vignette = clamp((distance - 0.28) / 0.72, 0, 1) ** 1.7 * settings.vignette / 100 * 0.68;
        red *= 1 - vignette;
        green *= 1 - vignette;
        blue *= 1 - vignette;
      }

      if (settings.grain > 0) {
        const noise = (((x * 374761393 + y * 668265263) ^ ((x + y) * 1274126177)) & 255) / 255 - 0.5;
        const grain = noise * settings.grain / 100 * 38;
        red += grain;
        green += grain;
        blue += grain;
      }

      data[index] = clamp(red);
      data[index + 1] = clamp(green);
      data[index + 2] = clamp(blue);
      const finalLuminance = clamp((red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255, 0, 1);
      histogram[Math.min(63, Math.floor(finalLuminance * 64))] += 1;
    }
  }

  if (settings.sharpen > 0 && width > 2 && height > 2) {
    const original = new Uint8ClampedArray(data);
    const amount = settings.sharpen / 100 * 0.72;
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = (y * width + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) {
          const center = original[index + channel];
          const neighbours = (
            original[index - width * 4 + channel]
            + original[index + width * 4 + channel]
            + original[index - 4 + channel]
            + original[index + 4 + channel]
          ) / 4;
          data[index + channel] = clamp(center + (center - neighbours) * amount);
        }
      }
    }
  }

  context.putImageData(imageData, 0, 0);
  const maxHistogram = Math.max(1, ...histogram);
  return {
    dataUrl: options.includeDataUrl === false ? '' : canvas.toDataURL(options.mimeType || 'image/png', options.quality || 0.94),
    width,
    height,
    histogram: histogram.map((value) => value / maxHistogram),
  };
};
