export type AtlasStage = 'setup' | 'scene' | 'joy' | 'static' | 'dynamic' | 'export';
export type AtlasSceneStrategy = 'local' | 'recompose' | 'landmark';

export interface AtlasCropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AtlasCameraView {
  rotation: number;
  tilt: number;
  zoom: number;
}

export interface AtlasProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  currentStage: AtlasStage;
  locationName?: string;
  sceneDescription?: string;
  sceneDescriptionOptions?: string[];
  sceneStrategy?: AtlasSceneStrategy;
  sceneCrop?: AtlasCropRect;
  sceneCamera?: AtlasCameraView;
  sceneReferenceId?: string;
  selectedSceneId?: string;
  selectedCompositeId?: string;
  selectedVideoId?: string;
  joyState?: Record<string, unknown>;
  outputRatio: string;
  outputWidth: number;
  outputHeight: number;
  dynamicEnabled: boolean;
}

const ACTIVE_PROJECT_KEY = 'lottiekey_atlas_active_project_v1';
const PROJECT_HISTORY_KEY = 'lottiekey_atlas_project_history_v1';

const readProjectHistory = (): AtlasProject[] => {
  try {
    const raw = localStorage.getItem(PROJECT_HISTORY_KEY);
    return raw ? JSON.parse(raw) as AtlasProject[] : [];
  } catch {
    return [];
  }
};

const upsertProjectHistory = (project: AtlasProject) => {
  const history = readProjectHistory();
  const next = [project, ...history.filter((item) => item.id !== project.id)]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 50);
  localStorage.setItem(PROJECT_HISTORY_KEY, JSON.stringify(next));
};

export const loadActiveAtlasProject = (): AtlasProject | null => {
  try {
    const raw = localStorage.getItem(ACTIVE_PROJECT_KEY);
    return raw ? JSON.parse(raw) as AtlasProject : null;
  } catch {
    return null;
  }
};

export const saveActiveAtlasProject = (project: AtlasProject): AtlasProject => {
  const next = { ...project, updatedAt: Date.now() };
  localStorage.setItem(ACTIVE_PROJECT_KEY, JSON.stringify(next));
  upsertProjectHistory(next);
  return next;
};

export const loadAtlasProjectHistory = (): AtlasProject[] => {
  const history = readProjectHistory();
  const active = loadActiveAtlasProject();
  const merged = active
    ? [active, ...history.filter((item) => item.id !== active.id)]
    : history;
  return merged.sort((a, b) => b.updatedAt - a.updatedAt);
};

export const createAtlasProject = (input: {
  name: string;
  outputRatio: string;
  outputWidth: number;
  outputHeight: number;
  dynamicEnabled: boolean;
  locationName?: string;
  sceneDescription?: string;
  sceneDescriptionOptions?: string[];
  sceneStrategy?: AtlasSceneStrategy;
  sceneCrop?: AtlasCropRect;
  sceneCamera?: AtlasCameraView;
}): AtlasProject => saveActiveAtlasProject({
  id: `atlas_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  name: input.name.trim() || `图鉴任务 ${new Date().toLocaleDateString()}`,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  currentStage: 'scene',
  locationName: input.locationName?.trim(),
  sceneDescription: input.sceneDescription?.trim(),
  sceneDescriptionOptions: input.sceneDescriptionOptions,
  sceneStrategy: input.sceneStrategy,
  sceneCrop: input.sceneCrop,
  sceneCamera: input.sceneCamera,
  outputRatio: input.outputRatio,
  outputWidth: input.outputWidth,
  outputHeight: input.outputHeight,
  dynamicEnabled: input.dynamicEnabled,
});

export const clearActiveAtlasProject = () => {
  const active = loadActiveAtlasProject();
  if (active) upsertProjectHistory(active);
  localStorage.removeItem(ACTIVE_PROJECT_KEY);
};

export const deleteAtlasProject = (projectId: string): boolean => {
  const active = loadActiveAtlasProject();
  const deletedActive = active?.id === projectId;
  const nextHistory = readProjectHistory().filter((item) => item.id !== projectId);
  localStorage.setItem(PROJECT_HISTORY_KEY, JSON.stringify(nextHistory));
  if (deletedActive) localStorage.removeItem(ACTIVE_PROJECT_KEY);
  return deletedActive;
};

export const patchActiveAtlasProject = (
  patch: Partial<AtlasProject>
): AtlasProject | null => {
  const current = loadActiveAtlasProject();
  if (!current) return null;
  return saveActiveAtlasProject({ ...current, ...patch });
};
