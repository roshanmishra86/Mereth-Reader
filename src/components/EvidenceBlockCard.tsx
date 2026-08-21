import React, { useState } from 'react';
import type { EvidenceBlockRecord } from '../utils/evidenceTypes';

interface EvidenceBlockCardProps {
  block: EvidenceBlockRecord;
  documentTitle?: string;
  documentAuthor?: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onUpdateComment: (newComment: string) => void;
  onNavigateToSource: (block: EvidenceBlockRecord) => void;
  onRemember?: (block: EvidenceBlockRecord) => void;
}

export const EvidenceBlockCard: React.FC<EvidenceBlockCardProps> = ({
  block,
  documentTitle,
  documentAuthor,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
  onDelete,
  onUpdateComment,
  onNavigateToSource,
  onRemember,
}) => {
  const [isEditingComment, setIsEditingComment] = useState(false);
  const [commentDraft, setCommentDraft] = useState(block.user_comment);

  const handleSaveComment = () => {
    setIsEditingComment(false);
    if (commentDraft !== block.user_comment) {
      onUpdateComment(commentDraft);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSaveComment();
    } else if (e.key === 'Escape') {
      setCommentDraft(block.user_comment);
      setIsEditingComment(false);
    }
  };

  return (
    <div
      className="p-3 my-2 border rounded-lg bg-surface text-foreground shadow-sm flex flex-col gap-2 border-border"
      data-testid={`evidence-block-${block.id}`}
    >
      {/* Header bar: source citation & controls */}
      <div className="flex items-center justify-between text-xs text-muted-foreground border-b border-border/50 pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold uppercase text-[10px]">
            {block.source_kind === 'area_image' ? 'Area Image' : 'Quote'}
          </span>
          <span className="font-medium text-foreground">
            {documentTitle || 'Document'}
          </span>
          {documentAuthor && <span>by {documentAuthor}</span>}
          <span className="px-1.5 py-0.5 rounded bg-muted">
            p. {block.page_label}
          </span>
          {block.color && (
            <span
              className="inline-block w-2.5 h-2.5 rounded-full border border-border"
              style={{ backgroundColor: block.color }}
              title={`Color: ${block.color}`}
            />
          )}
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 rounded hover:bg-muted"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            title="Move Up"
          >
            ↑
          </button>
          <button
            type="button"
            className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 rounded hover:bg-muted"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            title="Move Down"
          >
            ↓
          </button>
          <button
            type="button"
            className="p-1 text-destructive hover:bg-destructive/10 rounded"
            onClick={onDelete}
            title="Remove Evidence Block"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Excerpt body (Immutable quote) */}
      <blockquote className="border-l-2 border-primary/60 pl-3 py-1 italic text-sm text-foreground/90 font-serif bg-muted/20 rounded-r">
        {block.quote || '(No quote text recorded)'}
      </blockquote>

      {/* Tags */}
      {block.tags.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {block.tags.map((tag) => (
            <span
              key={tag}
              className="px-1.5 py-0.5 text-[11px] rounded bg-muted text-muted-foreground"
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* User comment section */}
      <div className="mt-1 pt-1 border-t border-border/40 text-xs">
        <div className="flex items-center justify-between text-muted-foreground mb-1">
          <span className="font-medium text-[11px]">User Note / Interpretation:</span>
          {!isEditingComment && (
            <button
              type="button"
              className="text-primary hover:underline text-[11px]"
              onClick={() => {
                setCommentDraft(block.user_comment);
                setIsEditingComment(true);
              }}
            >
              {block.user_comment ? 'Edit' : '+ Add Note'}
            </button>
          )}
        </div>

        {isEditingComment ? (
          <div className="flex flex-col gap-1">
            <textarea
              className="w-full p-2 border rounded text-xs bg-background text-foreground border-border focus:ring-1 focus:ring-primary focus:outline-none"
              rows={2}
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Add your note or reflection on this evidence..."
              autoFocus
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted rounded"
                onClick={() => {
                  setCommentDraft(block.user_comment);
                  setIsEditingComment(false);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="px-2 py-0.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
                onClick={handleSaveComment}
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          block.user_comment && (
            <p className="text-foreground text-xs whitespace-pre-wrap">
              {block.user_comment}
            </p>
          )
        )}
      </div>

      {/* In-Context Return footer deep link & Remember action */}
      <div className="flex items-center justify-between pt-1 border-t border-border/30 text-[11px]">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-primary hover:underline font-medium"
          onClick={() => onNavigateToSource(block)}
          title="Return to original document in reader at this exact location"
        >
          <span>↗</span>
          <span>Open in Document (p. {block.page_label})</span>
        </button>
        <div className="flex items-center gap-2">
          {onRemember && (
            <button
              type="button"
              className="text-xs text-primary hover:underline font-medium"
              onClick={() => onRemember(block)}
              title="Create or edit a review prompt for spaced repetition (FR-11.1)"
            >
              Remember
            </button>
          )}
          <span className="text-muted-foreground text-[10px]">
            {block.provenance}
          </span>
        </div>
      </div>
    </div>
  );
};
