import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  imageData?: string; // base64
  model?: string;
  source?: 'main' | 'float-ball'; // 消息来源
  /** Multi-provider responses: providerId -> { providerName, content, error } */
  multiResponses?: Record<string, { providerName: string; content: string; error?: string }>;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
  model: string;
  source?: 'main' | 'float-ball'; // 会话来源
}

interface ChatStore {
  sessions: ChatSession[];
  currentSessionId: string | null;
  isLoading: boolean;
  error: string | null;
  
  // Actions
  initChats: () => void;
  createSession: (title?: string, source?: 'main' | 'float-ball') => string;
  deleteSession: (sessionId: string) => void;
  renameSession: (sessionId: string, newTitle: string) => void;
  setCurrentSession: (sessionId: string) => void;
  addMessage: (sessionId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>) => void;
  clearSession: (sessionId: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  /** Update the last assistant message in a session (used during streaming). */
  updateLastAssistantMessage: (sessionId: string, updates: Partial<Omit<ChatMessage, 'id' | 'timestamp'>>) => void;
  /** 从悬浮球添加一条完整的问答记录（自动创建或复用会话），支持多模型响应 */
  addChatFromFloatBall: (
    imageBase64: string | undefined,
    userMessage: string,
    aiResponse: string,
    multiResponses?: Record<string, { providerName: string; content: string; error?: string }>
  ) => string;
}

export const useChatStore = create<ChatStore>()(
  persist(
    (set, get) => ({
      sessions: [],
      currentSessionId: null,
      isLoading: false,
      error: null,

      initChats: () => {
        const { sessions } = get();
        if (sessions.length === 0) {
          const newSessionId = get().createSession('新对话');
          set({ currentSessionId: newSessionId });
        } else if (!get().currentSessionId) {
          set({ currentSessionId: sessions[0].id });
        }
      },

      createSession: (title = '新对话', source: 'main' | 'float-ball' = 'main') => {
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const newSession: ChatSession = {
          id: sessionId,
          title,
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          model: 'deepseek-chat',
          source,
        };
        
        set(state => ({
          sessions: [newSession, ...state.sessions],
          currentSessionId: sessionId,
        }));
        
        return sessionId;
      },

      deleteSession: (sessionId: string) => {
        set(state => {
          const newSessions = state.sessions.filter(s => s.id !== sessionId);
          let newCurrentId = state.currentSessionId;

          if (state.currentSessionId === sessionId) {
            newCurrentId = newSessions.length > 0 ? newSessions[0].id : null;
          }

          // Auto-create a new session if we just deleted the last one (fix #9)
          if (newSessions.length === 0 || newCurrentId === null) {
            const newSession: ChatSession = {
              id: `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              title: '新对话',
              messages: [],
              createdAt: Date.now(),
              updatedAt: Date.now(),
              model: 'deepseek-chat',
            };
            return {
              sessions: [newSession],
              currentSessionId: newSession.id,
            };
          }

          return {
            sessions: newSessions,
            currentSessionId: newCurrentId,
          };
        });
      },

      renameSession: (sessionId: string, newTitle: string) => {
        set(state => ({
          sessions: state.sessions.map(session =>
            session.id === sessionId
              ? { ...session, title: newTitle, updatedAt: Date.now() }
              : session
          ),
        }));
      },

      setCurrentSession: (sessionId: string) => {
        set({ currentSessionId: sessionId });
      },

      addMessage: (sessionId: string, message: Omit<ChatMessage, 'id' | 'timestamp'>) => {
        const newMessage: ChatMessage = {
          ...message,
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          timestamp: Date.now(),
        };

        set(state => ({
          sessions: state.sessions.map(session =>
            session.id === sessionId
              ? {
                  ...session,
                  messages: [...session.messages, newMessage],
                  updatedAt: Date.now(),
                }
              : session
          ),
        }));
      },

      clearSession: (sessionId: string) => {
        set(state => ({
          sessions: state.sessions.map(session =>
            session.id === sessionId
              ? { ...session, messages: [], updatedAt: Date.now() }
              : session
          ),
        }));
      },

      addChatFromFloatBall: (imageBase64: string | undefined, userMessage: string, aiResponse: string, multiResponses?) => {
        const state = get();
        const sessionId = state.currentSessionId;
        if (!sessionId) return '';

        // 添加用户消息
        const userMsg: ChatMessage = {
          id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          role: 'user',
          content: userMessage || '截图分析',
          timestamp: Date.now(),
          imageData: imageBase64,
          source: 'float-ball',
        };

        // 添加 AI 回复
        const aiMsg: ChatMessage = {
          id: `msg_${Date.now() + 1}_${Math.random().toString(36).substr(2, 9)}`,
          role: 'assistant',
          content: multiResponses ? '多模型对比分析' : aiResponse,
          timestamp: Date.now() + 1,
          source: 'float-ball',
          model: multiResponses ? 'multi' : undefined,
          multiResponses,
        };

        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === sessionId
              ? { ...s, messages: [...s.messages, userMsg, aiMsg], updatedAt: Date.now() }
              : s
          ),
        }));

        return sessionId!;
      },

      updateLastAssistantMessage: (sessionId, updates) => {
        set(state => ({
          sessions: state.sessions.map(s =>
            s.id === sessionId
              ? {
                  ...s,
                  messages: s.messages.map((m, i) =>
                    i === s.messages.length - 1 && m.role === 'assistant'
                      ? { ...m, ...updates }
                      : m
                  ),
                }
              : s
          ),
        }));
      },

      setLoading: (loading: boolean) => {
        set({ isLoading: loading });
      },

      setError: (error: string | null) => {
        set({ error });
      },
    }),
    {
      name: 'ai-screenshot-chat-storage',
      version: 1,
      partialize: (state) => ({
        ...state,
        sessions: state.sessions.map(s => ({
          ...s,
          messages: s.messages.map(m => {
            // Strip imageData from persisted messages to prevent
            // localStorage quota overflow (base64 images are 1-5 MB each)
            const { imageData, ...rest } = m;
            return rest;
          }),
        })),
      }),
    }
  )
);