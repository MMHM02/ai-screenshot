export const presetColors = [
  '#6366f1', '#0ea5e9', '#10b981', '#f59e0b',
  '#ec4899', '#8b5cf6', '#f97316', '#06b6d4',
];

export function formatDate(timestamp: number): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    const hours = date.getHours();
    const minutes = date.getMinutes();
    return `${hours}:${minutes.toString().padStart(2, '0')}`;
  }
  if (days === 1) return '昨天';
  if (days <= 7) return `${days}天前`;

  const month = date.getMonth() + 1;
  const day = date.getDate();
  return `${month}/${day}`;
}
