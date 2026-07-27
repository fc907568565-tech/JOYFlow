import type { GenerateTask } from '../ai/types';

const DB_NAME = 'lottiekey-ai-history';
const STORE_NAME = 'history';
const TASKS_KEY = 'tasks';
const FALLBACK_KEY = 'lottiekey_ai_history_v1';
const MAX_TASKS = 50;

type PersistedTask = Omit<GenerateTask, 'rawLastResponse'>;

const sanitizeTasks = (tasks: GenerateTask[]): PersistedTask[] =>
  tasks.slice(0, MAX_TASKS).map(({ rawLastResponse: _rawLastResponse, ...task }) => ({
    ...task,
    resultUrls: task.resultUrls.filter((url) => !url.startsWith('blob:')),
  }));

const openDatabase = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const readFromDatabase = async (): Promise<PersistedTask[]> => {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readonly');
    const request = transaction.objectStore(STORE_NAME).get(TASKS_KEY);
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  });
};

const writeToDatabase = async (tasks: PersistedTask[]) => {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, 'readwrite');
    transaction.objectStore(STORE_NAME).put(tasks, TASKS_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
  database.close();
};

const restoreInterruptedTasks = (tasks: PersistedTask[]): GenerateTask[] =>
  tasks.map((task) => {
    if (task.status !== 'queued' && task.status !== 'running') return task;
    return {
      ...task,
      status: 'failed',
      progress: 100,
      errorMessage: task.errorMessage || '页面刷新后任务已中断，可使用“一键同款”重新生成',
    };
  });

export const loadAIHistory = async (): Promise<GenerateTask[]> => {
  try {
    return restoreInterruptedTasks(await readFromDatabase());
  } catch {
    try {
      const raw = localStorage.getItem(FALLBACK_KEY);
      return restoreInterruptedTasks(raw ? JSON.parse(raw) : []);
    } catch {
      return [];
    }
  }
};

export const saveAIHistory = async (tasks: GenerateTask[]) => {
  const sanitized = sanitizeTasks(tasks);
  try {
    await writeToDatabase(sanitized);
    localStorage.removeItem(FALLBACK_KEY);
  } catch {
    const lightweight = sanitized
      .map((task) => ({
        ...task,
        resultUrls: task.resultUrls.filter((url) => !url.startsWith('data:')),
      }))
      .slice(0, 20);
    try {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(lightweight));
    } catch {
      // History persistence must never block generation when browser storage is unavailable.
    }
  }
};
