import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AIProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

export interface HotkeyConfig {
  fullScreen: string;
  region: string;
  toggleFloatBall: string;
}

interface SettingsStore {
  // AI 配置
  aiProviders: AIProvider[];
  activeProviderId: string;
  
  // 主题
  themeColor: string;
  darkMode: boolean;
  fontSize: number;
  
  // 快捷键
  hotkeys: HotkeyConfig;
  lastHotkeyError?: string;
  
  // 悬浮球
  floatBallEnabled: boolean;
  floatBallSize: number;
  floatBallOpacity: number;
  floatBallPosition: { x: number; y: number };
  floatBallPanelPosition: { x: number; y: number } | null;
  floatBallPanelWidth: number;
  floatBallPanelHeight: number;
  autoStart: boolean;
  
  // 截图设置
  screenshotQuality: number;
  autoCopyToClipboard: boolean;
  saveScreenshots: boolean;
  savePath: string;

  // 多模型对比
  multiMode: boolean;
  multiSelectProviderIds: string[];

  // 简要答题模式
  briefAnswerMode: boolean;

  // Actions
  setThemeColor: (color: string) => void;
  toggleDarkMode: () => void;
  setFontSize: (size: number) => void;
  setHotkey: (key: keyof HotkeyConfig, value: string) => void;
  setFloatBallEnabled: (enabled: boolean) => void;
  setFloatBallSize: (size: number) => void;
  setFloatBallOpacity: (opacity: number) => void;
  setFloatBallPosition: (position: { x: number; y: number }) => void;
  setFloatBallPanelPosition: (position: { x: number; y: number } | null) => void;
  setFloatBallPanelWidth: (width: number) => void;
  setFloatBallPanelHeight: (height: number) => void;
  setAutoStart: (enabled: boolean) => void;
  setScreenshotQuality: (quality: number) => void;
  setAutoCopyToClipboard: (enabled: boolean) => void;
  setSaveScreenshots: (enabled: boolean) => void;
  setSavePath: (path: string) => void;
  addAIProvider: (provider: Omit<AIProvider, 'id'>) => void;
  updateAIProvider: (id: string, updates: Partial<AIProvider>) => void;
  deleteAIProvider: (id: string) => void;
  setActiveProvider: (id: string) => void;
  setMultiMode: (enabled: boolean) => void;
  toggleMultiProvider: (providerId: string) => void;
  setBriefAnswerMode: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      // 默认 AI 提供商
      aiProviders: [
        {
          id: 'deepseek',
          name: '深度求索',
          baseUrl: 'https://api.deepseek.com',
          apiKey: '',
          model: 'deepseek-chat',
          enabled: true,
        },
        {
          id: 'glm',
          name: '智谱 AI',
          baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
          apiKey: '',
          model: 'glm-4',
          enabled: true,
        },
        {
          id: 'qwen',
          name: '通义千问',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          apiKey: '',
          model: 'qwen-vl-max',
          enabled: true,
        },
        {
          id: 'custom',
          name: '自定义',
          baseUrl: '',
          apiKey: '',
          model: '',
          enabled: true,
        },
      ],
      activeProviderId: 'deepseek',
      
      themeColor: '#6366f1',
      darkMode: false,
      fontSize: 14,
      
      hotkeys: {
        fullScreen: 'Ctrl+Alt+1',
        region: 'Ctrl+Alt+2',
        toggleFloatBall: 'Ctrl+Alt+F',
      },
      lastHotkeyError: undefined,

      floatBallEnabled: true,
      floatBallSize: 52,
      floatBallOpacity: 0.8,
      floatBallPosition: { x: 20, y: 100 },
      floatBallPanelPosition: null,
      floatBallPanelWidth: 360,
      floatBallPanelHeight: 480,
      autoStart: false,
      
      screenshotQuality: 85,
      autoCopyToClipboard: true,
      saveScreenshots: false,
      savePath: '',

      multiMode: false,
      multiSelectProviderIds: ['deepseek'],
      briefAnswerMode: false,

      setThemeColor: (color) => set({ themeColor: color }),
      
      toggleDarkMode: () => set((state) => ({ darkMode: !state.darkMode })),
      
      setFontSize: (size) => set({ fontSize: size }),
      
      setHotkey: (key, value) => {
        set((state) => {
          const newHotkeys = { ...state.hotkeys, [key]: value };
          // Sync updated hotkeys to Rust backend so global shortcuts take effect immediately.
          // Handle validation errors from Rust (fix #16).
          if (window.__TAURI__) {
            window.__TAURI__.invoke('update_hotkeys', {
              hotkeys: {
                full_screen: newHotkeys.fullScreen,
                region: newHotkeys.region,
                toggle_float_ball: newHotkeys.toggleFloatBall,
              },
            }).catch((err: any) => {
              // Revert the hotkey on error
              set({ hotkeys: state.hotkeys });
              // Surface error to user via the store
              set({ lastHotkeyError: err?.toString?.() || '快捷键注册失败' });
            });
          }
          return { hotkeys: newHotkeys, lastHotkeyError: undefined };
        });
      },
      
      setFloatBallEnabled: (enabled) => set({ floatBallEnabled: enabled }),
      
      setFloatBallSize: (size) => set({ floatBallSize: size }),
      
      setFloatBallOpacity: (opacity) => set({ floatBallOpacity: opacity }),
      
      setFloatBallPosition: (position) => set({ floatBallPosition: position }),

      setFloatBallPanelPosition: (position) => set({ floatBallPanelPosition: position }),

      setFloatBallPanelWidth: (width) => set({ floatBallPanelWidth: width }),
      
      setFloatBallPanelHeight: (height) => set({ floatBallPanelHeight: height }),
      
      setAutoStart: (enabled) => set({ autoStart: enabled }),
      
      setScreenshotQuality: (quality) => set({ screenshotQuality: quality }),
      
      setAutoCopyToClipboard: (enabled) => set({ autoCopyToClipboard: enabled }),
      
      setSaveScreenshots: (enabled) => set({ saveScreenshots: enabled }),
      
      setSavePath: (path) => set({ savePath: path }),
      
      addAIProvider: (provider) => {
        const id = `provider_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        set((state) => ({
          aiProviders: [...state.aiProviders, { ...provider, id }],
        }));
      },
      
      deleteAIProvider: (id) =>
        set((state) => {
          const remaining = state.aiProviders.filter((p) => p.id !== id);
          let newActive = state.activeProviderId;
          if (state.activeProviderId === id) {
            newActive = remaining.length > 0 ? remaining[0].id : state.activeProviderId;
          }
          return {
            aiProviders: remaining,
            activeProviderId: newActive,
            multiSelectProviderIds: state.multiSelectProviderIds.filter(pid => pid !== id),
          };
        }),
      
      setActiveProvider: (id) => set({ activeProviderId: id }),

      setMultiMode: (enabled) => set({ multiMode: enabled }),

      toggleMultiProvider: (providerId) => set((state) => {
        const provider = state.aiProviders.find(p => p.id === providerId);
        if (!provider?.enabled) return state;
        const ids = state.multiSelectProviderIds.includes(providerId)
          ? state.multiSelectProviderIds.filter(id => id !== providerId)
          : [...state.multiSelectProviderIds, providerId];
        return { multiSelectProviderIds: ids };
      }),

      setBriefAnswerMode: (enabled) => set({ briefAnswerMode: enabled }),

      // Also remove provider from multi-select when disabled
      updateAIProvider: (id, updates) =>
        set((state) => {
          const newProviders = state.aiProviders.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          );
          let newMultiIds = state.multiSelectProviderIds;
          if (updates.enabled === false && state.multiSelectProviderIds.includes(id)) {
            newMultiIds = state.multiSelectProviderIds.filter(pid => pid !== id);
          }
          return { aiProviders: newProviders, multiSelectProviderIds: newMultiIds };
        }),
    }),
    {
      name: 'ai-screenshot-settings-storage',
      version: 2,
      migrate: (persistedState: any, _version: number) => {
        const state = { ...persistedState };
        // v1→v2: migrate hotkeys from Ctrl+Shift to Ctrl+Alt
        if (state.hotkeys) {
          for (const key of ['fullScreen', 'region', 'toggleFloatBall'] as const) {
            if (state.hotkeys[key] && state.hotkeys[key].startsWith('Ctrl+Shift')) {
              state.hotkeys[key] = state.hotkeys[key].replace('Ctrl+Shift', 'Ctrl+Alt');
            }
          }
        }
        return state;
      },
    }
  )
);