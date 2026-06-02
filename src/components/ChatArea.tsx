import { useState, useRef, useEffect, useCallback } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { callAIStream, compressImage, callMultiAIStream, BRIEF_ANSWER_SYSTEM_PROMPT } from "@/utils/api";
import { cn } from "@/utils/cn";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { listen } from "@tauri-apps/api/event";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { Trash2, Camera, Send, Loader2, Image as ImageIcon, Copy, Check, Layers, Zap } from "lucide-react";

export default function ChatArea() {
  const {
    sessions, currentSessionId, isLoading, addMessage,
    createSession, clearSession, error, setError
  } = useChatStore();
  const settings = useSettingsStore();
  const [inputText, setInputText] = useState('');
  const [inputImage, setInputImage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const currentSession = sessions.find(s => s.id === currentSessionId);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentSession?.messages, isLoading]);

  // 监听来自 FloatBall 的跨窗口聊天同步事件（Rust emit_to）
  useEffect(() => {
    const unlisten = listen('float-ball-chat', (event) => {
      const { imageBase64, userMessage, aiResponse } = event.payload as {
        imageBase64?: string;
        userMessage: string;
        aiResponse: string;
      };
      useChatStore.getState().addChatFromFloatBall(imageBase64, userMessage, aiResponse);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    const hasImage = !!inputImage;

    if (!text && !hasImage) return;
    if (!currentSessionId) return;

    // Read settings from store to avoid recreating this callback on every setting change (fix #14)
    const _s = useSettingsStore.getState();
    const activeProvider = _s.aiProviders.find(p => p.id === _s.activeProviderId);
    if (!activeProvider?.apiKey) {
      setError('请先在设置中配置 AI 的 API Key');
      return;
    }

    setError(null);

    let messageContent = text || '请分析这张截图';

    // Compress image before sending
    let processedImage: string | undefined;
    if (inputImage) {
      processedImage = await compressImage(inputImage, 0.7, 1280);
    }

    addMessage(currentSessionId, {
      role: 'user',
      content: messageContent,
      imageData: inputImage || undefined,
    });

    setInputText('');
    setInputImage(null);

    try {
      addMessage(currentSessionId, {
        role: 'assistant',
        content: '',
      });

      const historyMessages = currentSession?.messages || [];
      const apiMessages = [
        ...historyMessages.map(m => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        { role: 'user' as const, content: messageContent },
      ];

      // Update the assistant message in store as chunks arrive
      const updateLastMessage = (text: string) => {
        useChatStore.getState().updateLastAssistantMessage(currentSessionId, { content: text });
      };

      if (_s.multiMode) {
        // Multi-model mode: call multiple providers in parallel
        const enabledProviders = _s.aiProviders
          .filter(p => _s.multiSelectProviderIds.includes(p.id))
          .filter(p => p.apiKey && p.baseUrl);

        if (enabledProviders.length === 0) {
          throw new Error('请至少为选中模型中的一个配置 API Key');
        }

        const agg: Record<string, { providerName: string; content: string; error?: string }> = {};

        await callMultiAIStream(
          enabledProviders,
          {
            messages: apiMessages,
            imageBase64: processedImage,
            maxTokens: 4096,
            systemPrompt: _s.briefAnswerMode ? BRIEF_ANSWER_SYSTEM_PROMPT : undefined,
          },
          {
            onProviderChunk: (id, text) => {
              agg[id] = { providerName: enabledProviders.find(p => p.id === id)?.name || id, content: text };
              useChatStore.getState().updateLastAssistantMessage(currentSessionId, {
                content: '多模型对比分析',
                multiResponses: { ...agg },
              });
            },
            onProviderDone: (id, result) => {
              agg[id] = { providerName: result.providerName, content: result.content, error: result.error };
            },
          }
        );

        // Final update
        useChatStore.getState().updateLastAssistantMessage(currentSessionId, {
          content: '多模型对比分析',
          multiResponses: { ...agg },
        });

        // Auto-copy first successful response
        if (_s.autoCopyToClipboard) {
          const firstOk = Object.values(agg).find(r => !r.error);
          if (firstOk) {
            try { await navigator.clipboard.writeText(firstOk.content); } catch {}
          }
        }
      } else {
        // Single provider mode (original flow)
        const response = await callAIStream({
          provider: activeProvider,
          messages: apiMessages,
          imageBase64: processedImage,
          maxTokens: 4096,
          onChunk: updateLastMessage,
          systemPrompt: _s.briefAnswerMode ? BRIEF_ANSWER_SYSTEM_PROMPT : undefined,
        });

        // Final update with complete response
        updateLastMessage(response);

        // Auto-copy AI response if enabled
        if (_s.autoCopyToClipboard) {
          try { await navigator.clipboard.writeText(response); } catch {}
        }
      }

      const sessions = useChatStore.getState().sessions;
      const session = sessions.find(s => s.id === currentSessionId);
      if (session && session.messages.length <= 2) {
        const title = text ? text.substring(0, 20) : '截图对话';
        useChatStore.getState().renameSession(currentSessionId, title);
      }
    } catch (err: any) {
      setError(err.message || '请求失败');
      useChatStore.setState(state => ({
        sessions: state.sessions.map(s =>
          s.id === currentSessionId
            ? { ...s, messages: s.messages.filter(m => m.content !== '') }
            : s
        ),
      }));
    }
  }, [inputText, inputImage, currentSessionId, currentSession, addMessage, setError]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        const file = items[i].getAsFile();
        if (file) {
          const reader = new FileReader();
          reader.onload = (ev) => {
            const base64 = (ev.target?.result as string)?.replace(/^data:image\/\w+;base64,/, '');
            setInputImage(base64);
          };
          reader.readAsDataURL(file);
        }
        break;
      }
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-white dark:bg-gray-900 min-w-0">
      {/* 顶栏 */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100/60 dark:border-gray-800/60 drag-region">
        <h2 className="text-sm font-semibold no-drag text-gray-700 dark:text-gray-200">
          {currentSession?.title || '新对话'}
        </h2>
        <div className="flex items-center gap-2 no-drag">
          {currentSession && currentSession.messages.length > 0 && (
            <button
              onClick={() => setClearConfirmOpen(true)}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-red-500 transition-colors"
              title="清空对话"
            >
              <Trash2 size={14} />
            </button>
          )}
          {settings.multiMode ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 font-medium">
              <Layers size={11} />
              {settings.multiSelectProviderIds.length} 模型对比
            </span>
          ) : settings.aiProviders.find(p => p.id === settings.activeProviderId)?.apiKey ? (
            <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              {settings.aiProviders.find(p => p.id === settings.activeProviderId)?.name || 'AI'} 已连接
            </span>
          ) : (
            <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
              未配置 API
            </span>
          )}
        </div>
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {currentSession?.messages.map((msg) => (
          <div key={msg.id} className="message-enter mb-4 group/msg">
            <div className={cn(
              'flex gap-3',
              msg.role === 'user' ? 'flex-row-reverse' : ''
            )}>
              {/* 头像 */}
              <div className={cn(
                'w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 text-xs font-bold',
                msg.role === 'user'
                  ? 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'
                  : 'text-white shadow-sm'
              )}
              style={msg.role === 'assistant' ? { backgroundColor: 'var(--color-primary)' } : {}}
              >
                {msg.role === 'user' ? '你' : 'AI'}
              </div>

              {/* 消息内容 */}
              <div className="max-w-[75%] relative">
                <div className={cn(
                  'rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                  msg.role === 'user'
                    ? 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 shadow-sm'
                    : 'text-gray-800 dark:text-gray-200'
                )}>
                  {msg.imageData && (
                    <img
                      src={`data:image/png;base64,${msg.imageData}`}
                      alt="截图"
                      className="max-w-[320px] max-h-[220px] rounded-lg mb-2 object-contain"
                    />
                  )}
                  {msg.role === 'assistant' ? (
                    msg.multiResponses && Object.keys(msg.multiResponses).length > 0 ? (
                      <div className="space-y-2">
                        {Object.entries(msg.multiResponses).map(([providerId, resp]) => {
                          const provider = settings.aiProviders.find(p => p.id === providerId);
                          return (
                            <div key={providerId} className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                              <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 dark:bg-gray-800">
                                <span className="text-xs font-medium text-gray-600 dark:text-gray-300">
                                  {provider?.name || providerId}
                                </span>
                                {resp.error && <span className="text-[10px] text-red-400">{resp.error}</span>}
                              </div>
                              <div className="p-2.5">
                                <div className="markdown-body prose prose-sm dark:prose-invert max-w-none text-[0.875rem]">
                                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                    {resp.content || (resp.error ? '请求失败' : '等待中...')}
                                  </ReactMarkdown>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="markdown-body prose prose-sm dark:prose-invert max-w-none text-[0.9375rem]">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {msg.content || '思考中...'}
                        </ReactMarkdown>
                      </div>
                    )
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
                {/* Copy button */}
                {msg.content && (
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(msg.content);
                      setCopiedId(msg.id);
                      setTimeout(() => setCopiedId(null), 2000);
                    }}
                    className={cn(
                      'absolute -bottom-2 opacity-0 group-hover/msg:opacity-100 transition-opacity p-1 rounded bg-white dark:bg-gray-700 shadow-sm border border-gray-200 dark:border-gray-600 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300',
                      msg.role === 'user' ? 'left-0' : 'right-0'
                    )}
                    title="复制"
                  >
                    {copiedId === msg.id ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex items-center gap-2 text-gray-400 dark:text-gray-400 text-sm px-2 mb-4">
            <Loader2 size={14} className="animate-spin" />
            <span>AI 正在思考...</span>
            <button
              onClick={() => {
                // Remove the empty assistant message and stop loading
                useChatStore.setState(state => ({
                  isLoading: false,
                  sessions: state.sessions.map(s =>
                    s.id === currentSessionId
                      ? { ...s, messages: s.messages.filter(m => m.content !== '') }
                      : s
                  ),
                }));
              }}
              className="ml-1 text-xs text-gray-400 hover:text-red-400 px-2 py-0.5 rounded border border-gray-200 dark:border-gray-600 hover:border-red-300 dark:hover:border-red-600 transition-colors"
            >
              停止
            </button>
          </div>
        )}

        {error && (
          <div className="p-3 mb-4 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm">
            {error}
            <button onClick={() => setError(null)} className="ml-2 underline text-red-500 hover:text-red-600">
              关闭
            </button>
          </div>
        )}

        {!currentSession || currentSession.messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4 opacity-20"
              style={{ backgroundColor: 'var(--color-primary)' }}>
              <Camera size={32} className="text-white" />
            </div>
            <p className="text-gray-400 dark:text-gray-500 text-sm mb-2">
              开始你的 AI 截图之旅
            </p>
            <p className="text-gray-300 dark:text-gray-600 text-xs">
              使用快捷键或悬浮球截图，AI 将自动分析
            </p>
            <div className="flex gap-2 mt-5">
              {['Ctrl+Alt+1 全屏截图', 'Ctrl+Alt+2 区域截图'].map((hint) => (
                <span key={hint} className="px-3 py-1.5 text-xs rounded-full bg-gray-50 dark:bg-gray-800 text-gray-400 dark:text-gray-500 border border-gray-200 dark:border-gray-700 font-mono">
                  {hint}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入区 */}
      <div className="p-4 border-t border-gray-100/60 dark:border-gray-800/60">
        {inputImage && (
          <div className="mb-3 relative inline-block">
            <img
              src={`data:image/png;base64,${inputImage}`}
              alt="待发送截图"
              className="max-w-[220px] max-h-[130px] rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm"
            />
            <button
              onClick={() => setInputImage(null)}
              className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 transition-colors shadow-sm"
            >
              ×
            </button>
          </div>
        )}

        {/* Brief answer + Multi-model controls */}
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <button
            onClick={() => settings.setBriefAnswerMode(!settings.briefAnswerMode)}
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-xs rounded-full border transition-all',
              settings.briefAnswerMode
                ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                : 'border-gray-200 dark:border-gray-600 text-gray-400 hover:border-gray-300'
            )}
            title="简要答题模式"
          >
            <Zap size={11} />
            简要模式
          </button>
          <button
            onClick={() => {
              settings.setMultiMode(!settings.multiMode);
            }}
            className={cn(
              'flex items-center gap-1 px-2 py-1 text-xs rounded-full border transition-all',
              settings.multiMode
                ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                : 'border-gray-200 dark:border-gray-600 text-gray-400 hover:border-gray-300'
            )}
            title="多模型对比"
          >
            <Layers size={11} />
            多模型
          </button>
        </div>
        {settings.multiMode && (
          <div className="flex flex-wrap gap-1 mb-2">
            {settings.aiProviders.filter(p => p.enabled).map(provider => (
              <button
                key={provider.id}
                onClick={() => settings.toggleMultiProvider(provider.id)}
                className={cn(
                  'px-2 py-0.5 text-xs rounded-full border transition-all',
                  settings.multiSelectProviderIds.includes(provider.id)
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-primary)]'
                    : 'border-gray-200 dark:border-gray-600 text-gray-400 hover:border-gray-300'
                )}
              >
                {provider.name}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <label className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors duration-150 flex-shrink-0 cursor-pointer"
            title="上传图片">
            <ImageIcon size={18} />
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    const base64 = (ev.target?.result as string)?.replace(/^data:image\/\w+;base64,/, '');
                    setInputImage(base64);
                  };
                  reader.readAsDataURL(file);
                }
              }}
            />
          </label>
          <button
            onClick={async () => {
              try {
                const base64: string = await window.__TAURI__.invoke('take_screenshot');
                setInputImage(base64);
              } catch (err: any) {
                setError(`截图失败: ${err.message || err}`);
              }
            }}
            className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors duration-150 flex-shrink-0"
            title="全屏截图"
          >
            <Camera size={18} />
          </button>
          <textarea
            ref={inputRef}
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              // Auto-resize textarea (fix #18)
              const el = e.target;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 120) + 'px';
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={inputImage ? '输入对截图的提问（可选）...' : '输入消息，或粘贴 / 拖入截图...'}
            rows={1}
            className="flex-1 resize-none px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-gray-50 dark:bg-gray-800 outline-none focus:border-[var(--color-primary)] focus:ring-2 focus:ring-[var(--color-primary)]/10 transition-all duration-150 text-gray-700 dark:text-gray-200 placeholder:text-gray-400"
            style={{ fontSize: `${settings.fontSize}px`, maxHeight: '120px' }}
          />
          <button
            onClick={handleSend}
            disabled={(!inputText.trim() && !inputImage) || isLoading}
            className="p-2.5 rounded-xl text-white flex-shrink-0 transition-all duration-150 disabled:opacity-30 disabled:cursor-not-allowed hover:scale-105 active:scale-95 shadow-sm"
            style={{ backgroundColor: 'var(--color-primary)' }}
            title="发送"
          >
            {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>
      {clearConfirmOpen && createPortal(
        <ConfirmDialog
          title="清空对话"
          message="确定清空当前对话吗？所有消息将被删除。"
          confirmLabel="清空"
          variant="danger"
          onConfirm={() => {
            clearSession(currentSession!.id);
            setClearConfirmOpen(false);
          }}
          onCancel={() => setClearConfirmOpen(false)}
        />,
        document.body
      )}
    </div>
  );
}