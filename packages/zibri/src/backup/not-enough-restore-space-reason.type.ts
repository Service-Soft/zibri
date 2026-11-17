/**
 * When a restore was found to need more room than this instance's disk has: `'refused'` before it fetched
 * anything, `'ranOut'` once it ran out of space before it changed anything, and `'foreseen'` once a backup
 * was taken, before any restore of it.
 */
export type NotEnoughRestoreSpaceReason = 'refused' | 'ranOut' | 'foreseen';