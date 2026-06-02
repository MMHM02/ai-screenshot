import { useState, useRef, useEffect } from "react";
import { useChatStore } from "@/stores/chatStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { formatDate } from "@/utils/theme";
import { cn } from "@/utils/cn";
import { createPortal } from "react-dom";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import SettingsPanel from "@/components/SettingsPanel";
import { Trash2, Edit3, Plus, Settings, Moon, Sun, PanelLeftClose, PanelLeft } from "lucide-react";

export default function Sidebar() {
  const { sessions, currentSessionId, createSession, deleteSession, renameSession, setCurrentSession } = useChatStore();
  const { darkMode, toggleDarkMode } = useSettingsStore();
  const [collapsed, setCollapsed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const handleRename = (sessionId: string) => {
    if (editTitle.trim()) {
      renameSession(sessionId, editTitle.trim());
    }
    setEditingId(null);
  };

  return (
    <>
      {collapsed ? (
        <div className="flex flex-col items-center gap-3 py-4 bg-gray-50/80 dark:bg-gray-800/60 border-r border-gray-200/60 dark:border-gray-700/50 w-14 flex-shrink-0"
          style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
          <button onClick={() => setCollapsed(false)}
            className="p-2 rounded-lg hover:bg-gray-200/70 dark:hover:bg-gray-700/70 text-gray-500 dark:text-gray-400 transition-colors duration-150"
            title="展开侧边栏">
            <PanelLeft size={18} />
          </button>
          <button onClick={() => createSession()}
            className="p-2 rounded-lg hover:bg-gray-200/70 dark:hover:bg-gray-700/70 text-gray-500 dark:text-gray-400 transition-colors duration-150"
            title="新建对话">
            <Plus size={18} />
          </button>
          <button onClick={() => setSettingsOpen(true)}
            className="p-2 rounded-lg hover:bg-gray-200/70 dark:hover:bg-gray-700/70 text-gray-500 dark:text-gray-400 transition-colors duration-150"
            title="设置">
            <Settings size={18} />
          </button>
          <button onClick={toggleDarkMode}
            className="p-2 rounded-lg hover:bg-gray-200/70 dark:hover:bg-gray-700/70 text-gray-500 dark:text-gray-400 transition-colors duration-150"
            title="切换主题">
            {darkMode ? <Sun size={18} /> : <Moon size={18} />}
          </button>
        </div>
      ) : (
        <div className="flex flex-col w-64 flex-shrink-0 bg-gray-50/80 dark:bg-gray-800/60 border-r border-gray-200/60 dark:border-gray-700/50"
          style={{ backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
          {/* 顶栏 */}
          <div className="flex items-center justify-between p-3 drag-region">
            <h1 className="text-sm font-bold no-drag tracking-wide" style={{ color: 'var(--color-primary)' }}>
              AI 截屏
            </h1>
            <div className="flex items-center gap-1 no-drag">
              <button onClick={() => createSession()}
                className="p-1.5 rounded-lg hover:bg-gray-200/70 dark:hover:bg-gray-700/70 text-gray-500 dark:text-gray-400 transition-colors duration-150"
                title="新建对话">
                <Plus size={16} />
              </button>
              <button onClick={() => setCollapsed(true)}
                className="p-1.5 rounded-lg hover:bg-gray-200/70 dark:hover:bg-gray-700/70 text-gray-500 dark:text-gray-400 transition-colors duration-150"
                title="折叠侧边栏">
                <PanelLeftClose size={16} />
              </button>
            </div>
          </div>

          {/* 对话列表 */}
          <div className="flex-1 overflow-y-auto px-2">
            <div className="text-xs text-gray-400 dark:text-gray-400 px-2 py-1.5 font-medium">历史对话</div>
            {sessions.map((session) => (
              <div
                key={session.id}
                onClick={() => setCurrentSession(session.id)}
                className={cn(
                  'group flex items-center gap-2 px-3 py-2 mb-0.5 rounded-lg cursor-pointer transition-all duration-150',
                  session.id === currentSessionId
                    ? 'bg-white dark:bg-gray-700 shadow-sm ring-1 ring-gray-200/50 dark:ring-gray-600/50'
                    : 'hover:bg-white/60 dark:hover:bg-gray-700/50'
                )}
              >
                {editingId === session.id ? (
                  <input
                    ref={inputRef}
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => handleRename(session.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename(session.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 text-xs bg-transparent border-b-2 outline-none px-1 py-0.5"
                    style={{ borderColor: 'var(--color-primary)' }}
                  />
                ) : (
                  <>
                    <span className="flex-1 text-xs truncate text-gray-700 dark:text-gray-200">{session.title}</span>
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 flex-shrink-0">
                      {formatDate(session.updatedAt)}
                    </span>
                    <div className="hidden group-hover:flex items-center gap-0.5">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingId(session.id);
                          setEditTitle(session.title);
                        }}
                        className="p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400"
                        title="重命名"
                      >
                        <Edit3 size={11} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteConfirmId(session.id);
                        }}
                        className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-500"
                        title="删除"
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {sessions.length === 0 && (
              <div className="text-xs text-gray-400 dark:text-gray-400 text-center py-8">
                暂无对话，点击 + 新建
              </div>
            )}
          </div>

          {/* 底栏 */}
          <div className="bottom-nav p-3 bg-gray-50/80 dark:bg-gray-800/60">
            <button onClick={() => setSettingsOpen(true)}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs rounded-lg hover:bg-gray-200/70 dark:hover:bg-gray-700/70 text-gray-600 dark:text-gray-300 transition-colors duration-150">
              <Settings size={14} />
              设置
            </button>
            <button onClick={toggleDarkMode}
              className="flex items-center gap-2 w-full px-3 py-2 text-xs rounded-lg hover:bg-gray-200/70 dark:hover:bg-gray-700/70 text-gray-600 dark:text-gray-300 transition-colors duration-150">
              {darkMode ? <Sun size={14} /> : <Moon size={14} />}
              {darkMode ? '浅色模式' : '深色模式'}
            </button>
          </div>
        </div>
      )}
      {settingsOpen && createPortal(
        <SettingsPanel onClose={() => setSettingsOpen(false)} />,
        document.body
      )}
      {deleteConfirmId && createPortal(
        <ConfirmDialog
          title="删除对话"
          message="确定删除这个对话吗？此操作不可撤销。"
          confirmLabel="删除"
          variant="danger"
          onConfirm={() => { deleteSession(deleteConfirmId); setDeleteConfirmId(null); }}
          onCancel={() => setDeleteConfirmId(null)}
        />,
        document.body
      )}
    </>
  );
}
