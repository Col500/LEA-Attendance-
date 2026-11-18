import { useEffect, useState } from 'react';

/**
 * Tracks browser online/offline state using navigator.onLine and online/offline events.
 * Intended strictly to surface contextual error/recovery banners when connectivity drops.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(() => {
    if (typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean') {
      return true;
    }
    return navigator.onLine;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}

/**
 * Identifies errors caused by lost network connectivity or unreachable endpoints
 * (safe to retry for read queries and idempotent source_draft_id confirmations).
 */
export function isNetworkOrOfflineError(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true;
  }
  const msg =
    typeof err === 'string'
      ? err
      : err && typeof err === 'object' && 'message' in err
      ? String((err as { message?: unknown }).message || '')
      : '';
  const lower = msg.toLowerCase();
  return (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('internet connection') ||
    lower.includes('err_internet_disconnected') ||
    lower.includes('load failed') ||
    lower.includes('offline')
  );
}
