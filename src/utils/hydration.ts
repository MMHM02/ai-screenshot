import { useSettingsStore } from '@/stores/settingsStore';

/**
 * Wait for the zustand settings store to finish hydrating from localStorage.
 * Returns immediately if hydration is already complete.
 */
export async function waitForHydration(): Promise<void> {
  if (useSettingsStore.persist.hasHydrated()) return;
  await new Promise<void>((resolve) => {
    const unsub = useSettingsStore.persist.onFinishHydration(() => {
      unsub();
      resolve();
    });
    // Safety timeout: resolve anyway after 5s
    setTimeout(() => { unsub(); resolve(); }, 5000);
  });
}
