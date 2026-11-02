import type { Preferences } from '../api/types';

/** Basic browser notifications (MVP), respecting the learner's quiet hours. */
export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

export async function requestNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!notificationsSupported()) return 'unsupported';
  return Notification.permission === 'default' ? Notification.requestPermission() : Notification.permission;
}

function inQuietHours(prefs: Preferences, now = new Date()): boolean {
  const { quietHoursStart: start, quietHoursEnd: end } = prefs.notifications;
  if (!start || !end) return false;
  const local = new Intl.DateTimeFormat('en-GB', { timeZone: prefs.timezone, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  return start <= end ? local >= start && local < end : local >= start || local < end;
}

export function notify(prefs: Preferences, kind: 'breakReminders' | 'sessionComplete', title: string, body: string): void {
  if (!notificationsSupported() || Notification.permission !== 'granted') return;
  if (!prefs.notifications[kind] || inQuietHours(prefs)) return;
  // Only notify when the tab is not in view; otherwise the on-screen state is enough.
  if (document.visibilityState === 'visible') return;
  new Notification(title, { body, tag: kind });
}
