import { getExportDefinition, type ExportFormat } from './exportJob';

export interface NativeDestinationOptions {
  directory: boolean;
  defaultPath?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}

export function getNativeDestinationOptions(format: ExportFormat): NativeDestinationOptions {
  const definition = getExportDefinition(format);
  if (definition.destinationKind === 'directory') return { directory: true };
  return {
    directory: false,
    defaultPath: definition.defaultFileName,
    filters: definition.extensions ? [{ name: definition.label, extensions: [...definition.extensions] }] : undefined,
  };
}

/** Opens the Tauri dialog plugin only when a user explicitly requests a destination. */
export async function chooseNativeExportDestination(format: ExportFormat): Promise<string | null> {
  const definition = getExportDefinition(format);
  if (definition.capability !== 'ready') return null;

  const dialog = await import('@tauri-apps/plugin-dialog');
  const options = getNativeDestinationOptions(format);
  if (options.directory) {
    const result = await dialog.open({ directory: true, multiple: false });
    return typeof result === 'string' ? result : null;
  }
  return dialog.save({ defaultPath: options.defaultPath, filters: options.filters });
}
