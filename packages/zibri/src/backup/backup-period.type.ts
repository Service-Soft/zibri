/**
 * A period a backup retention counts in: an hour, a day, a week starting on Monday, a month, a quarter
 * starting in January, or a year.
 */
export type BackupPeriod = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';