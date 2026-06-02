import { useState, useEffect } from "react";
import { useSettingsStore } from "@/stores/settingsStore";
import { cn } from "@/utils/cn";
import { presetColors } from "@/utils/theme";
import { testProviderConnection } from "@/utils/api";
import { Camera, Loader2, Zap } from "lucide-react";

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const settings = useSettingsStore();
  const [activeTab, setActiveTab] = useState<'api' | 'hotkeys' | 'appearance' | 'general'>('api');
  const [recordingKey, setRecordingKey] = useState<string | null>(null);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; message: string }>>({});
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);

  // Escape key to close settings (but not while recording hotkeys)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !recordingKey) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, recordingKey]);

  // Check auto-start status from registry on mount
  useEffect(() => {
    if (window.__TAURI__) {
      window.__TAURI__.invoke<boolean>('is_auto_start_enabled')
        .then((enabled) => setAutoStartEnabled(enabled))
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!recordingKey) return;
      e.preventDefault();
      e.stopPropagation();

      // Ignore standalone modifier presses; wait for the full combo
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;

      // Cancel on Escape - re-register current hotkeys
      if (e.key === 'Escape') {
        setRecordingKey(null);
        if (window.__TAURI__) {
          window.__TAURI__.invoke('update_hotkeys', {
            hotkeys: {
              full_screen: settings.hotkeys.fullScreen,
              region: settings.hotkeys.region,
              toggle_float_ball: settings.hotkeys.toggleFloatBall,
            },
          }).catch(() => {});
          window.__TAURI__.invoke('set_hotkeys_paused', { paused: false }).catch(() => {});
        }
        return;
      }

      const keys: string[] = [];
      if (e.ctrlKey) keys.push('Ctrl');
      if (e.altKey) keys.push('Alt');
      if (e.shiftKey) keys.push('Shift');
      if (e.metaKey) keys.push('Win');

      const keyName = e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
      keys.push(keyName);

      settings.setHotkey(recordingKey as keyof typeof settings.hotkeys, keys.join('+'));
      setRecordingKey(null);
      // Unpause after new hotkey is registered
      if (window.__TAURI__) {
        window.__TAURI__.invoke('set_hotkeys_paused', { paused: false }).catch(() => {});
      }
    };

    if (recordingKey) {
      window.addEventListener('keydown', handleKeyDown, true);
      return () => window.removeEventListener('keydown', handleKeyDown, true);
    }
  }, [recordingKey, settings]);


  // API 连通性测试 - use centralized function
  const handleTestConnection = async (providerId: string) => {
    const provider = settings.aiProviders.find(p => p.id === providerId);
    if (!provider) return;

    setTestingProviderId(providerId);
    setTestResults(prev => ({ ...prev, [providerId]: { ok: false, message: '' } }));

    const result = await testProviderConnection(provider);
    setTestResults(prev => ({ ...prev, [providerId]: result }));
    setTestingProviderId(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}
      style={{ backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)' }}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-[700px] max-w-[95vw] max-h-[90vh] flex flex-col border border-gray-200/40 dark:border-gray-700/40 overflow-hidden"
        onClick={(e) => e.stopPropagation()}>
        {/* 标题栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700 drag-region flex-shrink-0">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100 no-drag">设置</h2>
          <button onClick={onClose} className="no-drag p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors duration-150">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 标签页 */}
        <div className="flex border-b border-gray-200 dark:border-gray-700 px-6 gap-1 flex-shrink-0">
          {[
            { key: 'api', label: 'AI 配置' },
            { key: 'hotkeys', label: '快捷键' },
            { key: 'appearance', label: '外观' },
            { key: 'general', label: '通用' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={cn(
                'py-3 px-1 text-sm border-b-2 transition-all duration-150 -mb-px',
                activeTab === tab.key
                  ? 'border-[var(--color-primary)] text-[var(--color-primary)] font-semibold'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* 内容区 */}
        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'api' && (
            <div className="space-y-4">
              {settings.aiProviders.map((provider) => (
                <div key={provider.id} className="p-4 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-700 card-modern">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">{provider.name}</span>
                      <span className="text-xs text-gray-400">{provider.baseUrl}</span>
                    </div>
                    <button
                      onClick={() => settings.setActiveProvider(provider.id)}
                      className={cn(
                        'px-3 py-1 text-xs rounded-full transition-all duration-150',
                        settings.activeProviderId === provider.id
                          ? 'text-white shadow-sm'
                          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                      )}
                      style={settings.activeProviderId === provider.id ? { backgroundColor: 'var(--color-primary)' } : {}}
                    >
                      {settings.activeProviderId === provider.id ? '当前使用' : '启用'}
                    </button>
                  </div>
                  <div className="space-y-2">
                    <input
                      type="password"
                      placeholder="输入 API Key..."
                      value={provider.apiKey}
                      onChange={(e) => { settings.updateAIProvider(provider.id, { apiKey: e.target.value }); setTestResults(prev => { const n = {...prev}; delete n[provider.id]; return n; }); }}
                      className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/10 transition-all duration-150 text-gray-800 dark:text-gray-100 placeholder:text-gray-400"
                    />
                    {provider.id === 'custom' ? (
                      <div className="grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          placeholder="API 地址"
                          value={provider.baseUrl}
                          onChange={(e) => { settings.updateAIProvider(provider.id, { baseUrl: e.target.value }); setTestResults(prev => { const n = {...prev}; delete n[provider.id]; return n; }); }}
                          className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/10 transition-all duration-150 text-gray-800 dark:text-gray-100 placeholder:text-gray-400"
                        />
                        <input
                          type="text"
                          placeholder="模型名称"
                          value={provider.model}
                          onChange={(e) => settings.updateAIProvider(provider.id, { model: e.target.value })}
                          className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/10 transition-all duration-150 text-gray-800 dark:text-gray-100 placeholder:text-gray-400"
                        />
                      </div>
                    ) : (
                      <input
                        type="text"
                        placeholder="模型名称"
                        value={provider.model}
                        onChange={(e) => settings.updateAIProvider(provider.id, { model: e.target.value })}
                        className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/10 transition-all duration-150 text-gray-800 dark:text-gray-100 placeholder:text-gray-400"
                      />
                    )}
                    {/* API 连通性测试按钮与结果 */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleTestConnection(provider.id)}
                        disabled={testingProviderId === provider.id}
                        className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                      >
                        {testingProviderId === provider.id ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : null}
                        测试连接
                      </button>
                      {testResults[provider.id] && (
                        <span className={cn(
                          'text-xs',
                          testResults[provider.id].ok ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'
                        )}>
                          {testResults[provider.id].ok ? '连接成功' : testResults[provider.id].message}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'hotkeys' && (
            <div className="space-y-3">
              {[
                { key: 'fullScreen', label: '全屏截图', icon: <Camera size={15} /> },
                { key: 'region', label: '区域截图', icon: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M3 9h18"/></svg> },
                { key: 'toggleFloatBall', label: '显示/隐藏悬浮球', icon: <Zap size={15} /> },
              ].map(({ key, label, icon }) => (
                <div key={key} className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-700 card-modern">
                  <div className="flex items-center gap-3">
                    <span className="text-gray-400">{icon}</span>
                    <span className="text-sm text-gray-700 dark:text-gray-200">{label}</span>
                  </div>
                  <button
                    onClick={() => {
                      // Pause global hotkeys BEFORE setting recording state
                      if (window.__TAURI__) {
                        window.__TAURI__.invoke('set_hotkeys_paused', { paused: true }).catch(() => {});
                      }
                      setRecordingKey(key);
                    }}
                    className={cn(
                      'px-4 py-1.5 text-sm rounded-lg border transition-all duration-150 font-mono min-w-[120px]',
                      recordingKey === key
                        ? 'border-[var(--color-primary)] text-[var(--color-primary)] bg-[var(--color-primary)]/10 animate-pulse'
                        : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500'
                    )}
                  >
                    {recordingKey === key ? '按下按键...' : (settings.hotkeys as any)[key]}
                  </button>
                </div>
              ))}
              <p className="text-xs text-gray-400 mt-2">
                点击按钮后按下想要的组合键即可录制
              </p>
            </div>
          )}

          {activeTab === 'appearance' && (
            <div className="space-y-6">
              {/* Theme Color Picker - Fixed (#7) */}
              <div>
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 block">主题色</label>
                <div className="flex gap-3 flex-wrap items-center">
                  {presetColors.map((color) => (
                    <button
                      key={color}
                      onClick={() => settings.setThemeColor(color)}
                      className={cn(
                        'color-picker-circle',
                        settings.themeColor === color && 'active'
                      )}
                      style={{
                        backgroundColor: color,
                        ['--circle-color' as any]: color,
                      }}
                      title={color}
                    />
                  ))}
                  <div className="relative">
                    <input
                      type="color"
                      value={settings.themeColor}
                      onChange={(e) => settings.setThemeColor(e.target.value)}
                      title="自定义颜色"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 block">字体大小</label>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">A-</span>
                  <input
                    type="range"
                    min="13"
                    max="18"
                    value={settings.fontSize}
                    onChange={(e) => settings.setFontSize(Number(e.target.value))}
                    className="flex-1"
                    style={{ accentColor: 'var(--color-primary)' }}
                  />
                  <span className="text-xs text-gray-400">A+</span>
                  <span className="text-sm font-medium w-10 text-center text-gray-700 dark:text-gray-200">{settings.fontSize}px</span>
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 block">悬浮球大小</label>
                <input
                  type="range"
                  min="40"
                  max="72"
                  value={settings.floatBallSize}
                  onChange={(e) => settings.setFloatBallSize(Number(e.target.value))}
                  className="w-full"
                  style={{ accentColor: 'var(--color-primary)' }}
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>小</span>
                  <span>大</span>
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 block">悬浮球透明度</label>
                <input
                  type="range"
                  min="30"
                  max="100"
                  value={Math.round(settings.floatBallOpacity * 100)}
                  onChange={(e) => settings.setFloatBallOpacity(Number(e.target.value) / 100)}
                  className="w-full"
                  style={{ accentColor: 'var(--color-primary)' }}
                />
              </div>

              <div>
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 block">悬浮球面板宽度</label>
                <input
                  type="range"
                  min="280"
                  max="600"
                  value={settings.floatBallPanelWidth}
                  onChange={(e) => settings.setFloatBallPanelWidth(Number(e.target.value))}
                  className="w-full"
                  style={{ accentColor: 'var(--color-primary)' }}
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>280px</span>
                  <span>{settings.floatBallPanelWidth}px</span>
                  <span>600px</span>
                </div>
              </div>

              <div>
                <label className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 block">悬浮球面板高度</label>
                <input
                  type="range"
                  min="360"
                  max="700"
                  value={settings.floatBallPanelHeight}
                  onChange={(e) => settings.setFloatBallPanelHeight(Number(e.target.value))}
                  className="w-full"
                  style={{ accentColor: 'var(--color-primary)' }}
                />
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>360px</span>
                  <span>{settings.floatBallPanelHeight}px</span>
                  <span>700px</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'general' && (
            <div className="space-y-3">
              {/* Float Ball Toggle - New (#5) */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-700 card-modern">
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">启用悬浮球</p>
                  <p className="text-xs text-gray-400 dark:text-gray-400">最小化或关闭窗口时显示悬浮球</p>
                </div>
                <button
                  onClick={() => settings.setFloatBallEnabled(!settings.floatBallEnabled)}
                  className={cn(
                    'toggle-switch',
                    settings.floatBallEnabled ? 'on' : 'off'
                  )}
                  style={settings.floatBallEnabled ? { backgroundColor: 'var(--color-primary)' } : { backgroundColor: '#d1d5db' }}
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-700 card-modern">
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">开机自启动</p>
                  <p className="text-xs text-gray-400 dark:text-gray-400">系统启动时自动运行 AI 截屏</p>
                </div>
                <button
                  onClick={async () => {
                    const newState = !autoStartEnabled;
                    try {
                      await window.__TAURI__.invoke('set_auto_start', { enabled: newState });
                      setAutoStartEnabled(newState);
                      settings.setAutoStart(newState);
                    } catch (err: any) {
                      console.error('设置自启动失败:', err);
                    }
                  }}
                  className={cn(
                    'toggle-switch',
                    autoStartEnabled ? 'on' : 'off'
                  )}
                  style={autoStartEnabled ? { backgroundColor: 'var(--color-primary)' } : { backgroundColor: '#d1d5db' }}
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-700 card-modern">
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">截图后自动复制</p>
                  <p className="text-xs text-gray-400 dark:text-gray-400">截图后自动复制到剪贴板</p>
                </div>
                <button
                  onClick={() => settings.setAutoCopyToClipboard(!settings.autoCopyToClipboard)}
                  className={cn(
                    'toggle-switch',
                    settings.autoCopyToClipboard ? 'on' : 'off'
                  )}
                  style={settings.autoCopyToClipboard ? { backgroundColor: 'var(--color-primary)' } : { backgroundColor: '#d1d5db' }}
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-700 card-modern">
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">保存截图到本地</p>
                  <p className="text-xs text-gray-400 dark:text-gray-400">自动保存所有截图</p>
                </div>
                <button
                  onClick={() => settings.setSaveScreenshots(!settings.saveScreenshots)}
                  className={cn(
                    'toggle-switch',
                    settings.saveScreenshots ? 'on' : 'off'
                  )}
                  style={settings.saveScreenshots ? { backgroundColor: 'var(--color-primary)' } : { backgroundColor: '#d1d5db' }}
                />
              </div>

              <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-700 card-modern">
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-200">截图质量</p>
                  <p className="text-xs text-gray-400 dark:text-gray-400">影响图片大小和清晰度</p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min="50"
                    max="100"
                    value={settings.screenshotQuality}
                    onChange={(e) => settings.setScreenshotQuality(Number(e.target.value))}
                    className="w-24"
                    style={{ accentColor: 'var(--color-primary)' }}
                  />
                  <span className="text-sm font-medium w-10 text-center text-gray-700 dark:text-gray-200">{settings.screenshotQuality}%</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Version footer */}
        <div className="px-6 py-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between flex-shrink-0">
          <span className="text-xs text-gray-400">AI 截屏 v1.0.0</span>
          <span className="text-xs text-gray-400">基于 Tauri + React</span>
        </div>
      </div>
    </div>
  );
}
