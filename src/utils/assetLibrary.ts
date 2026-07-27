/**
 * IndexedDB-backed asset library. Original media and lightweight thumbnails
 * are stored separately so exports retain source quality.
 */

export interface LibraryAsset {
  id: string;
  url: string;
  type: 'image' | 'video';
  prompt: string;
  createdAt: number;
  thumbnail?: string;
  name?: string;
  sourceUrl?: string;
  storageMode?: 'local' | 'remote' | 'cached';
  mimeType?: string;
  width?: number;
  height?: number;
  duration?: number;
  fileSize?: number;
  projectId?: string;
  workflowId?: string;
  stage?: string;
  parentAssetId?: string;
  templateId?: string;
  model?: string;
  generationParams?: Record<string, unknown>;
  joyState?: Record<string, unknown>;
  version?: number;
  selected?: boolean;
  status?: string;
  tags?: string[];
}

type NewLibraryAsset = Omit<LibraryAsset, 'id' | 'createdAt'>;

interface StoredLibraryAsset extends Omit<LibraryAsset, 'url' | 'thumbnail'> {
  originalBlob?: Blob;
  thumbnailBlob?: Blob;
  fallbackThumbnail?: string;
}

const DB_NAME = 'lottiekey-asset-library';
const STORE_NAME = 'assets';
const DB_VERSION = 1;
const LEGACY_STORAGE_KEY = 'lottiekey_asset_library';
const MIGRATION_KEY = 'lottiekey_asset_library_idb_v1';
const THUMBNAIL_MAX_SIDE = 480;

const runtimeUrls = new Map<string, { original?: string; thumbnail?: string }>();
let migrationPromise: Promise<void> | null = null;

const openDatabase = (): Promise<IDBDatabase> => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      store.createIndex('createdAt', 'createdAt');
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const getAllStored = async (): Promise<StoredLibraryAsset[]> => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as StoredLibraryAsset[]);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => reject(transaction.error);
  });
};

const putStored = async (asset: StoredLibraryAsset): Promise<void> => {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(asset);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  db.close();
};

const deleteStored = async (id: string): Promise<void> => {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
};

const clearStored = async (): Promise<void> => {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
};

const sourceToBlob = async (source?: string): Promise<Blob | undefined> => {
  if (!source) return undefined;
  try {
    const requestUrl = /^https?:\/\//i.test(source)
      ? `/remote-asset?u=${encodeURIComponent(source)}`
      : source;
    const response = await fetch(requestUrl);
    if (!response.ok) return undefined;
    return await response.blob();
  } catch {
    return undefined;
  }
};

const canvasToBlob = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob | undefined>((resolve) => {
  canvas.toBlob((value) => resolve(value || undefined), 'image/webp', quality);
});

const imageInfo = async (blob: Blob): Promise<{ width?: number; height?: number; thumbnailBlob?: Blob }> => {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('Image decode failed'));
      image.src = objectUrl;
    });
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const scale = Math.min(1, THUMBNAIL_MAX_SIDE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) return { width, height };
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { width, height, thumbnailBlob: await canvasToBlob(canvas, 0.82) };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const videoInfo = async (blob: Blob): Promise<{ width?: number; height?: number; duration?: number; thumbnailBlob?: Blob }> => {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'metadata';
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Video metadata decode failed'));
      video.src = objectUrl;
    });
    const width = video.videoWidth;
    const height = video.videoHeight;
    const duration = Number.isFinite(video.duration) ? video.duration : undefined;
    if (!width || !height) return { width, height, duration };
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      video.onseeked = finish;
      video.currentTime = Math.min(0.1, Math.max(0, (duration || 0) / 2));
      window.setTimeout(finish, 800);
    });
    const scale = Math.min(1, THUMBNAIL_MAX_SIDE / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d');
    if (!context) return { width, height, duration };
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return { width, height, duration, thumbnailBlob: await canvasToBlob(canvas, 0.78) };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const buildStoredAsset = async (
  asset: NewLibraryAsset,
  identity?: { id: string; createdAt: number }
): Promise<StoredLibraryAsset> => {
  const id = identity?.id || `asset_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = identity?.createdAt || Date.now();
  const sourceUrl = asset.sourceUrl || asset.url;
  const originalBlob = await sourceToBlob(asset.url);
  let metadata: { width?: number; height?: number; duration?: number; thumbnailBlob?: Blob } = {};
  if (originalBlob) {
    try {
      metadata = asset.type === 'image' ? await imageInfo(originalBlob) : await videoInfo(originalBlob);
    } catch (error) {
      console.warn('[AssetLibrary] Media metadata unavailable:', error);
    }
  }
  return {
    ...asset,
    id,
    createdAt,
    sourceUrl,
    storageMode: originalBlob ? (/^https?:\/\//i.test(sourceUrl) ? 'cached' : 'local') : 'remote',
    mimeType: originalBlob?.type || asset.mimeType,
    fileSize: originalBlob?.size || asset.fileSize,
    width: metadata.width || asset.width,
    height: metadata.height || asset.height,
    duration: metadata.duration || asset.duration,
    originalBlob,
    thumbnailBlob: metadata.thumbnailBlob,
    fallbackThumbnail: originalBlob ? undefined : asset.thumbnail,
  };
};

const releaseRuntimeUrls = (id: string) => {
  const urls = runtimeUrls.get(id);
  if (urls?.original) URL.revokeObjectURL(urls.original);
  if (urls?.thumbnail) URL.revokeObjectURL(urls.thumbnail);
  runtimeUrls.delete(id);
};

const toRuntimeAsset = (stored: StoredLibraryAsset): LibraryAsset => {
  const cached = runtimeUrls.get(stored.id);
  const original = cached?.original || (stored.originalBlob ? URL.createObjectURL(stored.originalBlob) : undefined);
  const thumbnail = cached?.thumbnail || (stored.thumbnailBlob ? URL.createObjectURL(stored.thumbnailBlob) : undefined);
  runtimeUrls.set(stored.id, { original, thumbnail });
  const { originalBlob: _originalBlob, thumbnailBlob: _thumbnailBlob, fallbackThumbnail, ...metadata } = stored;
  return {
    ...metadata,
    url: original || stored.sourceUrl || '',
    thumbnail: thumbnail || fallbackThumbnail || original || stored.sourceUrl,
  };
};

const readLegacyAssets = (): LibraryAsset[] => {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    return raw ? JSON.parse(raw) as LibraryAsset[] : [];
  } catch {
    return [];
  }
};

const ensureMigrated = async (): Promise<void> => {
  if (localStorage.getItem(MIGRATION_KEY) === 'complete') return;
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    const existingIds = new Set((await getAllStored()).map((asset) => asset.id));
    for (const asset of readLegacyAssets()) {
      if (existingIds.has(asset.id)) continue;
      await putStored(await buildStoredAsset(asset, { id: asset.id, createdAt: asset.createdAt }));
    }
    localStorage.setItem(MIGRATION_KEY, 'complete');
  })().finally(() => {
    migrationPromise = null;
  });
  return migrationPromise;
};

export const loadLibrary = async (): Promise<LibraryAsset[]> => {
  try {
    await ensureMigrated();
    return (await getAllStored())
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(toRuntimeAsset);
  } catch (error) {
    console.warn('[AssetLibrary] IndexedDB read failed, using legacy data:', error);
    return readLegacyAssets();
  }
};

export const saveLibrary = async (assets: LibraryAsset[]): Promise<void> => {
  await ensureMigrated();
  await clearStored();
  for (const asset of assets) {
    await putStored(await buildStoredAsset(asset, { id: asset.id, createdAt: asset.createdAt }));
  }
};

export const addToLibrary = async (asset: NewLibraryAsset): Promise<LibraryAsset> => {
  await ensureMigrated();
  const stored = await buildStoredAsset(asset);
  await putStored(stored);
  return toRuntimeAsset(stored);
};

export const removeFromLibrary = async (id: string): Promise<void> => {
  await ensureMigrated();
  await deleteStored(id);
  releaseRuntimeUrls(id);
};

export const clearLibrary = async (): Promise<void> => {
  await clearStored();
  for (const id of Array.from(runtimeUrls.keys())) releaseRuntimeUrls(id);
};
