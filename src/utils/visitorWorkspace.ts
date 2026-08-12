import { clearActiveAtlasProject } from './atlasWorkflow';
import { clearActiveSpecialtyProject } from './specialtyWorkflow';

const VISITOR_INITIALIZED_KEY = 'joyflow_visitor_workspace_initialized_v1';

/**
 * Give each browser a clean first run without repeatedly resetting later work.
 * Existing projects are archived by their workflow utilities before the active
 * pointers are cleared, so users can still recover them from task history.
 */
export const initializeVisitorWorkspace = () => {
  try {
    if (localStorage.getItem(VISITOR_INITIALIZED_KEY) === 'complete') return;

    clearActiveAtlasProject();
    clearActiveSpecialtyProject();
    localStorage.removeItem('lottiekey_active_workspace');
    localStorage.setItem(VISITOR_INITIALIZED_KEY, 'complete');
  } catch {
    // Storage can be unavailable in privacy-restricted browsers. The app still
    // works; it simply falls back to the existing workflow initialization.
  }
};
