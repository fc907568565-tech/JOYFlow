/**
 * 图片上传工具 - 将 base64 图片上传到 imgbb 图床获取 URL
 * imgbb API: https://api.imgbb.com/
 */

const IMGBB_UPLOAD_URL = 'https://api.imgbb.com/1/upload';

/** 判断字符串是否 base64 data URL */
export const isBase64DataUrl = (str: string): boolean =>
  str.startsWith('data:image/');

/** 从 data URL 中提取纯 base64 字符串 */
const extractBase64 = (dataUrl: string): string => {
  const idx = dataUrl.indexOf(',');
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
};

export interface UploadResult {
  url: string;
  deleteUrl?: string;
  width?: number;
  height?: number;
}

/**
 * 上传单张图片到 imgbb
 * @param imageData - base64 data URL 或纯 base64 字符串
 * @param apiKey - imgbb API Key
 * @returns 上传成功后的图片 URL
 */
export const uploadToImgbb = async (
  imageData: string,
  apiKey: string
): Promise<UploadResult> => {
  if (!apiKey) {
    throw new Error('未配置 imgbb API Key，无法上传图片。请在接口配置中填写 imgbb API Key。');
  }

  const base64 = isBase64DataUrl(imageData)
    ? extractBase64(imageData)
    : imageData;

  const formData = new FormData();
  formData.append('key', apiKey);
  formData.append('image', base64);

  const res = await fetch(IMGBB_UPLOAD_URL, {
    method: 'POST',
    body: formData,
  });

  const json = await res.json();

  if (!res.ok || !json.success) {
    const msg = json?.error?.message || json?.status_txt || `上传失败 (HTTP ${res.status})`;
    throw new Error(`imgbb 图片上传失败: ${msg}`);
  }

  return {
    url: json.data.url,
    deleteUrl: json.data.delete_url,
    width: json.data.width ? Number(json.data.width) : undefined,
    height: json.data.height ? Number(json.data.height) : undefined,
  };
};

/**
 * 确保图片为 URL 格式 - 如果是 base64 则上传到 imgbb 转换
 * 如果已经是 http(s) URL 则直接返回
 */
export const ensureImageUrl = async (
  imageData: string,
  imgbbApiKey: string
): Promise<string> => {
  if (!imageData) return '';

  // 已经是 URL，直接返回
  if (imageData.startsWith('http://') || imageData.startsWith('https://')) {
    return imageData;
  }

  // base64 需要上传
  if (isBase64DataUrl(imageData) || /^[A-Za-z0-9+/=]+$/.test(imageData.slice(0, 100))) {
    console.log('[ImageUpload] 检测到 base64 图片，正在上传到 imgbb...');
    const result = await uploadToImgbb(imageData, imgbbApiKey);
    console.log('[ImageUpload] 上传成功:', result.url);
    return result.url;
  }

  // 其他格式原样返
  return imageData;
};