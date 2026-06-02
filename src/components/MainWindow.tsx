import Sidebar from '@/components/Sidebar';
import ChatArea from '@/components/ChatArea';

export default function MainWindow() {
  return (
    <div className="flex h-full w-full bg-white dark:bg-gray-900 overflow-hidden">
      <Sidebar />
      <ChatArea />
    </div>
  );
}
