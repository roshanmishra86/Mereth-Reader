import { useEffect, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { pendingWork } from '../utils/pendingWork';
import {
  appendUpdateLog, consumeDownloadEvent, isUpdaterRuntime, parseUpdateLog,
  shouldRunScheduledCheck, UPDATE_CONSENT_KEY, UPDATE_ENDPOINT, UPDATE_INTERVAL_MS,
  UPDATE_LAST_CHECKED_KEY, UPDATE_LOG_KEY, type UpdateConsent, type UpdaterState, type UpdateLogEntry,
} from '../utils/updater';

async function saveSetting(key: string, value: string) { await invoke('db_save_settings', { key, value }); }

export interface UpdateCenterModel {
  version: string; consent: UpdateConsent | null; state: UpdaterState; lastCheckedAt: string | null;
  log: UpdateLogEntry[]; setAutomaticChecks(enabled: boolean): Promise<void>; checkNow(): Promise<void>;
  download(): Promise<void>; install(): Promise<void>; dismiss(): void; clearLog(): Promise<void>;
}

export function useUpdateCenter(settingsLoaded: boolean): UpdateCenterModel {
  const [version, setVersion] = useState('unknown');
  const [consent, setConsent] = useState<UpdateConsent | null>(null);
  const [state, setState] = useState<UpdaterState>({ kind: 'idle' });
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [log, setLog] = useState<UpdateLogEntry[]>([]);
  const updateRef = useRef<Update | null>(null);
  const checkPromiseRef = useRef<Promise<void> | null>(null);
  const installPromiseRef = useRef<Promise<void> | null>(null);
  const dismissedVersionRef = useRef<string | null>(null);

  const persistLog = async (entry: UpdateLogEntry) => {
    setLog((current) => { const next = appendUpdateLog(current, entry); void saveSetting(UPDATE_LOG_KEY, JSON.stringify(next)); return next; });
  };

  const checkNow = async (manual = true) => {
    if (!isUpdaterRuntime()) return;
    if (checkPromiseRef.current) return checkPromiseRef.current;
    const task = (async () => {
      setState({ kind: 'checking', manual });
      try {
        const found = await check();
        const checkedAt = new Date().toISOString();
        setLastCheckedAt(checkedAt);
        await saveSetting(UPDATE_LAST_CHECKED_KEY, checkedAt);
        await persistLog({ timestamp: checkedAt, operation: 'check', endpoint: UPDATE_ENDPOINT, result: found ? `update ${found.version} available` : 'no update' });
        updateRef.current = found;
        setState(found && dismissedVersionRef.current !== found.version ? { kind: 'available', version: found.version } : { kind: 'idle' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await persistLog({ timestamp: new Date().toISOString(), operation: 'check', endpoint: UPDATE_ENDPOINT, result: `failed: ${message}` });
        setState(manual ? { kind: 'error', message, operation: 'check', manual: true } : { kind: 'idle' });
      }
    })().finally(() => { checkPromiseRef.current = null; });
    checkPromiseRef.current = task;
    return task;
  };

  useEffect(() => {
    if (!settingsLoaded) return;
    if (isUpdaterRuntime()) void getVersion().then(setVersion);
    void invoke<Array<{ key: string; value: string }>>('db_get_settings').then((rows) => {
      const value = (key: string) => rows.find((row) => row.key === key)?.value ?? null;
      const loadedConsent = value(UPDATE_CONSENT_KEY);
      setConsent(loadedConsent === 'accepted' || loadedConsent === 'declined' ? loadedConsent : null);
      setLastCheckedAt(value(UPDATE_LAST_CHECKED_KEY));
      setLog(parseUpdateLog(value(UPDATE_LOG_KEY)));
    }).catch(() => undefined);
  }, [settingsLoaded]);

  useEffect(() => {
    if (!settingsLoaded || consent !== 'accepted' || !isUpdaterRuntime()) return;
    if (shouldRunScheduledCheck(consent, lastCheckedAt)) void checkNow(false);
    const timer = window.setInterval(() => { void checkNow(false); }, UPDATE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [settingsLoaded, consent, lastCheckedAt]);

  const setAutomaticChecks = async (enabled: boolean) => {
    const next: UpdateConsent = enabled ? 'accepted' : 'declined';
    await saveSetting(UPDATE_CONSENT_KEY, next);
    setConsent(next);
    if (enabled) await checkNow(false);
  };

  const download = async () => {
    const update = updateRef.current;
    if (!update || state.kind === 'downloading') return;
    let progress = { downloaded: 0, total: null as number | null };
    setState({ kind: 'downloading', version: update.version, ...progress });
    try {
      await update.download((event) => { progress = consumeDownloadEvent(progress, event); setState({ kind: 'downloading', version: update.version, ...progress }); });
      await persistLog({ timestamp: new Date().toISOString(), operation: 'download', endpoint: UPDATE_ENDPOINT, result: `update ${update.version} verified and ready` });
      setState({ kind: 'ready', version: update.version });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await persistLog({ timestamp: new Date().toISOString(), operation: 'download', endpoint: UPDATE_ENDPOINT, result: `failed: ${message}` });
      setState({ kind: 'error', message, operation: 'download', manual: true });
    }
  };

  const install = async () => {
    if (!updateRef.current || (state.kind !== 'ready' && !(state.kind === 'error' && state.operation === 'install')) || installPromiseRef.current) return;
    const update = updateRef.current;
    const task = (async () => {
      setState({ kind: 'installing', version: update.version });
      try { await pendingWork.flushAll(); await update.install(); }
      catch (error) { setState({ kind: 'error', operation: 'install', manual: true, version: update.version, message: `Mereth stayed open because pending work could not be saved: ${error instanceof Error ? error.message : String(error)}` }); }
    })().finally(() => { installPromiseRef.current = null; });
    installPromiseRef.current = task;
    return task;
  };

  return {
    version, consent, state, lastCheckedAt, log, setAutomaticChecks, checkNow: () => checkNow(true), download, install,
    dismiss: () => {
      if (state.kind === 'ready') { setState({ ...state, compact: true }); return; }
      if ('version' in state && state.version) dismissedVersionRef.current = state.version;
      setState({ kind: 'idle' });
    },
    clearLog: async () => { setLog([]); await saveSetting(UPDATE_LOG_KEY, '[]'); },
  };
}

export function UpdateConsentDialog({ model }: { model: UpdateCenterModel }) {
  const ref = useFocusTrap<HTMLDivElement>({ isOpen: model.consent === null });
  if (model.consent !== null) return null;
  return <div className="modal-backdrop" role="presentation"><div ref={ref} className="modal update-consent" role="dialog" aria-modal="true" aria-labelledby="update-consent-title">
    <span className="eyebrow">Updates</span><h2 id="update-consent-title">Allow automatic update checks?</h2>
    <p>Mereth can contact its GitHub release endpoint at launch and every six hours while open. It sends only the app version, platform, and architecture—never documents, notes, annotations, or reading activity.</p>
    <div className="modal-actions"><button className="button" onClick={() => void model.setAutomaticChecks(false)}>Not now</button><button className="button primary" onClick={() => void model.setAutomaticChecks(true)}>Allow automatic update checks</button></div>
  </div></div>;
}

export function UpdateToast({ model }: { model: UpdateCenterModel }) {
  const state = model.state;
  if (!['available', 'downloading', 'ready', 'installing', 'error'].includes(state.kind)) return null;
  const version = 'version' in state ? state.version : null;
  return <aside className="update-toast" role="status" aria-live="polite">
    {state.kind === 'available' && <><b>Mereth Reader v{version} is available</b><p>Download it in the background while you keep working.</p><div><button className="button" onClick={model.dismiss}>Later</button><button className="button primary" onClick={() => void model.download()}>Download update</button></div></>}
    {state.kind === 'downloading' && <><b>Downloading Mereth Reader v{version}</b><progress value={state.total ? state.downloaded : undefined} max={state.total ?? undefined} aria-label="Update download progress" /><p>{state.total ? `${Math.min(100, Math.round(state.downloaded / state.total * 100))}% downloaded` : 'Downloading…'}</p></>}
    {state.kind === 'ready' && state.compact && <><b>Update ready</b><div><button className="button primary" onClick={() => void model.install()}>Restart and update</button></div></>}
    {state.kind === 'ready' && !state.compact && <><b>Mereth Reader v{version} is ready</b><p>Restart to finish the update. Your notes, annotations, and reading position will be saved before Mereth closes.</p><div><button className="button" onClick={model.dismiss}>Later</button><button className="button primary" onClick={() => void model.install()}>Restart and update</button></div></>}
    {state.kind === 'installing' && <><b>Saving your work…</b><p>Mereth will close only after pending work is safely stored.</p></>}
    {state.kind === 'error' && state.manual && <><b>Update {state.operation} failed</b><p>{state.message}</p><button className="button" onClick={() => void (state.operation === 'check' ? model.checkNow() : state.operation === 'install' ? model.install() : model.download())}>Retry</button></>}
  </aside>;
}

export function SettingsUpdates({ model }: { model: UpdateCenterModel }) {
  const state = model.state;
  return <div><span className="eyebrow">Signed releases</span><h1>Updates</h1><p>Mereth’s core reader remains offline. Update activity is limited to the official GitHub release endpoint and occurs only with your permission.</p><div className="destination-rule" />
    <div className="setting-state"><div><b>Mereth Reader {model.version}</b><p>{model.lastCheckedAt ? `Last checked ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(model.lastCheckedAt))}.` : 'No update check has run yet.'}</p></div><button className="wide-action" disabled={state.kind === 'checking'} onClick={() => void model.checkNow()}>{state.kind === 'checking' ? 'Checking…' : 'Check now'}</button></div>
    <label className="update-toggle"><input type="checkbox" checked={model.consent === 'accepted'} onChange={(event) => void model.setAutomaticChecks(event.target.checked)} /><span><b>Check automatically</b><small>At launch and every six hours while Mereth is open. Downloads still require a click.</small></span></label>
    <h3>Current state</h3><p role="status">{state.kind === 'idle' ? 'Up to date or not checked.' : state.kind.replace(/_/g, ' ')}</p>
    <h3>Local network activity</h3><div className="update-log">{model.log.length === 0 ? <p>No update network activity recorded.</p> : model.log.map((entry) => <div key={`${entry.timestamp}-${entry.operation}`}><time>{new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(entry.timestamp))}</time><b>{entry.operation}</b><span>{entry.result}</span></div>)}</div>
    <button className="wide-action" disabled={model.log.length === 0} onClick={() => void model.clearLog()}>Clear activity log</button>
  </div>;
}
