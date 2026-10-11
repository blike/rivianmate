import type { CheckLevel } from './health';

export const LEVEL_COLOR: Record<CheckLevel, string> = {
  good: 'var(--status-good)',
  info: 'var(--accent)',
  attention: 'var(--status-warning)',
  unknown: 'var(--text-muted)',
};
