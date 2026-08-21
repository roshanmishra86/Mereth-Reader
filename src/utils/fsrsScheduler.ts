export const FSRS_45_VERSION = 'FSRS-4.5-mereth-1';
export const DEFAULT_DESIRED_RETENTION = 0.9;
export const FSRS_45_DECAY = -0.5;
export const FSRS_45_FACTOR = 19 / 81;
export const FSRS_45_DEFAULT_PARAMETERS = [
  0.4872, 1.4003, 3.7145, 13.8206, 5.1618, 1.2298, 0.8975, 0.031, 1.6474,
  0.1367, 1.0461, 2.1072, 0.0793, 0.3246, 1.587, 0.2272, 2.8755,
] as const;

export type ReviewOutcome = 'again' | 'hard' | 'good' | 'easy';
export type FsrsCardState = 'new' | 'learning' | 'review' | 'relearning';

export interface FsrsScheduleState {
  prompt_id: string;
  desired_retention: number;
  state: FsrsCardState;
  stability: number;
  difficulty: number;
  due_at: string;
  last_reviewed_at?: string | null;
  last_outcome?: ReviewOutcome | null;
  fsrs_version: string;
  updated_at: string;
  provenance: 'deterministic_transform';
}

export interface FsrsReviewInput {
  promptId: string;
  outcome: ReviewOutcome;
  reviewedAt: Date;
  previous?: FsrsScheduleState | null;
  desiredRetention?: number;
}

export interface FsrsReviewResult {
  schedule: FsrsScheduleState;
  intervalDays: number;
  retrievability: number;
}

const gradeByOutcome: Record<ReviewOutcome, 1 | 2 | 3 | 4> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function daysBetween(a: Date, b: Date): number {
  return Math.max(0, (a.getTime() - b.getTime()) / 86_400_000);
}

export function retrievability(elapsedDays: number, stability: number): number {
  if (stability <= 0) return 0;
  return Math.pow(1 + FSRS_45_FACTOR * (elapsedDays / stability), FSRS_45_DECAY);
}

export function intervalForRetention(stability: number, desiredRetention = DEFAULT_DESIRED_RETENTION): number {
  const retention = clamp(desiredRetention, 0.7, 0.97);
  return Math.max(1, (stability / FSRS_45_FACTOR) * (Math.pow(retention, 1 / FSRS_45_DECAY) - 1));
}

function initialStability(grade: 1 | 2 | 3 | 4): number {
  return FSRS_45_DEFAULT_PARAMETERS[grade - 1];
}

function initialDifficulty(grade: 1 | 2 | 3 | 4): number {
  const w = FSRS_45_DEFAULT_PARAMETERS;
  return clamp(w[4] - (grade - 3) * w[5], 1, 10);
}

function nextDifficulty(difficulty: number, grade: 1 | 2 | 3 | 4): number {
  const w = FSRS_45_DEFAULT_PARAMETERS;
  const delta = difficulty - w[6] * (grade - 3);
  const reverted = w[7] * initialDifficulty(3) + (1 - w[7]) * delta;
  return clamp(reverted, 1, 10);
}

function stabilityAfterRecall(difficulty: number, stability: number, recall: number, grade: 2 | 3 | 4): number {
  const w = FSRS_45_DEFAULT_PARAMETERS;
  const hardPenalty = grade === 2 ? w[15] : 1;
  const easyBonus = grade === 4 ? w[16] : 1;
  const increase =
    Math.exp(w[8]) *
    (11 - difficulty) *
    Math.pow(stability, -w[9]) *
    (Math.exp(w[10] * (1 - recall)) - 1) *
    hardPenalty *
    easyBonus +
    1;
  return Math.max(stability, stability * increase);
}

function stabilityAfterForget(difficulty: number, stability: number, recall: number): number {
  const w = FSRS_45_DEFAULT_PARAMETERS;
  const next =
    w[11] *
    Math.pow(difficulty, -w[12]) *
    (Math.pow(stability + 1, w[13]) - 1) *
    Math.exp(w[14] * (1 - recall));
  return Math.max(0.1, Math.min(next, stability));
}

export function scheduleReview(input: FsrsReviewInput): FsrsReviewResult {
  const desiredRetention = clamp(input.desiredRetention ?? input.previous?.desired_retention ?? DEFAULT_DESIRED_RETENTION, 0.7, 0.97);
  const grade = gradeByOutcome[input.outcome];
  const previous = input.previous ?? null;

  const elapsedDays =
    previous?.last_reviewed_at ? daysBetween(input.reviewedAt, new Date(previous.last_reviewed_at)) : 0;
  const previousStability = previous && previous.stability > 0 ? previous.stability : initialStability(grade);
  const previousDifficulty = previous && previous.difficulty > 0 ? previous.difficulty : initialDifficulty(grade);
  const recall = previous ? retrievability(elapsedDays, previousStability) : 1;

  const difficulty = previous ? nextDifficulty(previousDifficulty, grade) : initialDifficulty(grade);
  const stability =
    input.outcome === 'again'
      ? previous
        ? stabilityAfterForget(previousDifficulty, previousStability, recall)
        : initialStability(1)
      : previous
        ? stabilityAfterRecall(previousDifficulty, previousStability, recall, grade as 2 | 3 | 4)
        : initialStability(grade);

  const rawInterval = input.outcome === 'again' ? 1 : intervalForRetention(stability, desiredRetention);
  const intervalDays = Math.max(1, Math.round(rawInterval));
  const due = new Date(input.reviewedAt.getTime() + intervalDays * 86_400_000);
  const nowIso = input.reviewedAt.toISOString();

  return {
    intervalDays,
    retrievability: recall,
    schedule: {
      prompt_id: input.promptId,
      desired_retention: desiredRetention,
      state: input.outcome === 'again' ? 'relearning' : 'review',
      stability,
      difficulty,
      due_at: due.toISOString(),
      last_reviewed_at: nowIso,
      last_outcome: input.outcome,
      fsrs_version: FSRS_45_VERSION,
      updated_at: nowIso,
      provenance: 'deterministic_transform',
    },
  };
}

export function formatIntervalPreview(days: number): string {
  if (days <= 1) return '1 day';
  if (days < 30) return `${days} days`;
  const months = Math.round(days / 30);
  return months === 1 ? '1 month' : `${months} months`;
}

