import type { DeepLinkRoute } from './launchRouting';

type CompatibleDeepLinkRoute = DeepLinkRoute | {
  url: string;
  kind: 'document' | 'note' | 'review';
  id: string;
  page: number | null;
  annotation_id?: string | null;
  annotationId?: string | null;
};

export type DestinationRoute = 'reader' | 'notes' | 'review';

export interface DeepLinkUiAction {
  destination: DestinationRoute;
  documentId?: string;
  noteId?: string;
  reviewPromptId?: string;
  page?: number | null;
  annotationId?: string | null;
}

export function resolveDeepLinkUiAction(route: CompatibleDeepLinkRoute): DeepLinkUiAction {
  if (route.kind === 'document') {
    return {
      destination: 'reader',
      documentId: route.id,
      page: route.page,
      annotationId: 'annotationId' in route ? route.annotationId ?? null : route.annotation_id ?? null,
    };
  }
  if (route.kind === 'note') {
    return { destination: 'notes', noteId: route.id };
  }
  return { destination: 'review', reviewPromptId: route.id };
}
