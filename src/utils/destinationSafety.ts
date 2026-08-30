export interface DestinationSnapshot {
  path: string;
  exists: boolean;
  currentSha256?: string | null;
  nextSha256?: string | null;
  currentPreview?: string | null;
  nextPreview?: string | null;
}

export type DestinationDecision =
  | { action: 'write' }
  | { action: 'confirm_overwrite'; diffPreview: string }
  | { action: 'rename_copy'; suggestedPath: string };

export function resolveDestinationSafety(snapshot: DestinationSnapshot): DestinationDecision {
  if (!snapshot.exists) return { action: 'write' };
  if (snapshot.currentSha256 && snapshot.nextSha256 && snapshot.currentSha256 === snapshot.nextSha256) {
    return { action: 'write' };
  }
  const diffPreview = [
    `Existing: ${snapshot.currentPreview ?? '(binary or unavailable)'}`,
    `New: ${snapshot.nextPreview ?? '(binary or unavailable)'}`,
  ].join('\n');
  return { action: 'confirm_overwrite', diffPreview };
}

export function suggestCopyPath(path: string): string {
  const dot = path.lastIndexOf('.');
  if (dot <= 0) return `${path} copy`;
  return `${path.slice(0, dot)} copy${path.slice(dot)}`;
}

/** U21: fetch a destination snapshot from the backend (existence + preview). */
export async function checkDestination(path: string): Promise<DestinationSnapshot> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<DestinationSnapshot>('db_check_destination', { path });
}

