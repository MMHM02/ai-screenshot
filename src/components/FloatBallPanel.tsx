import { useState, useEffect, useCallback, useRef } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { callAIStream, compressImage, callMultiAIStream, BRIEF_ANSWER_SYSTEM_PROMPT } from '@/utils/api';
import type { MultiAIResult } from '@/utils/api';
import { waitForHydration } from '@/utils/hydration';
import { Camera, X, Maximize2, Crop, MessageSquare, Loader2, Copy, Check, Square, Zap, Layers, ChevronDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { WebviewWindow, appWindow, PhysicalPosition } from '@tauri-apps/api/window';
import { listen } from '@tauri-apps/api/event';
import { cn } from '@/utils/cn';

export default function FloatBallPanel() {
  const settings = useSettingsStore();
  const [isPickerOpen, setIsPickerOpen] = useState(true);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [aiResponse, setAiResponse] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [screenshotBase64, setScreenshotBase64] = useState<string | null>(null);
  const [pendingImageBase64, setPendingImageBase64] = useState<string | null>(null);
  const [userMessage, setUserMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Multi-model state
  const [multiMode, setMultiMode] = useState(false);
  const [briefMode, setBriefMode] = useState(false);
  const [selectedProviders, setSelectedProviders] = useState<string[]>([settings.activeProviderId]);
  const [multiResponses, setMultiResponses] = useState<Record<string, string>>({});
  const [multiErrors, setMultiErrors] = useState<Record<string, string>>({});
  const [multiLoading, setMultiLoading] = useState<Record<string, boolean>>({});

  // Sync multi-mode state from settings
  useEffect(() => {
    if (!hydrated) return;
    setMultiMode(settings.multiMode);
    setBriefMode(settings.briefAnswerMode);
    if (settings.multiSelectProviderIds.length > 0) {
      setSelectedProviders(settings.multiSelectProviderIds);
    }
  }, [hydrated, settings.multiMode, settings.briefAnswerMode, settings.multiSelectProviderIds]);

  // Restore saved panel position from persisted settings on mount (fix #8)
  useEffect(() => {
    if (!hydrated) return;
    const saved = settings.floatBallPanelPosition;
    if (saved && saved.x > 0 && saved.y > 0) {
      appWindow.setPosition(new PhysicalPosition(saved.x, saved.y)).catch(() => {});
      // Sync to Rust in-memory state as well
      window.__TAURI__.invoke('save_float_ball_panel_position', { x: saved.x, y: saved.y }).catch(() => {});
    }
  }, [hydrated]);

  // Wait for zustand persist hydration
  useEffect(() => {
    const unsub = useSettingsStore.persist.onFinishHydration(() => setHydrated(true));
    if (useSettingsStore.persist.hasHydrated()) setHydrated(true);
    const timeout = setTimeout(() => setHydrated(true), 3000);
    return () => { unsub(); clearTimeout(timeout); };
  }, []);

  const captureFullScreen = useCallback(async (): Promise<string> => {
    try {
      return await window.__TAURI__.invoke('take_screenshot');
    } catch (e: any) {
      throw new Error(`截图失败: ${e.message || e}`);
    }
  }, []);

  // Stop generating
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsLoading(false);
    // Clear partial multi-mode results on stop (fix #5)
    setMultiResponses({});
    setMultiErrors({});
    setMultiLoading({});
  }, []);

  // Send to AI with streaming
  const sendToAI = useCallback(async (imageBase64: string, extraMessage?: string) => {
    await waitForHydration();

    const activeProvider = settings.aiProviders.find(p => p.id === settings.activeProviderId);
    if (!activeProvider?.apiKey) throw new Error('请先在设置中配置 AI API Key');

    const userText = extraMessage || '请分析这张截图';

    // Compress image for faster upload
    const compressedImage = await compressImage(imageBase64, 0.7, 1280);

    const abort = new AbortController();
    abortRef.current = abort;

    setAiResponse('');
    setIsChatOpen(true);
    setIsLoading(true);

    try {
      const response = await callAIStream({
        provider: activeProvider,
        messages: [{ role: 'user', content: userText }],
        imageBase64: compressedImage,
        userText,
        maxTokens: 1024,
        signal: abort.signal,
        onChunk: (text) => setAiResponse(text),
      });

      setAiResponse(response);

      // Auto-copy to clipboard
      if (settings.autoCopyToClipboard) {
        try { await navigator.clipboard.writeText(response); } catch {}
      }

      // Sync to main window
      useChatStore.getState().addChatFromFloatBall(imageBase64, userText, response);
      window.__TAURI__.invoke('sync_float_ball_chat', {
        imageBase64, userMessage: userText, aiResponse: response,
      }).catch(() => {});
    } catch (error: any) {
      if (error.name !== 'AbortError' && error.message !== '请求超时，请检查网络连接') {
        setAiResponse(prev => prev || `处理失败: ${error.message}`);
        setErrorMessage(error.message);
      }
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }, [settings, hydrated]);

  // Send to multiple AI providers simultaneously
  const sendToMultiAI = useCallback(async (imageBase64: string, extraMessage?: string) => {
    await waitForHydration();

    const enabledProviders = settings.aiProviders
      .filter(p => selectedProviders.includes(p.id))
      .filter(p => p.apiKey && p.baseUrl);

    if (enabledProviders.length === 0) {
      throw new Error('请至少为选中模型中的一个配置 API Key');
    }

    const userText = extraMessage || '请分析这张截图';
    const compressedImage = await compressImage(imageBase64, 0.7, 1280);

    // Initialize state for each provider
    const initial: Record<string, string> = {};
    const loading: Record<string, boolean> = {};
    for (const p of enabledProviders) {
      initial[p.id] = '';
      loading[p.id] = true;
    }
    setMultiResponses(initial);
    setMultiErrors({});
    setMultiLoading(loading);
    setAiResponse(null);
    setIsChatOpen(true);
    setIsLoading(true);

    // Create abort controller for multi-model cancellation (fix #5)
    const abort = new AbortController();
    abortRef.current = abort;

    const results = await callMultiAIStream(
      enabledProviders,
      {
        messages: [{ role: 'user', content: userText }],
        imageBase64: compressedImage,
        userText,
        maxTokens: 1024,
        systemPrompt: briefMode ? BRIEF_ANSWER_SYSTEM_PROMPT : undefined,
        signal: abort.signal,
      },
      {
        onProviderChunk: (id, text) => {
          setMultiResponses(prev => ({ ...prev, [id]: text }));
        },
        onProviderDone: (id, result) => {
          setMultiLoading(prev => ({ ...prev, [id]: false }));
          if (result.error) {
            setMultiErrors(prev => ({ ...prev, [id]: result.error! }));
          }
        },
      }
    );

    setIsLoading(false);

    // Sync to chat store
    const responseMap: Record<string, { providerName: string; content: string; error?: string }> = {};
    for (const r of results) {
      responseMap[r.providerId] = { providerName: r.providerName, content: r.content, error: r.error };
    }
    useChatStore.getState().addChatFromFloatBall(imageBase64, userText, '', responseMap);
    window.__TAURI__.invoke('sync_float_ball_chat', {
      imageBase64, userMessage: userText, aiResponse: '',
    }).catch(() => {});
  }, [settings, hydrated, briefMode, selectedProviders]);

  const handleFullScreenshot = useCallback(async () => {
    setIsPickerOpen(false);
    setErrorMessage(null);
    setIsLoading(true);
    try {
      const base64 = await captureFullScreen();
      setScreenshotBase64(base64);
      if (multiMode) {
        await sendToMultiAI(base64);
      } else {
        await sendToAI(base64);
      }
    } catch (error: any) {
      setAiResponse(`截图失败: ${error.message}`);
      setErrorMessage(error.message);
      setIsChatOpen(true);
    } finally {
      setIsLoading(false);
    }
  }, [captureFullScreen, sendToAI, sendToMultiAI, multiMode]);

  const handleRegionScreenshot = useCallback(async () => {
    setIsPickerOpen(false);
    setIsChatOpen(false);
    setErrorMessage(null);
    try {
      await window.__TAURI__.invoke('hide_float_ball_panel');
      // Wait for panel to fully hide before capture (fix #15: increased from 150ms for reliability)
      await new Promise(resolve => setTimeout(resolve, 300));
      const base64 = await captureFullScreen();
      setScreenshotBase64(base64);
      await window.__TAURI__.invoke('show_crop_overlay', { imageBase64: base64 });
    } catch (error: any) {
      await window.__TAURI__.invoke('show_float_ball_panel');
      setAiResponse(`截图失败: ${error.message}`);
      setErrorMessage(error.message);
      setIsChatOpen(true);
    }
  }, [captureFullScreen]);

  // Listen for hotkey-triggered screenshots
  useEffect(() => {
    const unlisten = listen('trigger-screenshot', (event) => {
      const payload = event.payload as { type: string };
      if (payload.type === 'fullScreen') handleFullScreenshot();
      else if (payload.type === 'region') handleRegionScreenshot();
    });
    return () => { unlisten.then(f => f()); };
  }, [handleFullScreenshot, handleRegionScreenshot]);

  // Listen for crop result
  useEffect(() => {
    const unlisten = listen('crop-result', async (event) => {
      const croppedBase64 = event.payload as string;
      setScreenshotBase64(croppedBase64);
      setPendingImageBase64(croppedBase64);
      setIsLoading(false);
      await window.__TAURI__.invoke('show_float_ball_panel');
    });
    return () => { unlisten.then(f => f()); };
  }, [sendToAI]);

  // Escape to close
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isLoading) handleStop();
        else await window.__TAURI__.invoke('hide_float_ball_panel');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isLoading, handleStop]);

  const handleClose = useCallback(async () => {
    if (isLoading) handleStop();
    await window.__TAURI__.invoke('hide_float_ball_panel');
  }, [isLoading, handleStop]);

  const handleCopy = useCallback(async () => {
    if (!aiResponse) return;
    try {
      await navigator.clipboard.writeText(aiResponse);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }, [aiResponse]);

  const resetToPicker = useCallback(() => {
    handleStop();
    setAiResponse(null);
    setErrorMessage(null);
    setScreenshotBase64(null);
    setPendingImageBase64(null);
    setUserMessage('');
    setIsChatOpen(false);
    setIsPickerOpen(true);
    setCopied(false);
    setMultiResponses({});
    setMultiErrors({});
    setMultiLoading({});
  }, [handleStop]);

  const ballOpacity = settings.floatBallOpacity;

  return (
    <div className="w-full h-full bg-white dark:bg-gray-800 rounded-2xl overflow-hidden flex flex-col"
      style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.22), 0 2px 8px rgba(0,0,0,0.12)' }}>

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-3 border-b border-gray-100 dark:border-gray-700 drag-region" data-tauri-drag-region
        onMouseUp={() => {
          // Save panel position after user drags it, so it reopens here next time
          appWindow.outerPosition().then(pos => {
            window.__TAURI__.invoke('save_float_ball_panel_position', { x: pos.x, y: pos.y }).catch(() => {});
            // Also persist to settings for survival across restarts (fix #8)
            useSettingsStore.getState().setFloatBallPanelPosition({ x: pos.x, y: pos.y });
          }).catch(() => {});
        }}>
        <div className="no-drag flex-shrink-0 rounded-full flex items-center justify-center"
          style={{ width: '36px', height: '36px', opacity: ballOpacity, background: 'var(--color-primary)' }}>
          <div className="text-white">
            {isLoading ? <Loader2 size={16} className="animate-spin" />
              : isChatOpen ? <MessageSquare size={16} />
              : <Camera size={16} />}
          </div>
        </div>
        <span className="text-sm font-semibold text-gray-800 dark:text-gray-100 no-drag">
          {isChatOpen ? 'AI 分析' : isLoading ? '处理中' : 'AI 截屏'}
        </span>
        <div className="flex-1" />
        {isLoading && (
          <button onClick={handleStop}
            className="no-drag p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500 transition-colors" title="停止">
            <Square size={14} fill="currentColor" />
          </button>
        )}
        <button onClick={handleClose}
          className="no-drag p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* Screenshot picker */}
        {isPickerOpen && !isChatOpen && !pendingImageBase64 && !isLoading && !errorMessage && (
          <div className="p-4">
            <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-4 text-center">选择截图方式</div>
            <div className="space-y-2">
              <button onClick={handleFullScreenshot}
                className="flex items-center gap-3 w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40 text-gray-700 dark:text-gray-200 transition-colors">
                <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
                  <Maximize2 size={17} className="text-blue-500" />
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium">全屏截图</div>
                  <div className="text-xs text-gray-400">截取整个屏幕 · {settings.hotkeys.fullScreen}</div>
                </div>
              </button>
              <button onClick={handleRegionScreenshot}
                className="flex items-center gap-3 w-full px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/40 text-gray-700 dark:text-gray-200 transition-colors">
                <div className="w-9 h-9 rounded-lg bg-green-50 dark:bg-green-900/30 flex items-center justify-center">
                  <Crop size={17} className="text-green-500" />
                </div>
                <div className="text-left">
                  <div className="text-sm font-medium">区域截图</div>
                  <div className="text-xs text-gray-400">选择特定区域 · {settings.hotkeys.region}</div>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Loading (no response yet) */}
        {isLoading && !aiResponse && Object.keys(multiResponses).length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 size={24} className="animate-spin text-gray-400 dark:text-gray-500" />
            <span className="text-sm text-gray-400 dark:text-gray-500">AI 正在分析...</span>
          </div>
        )}

        {/* Error */}
        {errorMessage && !isLoading && !isChatOpen && (
          <div className="p-4">
            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3">
              <div className="text-sm font-medium text-red-700 dark:text-red-400 mb-1">操作失败</div>
              <div className="text-sm text-red-600 dark:text-red-300">{errorMessage}</div>
              <button onClick={resetToPicker}
                className="mt-2 text-sm font-medium text-red-600 dark:text-red-400 hover:text-red-700 transition-colors">重试</button>
            </div>
          </div>
        )}

        {/* Pending screenshot */}
        {pendingImageBase64 && !isChatOpen && !isLoading && (
          <div className="p-4">
            <div className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">截图已就绪</div>
            <div className="flex items-center gap-3 mb-3">
              <img src={`data:image/png;base64,${pendingImageBase64}`} alt="截图预览"
                className="w-16 h-16 rounded-lg border border-gray-200 dark:border-gray-700 object-cover" />
              <input type="text" value={userMessage} onChange={(e) => setUserMessage(e.target.value)}
                placeholder="添加分析说明（可选）"
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/40 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const msg = userMessage; const img = pendingImageBase64!;
                    setPendingImageBase64(null); setUserMessage('');
                    const fn = multiMode ? sendToMultiAI : sendToAI;
                    fn(img, msg || undefined).catch(err => {
                      setAiResponse(`处理失败: ${err.message}`); setErrorMessage(err.message); setIsChatOpen(true);
                    });
                  }
                }} />
            </div>

            {/* Brief answer mode + Multi-model toggles */}
            <div className="space-y-2 mb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Zap size={13} className="text-gray-400" />
                  <span className="text-xs text-gray-500 dark:text-gray-400">简要答题模式</span>
                </div>
                <button
                  onClick={() => {
                    const next = !briefMode;
                    setBriefMode(next);
                    settings.setBriefAnswerMode(next);
                  }}
                  className={briefMode ? 'toggle-switch on' : 'toggle-switch off'}
                  style={briefMode ? { backgroundColor: 'var(--color-primary)' } : { backgroundColor: '#d1d5db' }}
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Layers size={13} className="text-gray-400" />
                  <span className="text-xs text-gray-500 dark:text-gray-400">多模型对比</span>
                </div>
                <button
                  onClick={() => {
                    const next = !multiMode;
                    setMultiMode(next);
                    settings.setMultiMode(next);
                    if (next && selectedProviders.length === 0) {
                      const first = settings.aiProviders.find(p => p.enabled);
                      if (first) {
                        setSelectedProviders([first.id]);
                        settings.toggleMultiProvider(first.id);
                      }
                    }
                  }}
                  className={multiMode ? 'toggle-switch on' : 'toggle-switch off'}
                  style={multiMode ? { backgroundColor: 'var(--color-primary)' } : { backgroundColor: '#d1d5db' }}
                />
              </div>
              {multiMode && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {settings.aiProviders.filter(p => p.enabled).map(provider => (
                    <button
                      key={provider.id}
                      onClick={() => {
                        const next = selectedProviders.includes(provider.id)
                          ? selectedProviders.filter(id => id !== provider.id)
                          : [...selectedProviders, provider.id];
                        setSelectedProviders(next);
                        settings.toggleMultiProvider(provider.id);
                      }}
                      className={cn(
                        'px-2.5 py-1 text-xs rounded-full border transition-all',
                        selectedProviders.includes(provider.id)
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                          : 'border-gray-200 dark:border-gray-600 text-gray-400 hover:border-gray-300'
                      )}
                    >
                      {provider.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button onClick={() => {
                const msg = userMessage; const img = pendingImageBase64!;
                setPendingImageBase64(null); setUserMessage('');
                const fn = multiMode ? sendToMultiAI : sendToAI;
                fn(img, msg || undefined).catch(err => {
                  setAiResponse(`处理失败: ${err.message}`); setErrorMessage(err.message); setIsChatOpen(true);
                });
              }} className="flex-1 px-4 py-2 text-sm font-medium rounded-lg text-white transition-colors"
                style={{ background: 'var(--color-primary)' }}>发送分析</button>
              <button onClick={resetToPicker}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-50 transition-colors">取消</button>
            </div>
          </div>
        )}

        {/* Multi-AI response display */}
        {isChatOpen && multiMode && Object.keys(multiResponses).length > 0 && (
          <div className="p-4 space-y-2">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">
              多模型分析结果 {isLoading && <Loader2 size={12} className="inline animate-spin ml-2 text-gray-400" />}
            </div>
            {screenshotBase64 && (
              <img src={`data:image/png;base64,${screenshotBase64}`} alt="截图"
                className="max-w-full max-h-[100px] rounded-lg mb-2 object-contain border border-gray-200 dark:border-gray-700" />
            )}
            {settings.aiProviders.filter(p => selectedProviders.includes(p.id)).map((provider, idx) => (
              <MultiProviderCard
                key={provider.id}
                provider={provider}
                content={multiResponses[provider.id] || ''}
                error={multiErrors[provider.id]}
                loading={multiLoading[provider.id]}
                defaultExpanded={idx === 0}
              />
            ))}
          </div>
        )}

        {/* AI response (streaming or complete) */}
        {isChatOpen && !multiMode && aiResponse !== null && (
          <div className="p-4">
            <div className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-3">
              AI 分析结果 {isLoading && <Loader2 size={12} className="inline animate-spin ml-2 text-gray-400" />}
            </div>
            {screenshotBase64 && (
              <img src={`data:image/png;base64,${screenshotBase64}`} alt="截图"
                className="max-w-full max-h-[120px] rounded-lg mb-3 object-contain border border-gray-200 dark:border-gray-700" />
            )}
            <div className="markdown-body prose prose-sm dark:prose-invert max-w-none text-sm">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {aiResponse || (isLoading ? '思考中...' : '')}
              </ReactMarkdown>
            </div>
          </div>
        )}
      </div>

      {/* Bottom bar */}
      {isChatOpen && (aiResponse || Object.keys(multiResponses).length > 0) && (
        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between flex-shrink-0">
          <button onClick={handleCopy}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 transition-colors">
            {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
            {copied ? '已复制' : '复制'}
          </button>
          <button onClick={resetToPicker}
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 transition-colors">再次截图</button>
          <button onClick={() => {
            const mainWin = WebviewWindow.getByLabel('main');
            if (mainWin) { mainWin.show(); mainWin.unminimize(); mainWin.setFocus(); }
          }} className="text-xs font-medium transition-colors"
            style={{ color: 'var(--color-primary)' }}>打开主窗口</button>
        </div>
      )}
    </div>
  );
}

// Multi-provider collapsible comparison card
function MultiProviderCard({ provider, content, error, loading, defaultExpanded }: {
  provider: { id: string; name: string };
  content: string;
  error?: string;
  loading: boolean;
  defaultExpanded: boolean;
}) {
  const [collapsed, setCollapsed] = useState(!defaultExpanded);

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center justify-between w-full px-3 py-2 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-750 transition-colors"
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{provider.name}</span>
          {loading && <Loader2 size={10} className="animate-spin text-gray-400" />}
          {error && <span className="text-[10px] text-red-500">错误</span>}
          {!loading && !error && content && (
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
          )}
        </div>
        <ChevronDown size={12} className={cn(
          'text-gray-400 transition-transform',
          !collapsed && 'rotate-180'
        )} />
      </button>
      {!collapsed && (
        <div className="p-3 text-sm">
          {error && !content ? (
            <div className="text-red-500 dark:text-red-400 text-xs">{error}</div>
          ) : loading && !content ? (
            <div className="text-gray-400 text-xs">等待响应...</div>
          ) : (
            <div className="markdown-body prose prose-sm dark:prose-invert max-w-none text-xs">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
