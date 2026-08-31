import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater';

export const UPDATE_ENDPOINT = 'https://github.com/roshanmishra86/Mereth-Reader/releases/latest/download/latest.json';
export const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const UPDATE_CONSENT_KEY = 'updates.consent';
export const UPDATE_LAST_CHECKED_KEY = 'updates.last_checked_at';
export const UPDATE_LOG_KEY = 'updates.network_activity_log';
export type UpdateConsent = 'accepted' | 'declined';
export type UpdateOperation = 'check' | 'download';
export interface UpdateLogEntry { timestamp: string; operation: UpdateOperation; endpoint: string; result: string }
export type UpdaterState =
  | { kind: 'idle' }
  | { kind: 'checking'; manual: boolean }
  | { kind: 'available'; version: string }
  | { kind: 'downloading'; version: string; downloaded: number; total: number | null }
  | { kind: 'ready'; version: string; compact?: boolean }
  | { kind: 'installing'; version: string }
  | { kind: 'error'; message: string; operation: UpdateOperation | 'install'; manual: boolean; version?: string };

export function isUpdaterRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

export function parseUpdateLog(value: string | null | undefined): UpdateLogEntry[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is UpdateLogEntry =>
      typeof entry?.timestamp === 'string' &&
      (entry?.operation === 'check' || entry?.operation === 'download') &&
      entry?.endpoint === UPDATE_ENDPOINT && typeof entry?.result === 'string'
    ).slice(-50);
  } catch { return []; }
}

export function appendUpdateLog(entries: UpdateLogEntry[], entry: UpdateLogEntry): UpdateLogEntry[] {
  return [...entries, entry].slice(-50);
}

export function shouldRunScheduledCheck(consent: UpdateConsent | null, lastCheckedAt: string | null, now = Date.now()): boolean {
  if (consent !== 'accepted') return false;
  if (!lastCheckedAt) return true;
  const timestamp = Date.parse(lastCheckedAt);
  return !Number.isFinite(timestamp) || now - timestamp >= UPDATE_INTERVAL_MS;
}

export function consumeDownloadEvent(
  current: { downloaded: number; total: number | null },
  event: DownloadEvent,
): { downloaded: number; total: number | null } {
  if (event.event === 'Started') return { downloaded: 0, total: event.data.contentLength ?? null };
  if (event.event === 'Progress') return { ...current, downloaded: current.downloaded + event.data.chunkLength };
  return current;
}

export type NativeUpdate = Update;
