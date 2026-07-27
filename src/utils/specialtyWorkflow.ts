export type SpecialtyItemStatus = 'idle' | 'running' | 'succeeded' | 'failed';
export type SpecialtyStage = 'generate' | 'cutout';

export interface SpecialtyCutoutSettings {
  threshold: number;
  feather: number;
  padding: number;
  brightness: number;
  contrast: number;
  saturation: number;
  temperature: number;
}

export interface SpecialtyItem {
  id: string;
  name: string;
  referenceAssetId?: string;
  candidateAssetIds: string[];
  selectedAssetId?: string;
  outputAssetId?: string;
  cutoutSettings?: SpecialtyCutoutSettings;
  status: SpecialtyItemStatus;
  errorMessage?: string;
}

export interface SpecialtyProject {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  modelPresetId: string;
  candidateCount: number;
  stage?: SpecialtyStage;
  items: SpecialtyItem[];
}

const ACTIVE_KEY = 'lottiekey_specialty_active_project_v1';
const HISTORY_KEY = 'lottiekey_specialty_project_history_v1';

const readHistory = (): SpecialtyProject[] => {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) as SpecialtyProject[] : [];
  } catch {
    return [];
  }
};

const writeHistory = (projects: SpecialtyProject[]) => {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(projects.slice(0, 30)));
};

export const loadActiveSpecialtyProject = (): SpecialtyProject | null => {
  try {
    const raw = localStorage.getItem(ACTIVE_KEY);
    return raw ? JSON.parse(raw) as SpecialtyProject : null;
  } catch {
    return null;
  }
};

export const saveSpecialtyProject = (project: SpecialtyProject): SpecialtyProject => {
  const next = { ...project, updatedAt: Date.now() };
  localStorage.setItem(ACTIVE_KEY, JSON.stringify(next));
  writeHistory([next, ...readHistory().filter((item) => item.id !== next.id)]
    .sort((a, b) => b.updatedAt - a.updatedAt));
  return next;
};

export const createSpecialtyProject = (name?: string): SpecialtyProject => saveSpecialtyProject({
  id: `specialty_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  name: name?.trim() || `特产道具任务 ${new Date().toLocaleDateString()}`,
  createdAt: Date.now(),
  updatedAt: Date.now(),
  modelPresetId: '__doubao_seedream_45__',
  candidateCount: 1,
  stage: 'generate',
  items: [],
});

export const loadSpecialtyProjectHistory = (): SpecialtyProject[] => {
  const active = loadActiveSpecialtyProject();
  const history = readHistory();
  return (active ? [active, ...history.filter((item) => item.id !== active.id)] : history)
    .sort((a, b) => b.updatedAt - a.updatedAt);
};

export const deleteSpecialtyProject = (projectId: string): boolean => {
  const active = loadActiveSpecialtyProject();
  const deletedActive = active?.id === projectId;
  writeHistory(readHistory().filter((item) => item.id !== projectId));
  if (deletedActive) localStorage.removeItem(ACTIVE_KEY);
  return deletedActive;
};
