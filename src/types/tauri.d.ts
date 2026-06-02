declare global {
  interface Window {
    __TAURI__: {
      invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
      window: {
        getByLabel(label: string): Promise<{ show(): void; unminimize(): void; setFocus(): void }>;
      };
    };
  }
}

export {};