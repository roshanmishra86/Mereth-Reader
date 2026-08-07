import React from 'react';
import { BackgroundJob, JobType } from '../utils/jobQueue';
import { EmptyState } from './EmptyState';

interface JobQueueDrawerProps {
  isOpen: boolean;
  jobs: BackgroundJob[];
  onClose: () => void;
  onCancelJob: (jobId: string) => void;
  onRestartJob: (jobId: string) => void;
}

function formatJobTypeName(jobType: JobType): string {
  switch (jobType) {
    case 'text_extraction':
      return 'Text Extraction';
    case 'thumbnail_generation':
      return 'Thumbnail Generation';
    case 'fts_indexing':
      return 'FTS5 Indexing';
    default:
      return jobType;
  }
}

export function JobQueueDrawer({
  isOpen,
  jobs,
  onClose,
  onCancelJob,
  onRestartJob,
}: JobQueueDrawerProps) {
  if (!isOpen) return null;

  const runningCount = jobs.filter((j) => j.status === 'running' || j.status === 'pending').length;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet job-queue-sheet" onClick={(e) => e.stopPropagation()}>
        <header className="sheet-header">
          <h3>
            ⚙️ Background Jobs (FR-7.6)
            {runningCount > 0 && <span className="badge running">{runningCount} active</span>}
          </h3>
          <button className="icon-button" onClick={onClose} aria-label="Close jobs drawer">✕</button>
        </header>

        <div className="sheet-body">
          <p className="dimmed micro">
            Page extraction and thumbnail generation prioritize the active reading position (visible page ± window). Reading remains responsive while jobs execute.
          </p>

          {jobs.length === 0 ? (
            <EmptyState viewType="jobs" />
          ) : (
            <div className="jobs-list">
              {jobs.map((job) => (
                <div key={job.id} className={`job-card status-${job.status}`}>
                  <div className="job-header-row">
                    <div className="job-title-area">
                      <strong>{formatJobTypeName(job.job_type)}</strong>
                      <span className="dimmed micro">Doc ID: {job.document_id}</span>
                    </div>

                    <span className={`status-badge status-${job.status}`}>
                      {job.status.toUpperCase()}
                    </span>
                  </div>

                  <div className="job-progress-bar-container">
                    <div
                      className={`job-progress-bar-fill status-${job.status}`}
                      style={{ width: `${job.progress_percent}%` }}
                    />
                  </div>

                  <div className="job-meta-row">
                    <span className="dimmed micro">
                      {job.processed_pages} / {job.total_pages} pages ({job.progress_percent}%)
                    </span>

                    <div className="job-actions">
                      {(job.status === 'running' || job.status === 'pending') && (
                        <button
                          className="button danger micro"
                          onClick={() => onCancelJob(job.id)}
                        >
                          Cancel Job
                        </button>
                      )}

                      {(job.status === 'cancelled' || job.status === 'failed') && (
                        <button
                          className="button secondary micro"
                          onClick={() => onRestartJob(job.id)}
                        >
                          Restart Job
                        </button>
                      )}
                    </div>
                  </div>

                  {job.error && (
                    <div className="job-error-banner">
                      <span>⚠️ {job.error}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="sheet-footer">
          <button className="button secondary" onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
