import { describe, expect, it } from '@jest/globals';

import { BackupRetention } from './backup-retention.model';
import { BackupRetentionUtilities, RetainedBackup } from './backup-retention.utilities';

/**
 * A backup taken at the given moment, named by it.
 * @param createdAt - When it was taken, as an ISO string.
 * @returns The backup.
 */
function backupAt(createdAt: string): RetainedBackup {
    return { id: createdAt, createdAt: new Date(createdAt), resources: [] };
}

/**
 * Backups of which each one but the first builds on the one before it, as backups reading only what
 * changed do.
 * @param createdAt - When each was taken, as ISO strings, the oldest first.
 * @returns The backups.
 */
function chainedBackups(createdAt: string[]): RetainedBackup[] {
    return createdAt.map((at, i) => ({ ...backupAt(at), resources: [{ baseBackupId: createdAt[i - 1] ?? null }] }));
}

/**
 * One backup a day at 03:00 UTC, from the first day to the last.
 * @param from - The first day, as yyyy-mm-dd.
 * @param to - The last day, as yyyy-mm-dd.
 * @returns The backups.
 */
function dailyBackups(from: string, to: string): RetainedBackup[] {
    const res: RetainedBackup[] = [];
    for (
        let day: Date = new Date(`${from}T03:00:00.000Z`);
        day <= new Date(`${to}T03:00:00.000Z`);
        day = new Date(day.getTime() + (24 * 60 * 60 * 1000))
    ) {
        res.push(backupAt(day.toISOString()));
    }
    return res;
}

/**
 * The backups a retention keeps, the newest first.
 * @param backups - The backups.
 * @param retention - The retention.
 * @param now - The time it is applied at.
 * @returns The ids of the ones kept.
 */
function findKept(backups: RetainedBackup[], retention: BackupRetention, now: string = '2026-03-31T04:00:00.000Z'): string[] {
    const expired: Set<string> = new Set(BackupRetentionUtilities.findExpired(backups, retention, new Date(now)).map(b => b.id));
    return backups.map(b => b.id).filter(id => !expired.has(id))
        .sort()
        .reverse();
}

// there was no retention, so every application wrote its own
describe('BackupRetentionUtilities', () => {
    it('keeps the newest backup of as many days, weeks and months as asked, a period used once counting once', () => {
        // 2026-03-31 is a Tuesday: its week and the one before end on days the daily rule keeps
        const kept: string[] = findKept(dailyBackups('2026-01-01', '2026-03-31'), { timeZone: 'UTC', daily: 3, weekly: 2, monthly: 2 });

        expect(kept).toStrictEqual([
            '2026-03-31T03:00:00.000Z',
            '2026-03-30T03:00:00.000Z',
            '2026-03-29T03:00:00.000Z',
            '2026-03-22T03:00:00.000Z',
            '2026-03-15T03:00:00.000Z',
            '2026-02-28T03:00:00.000Z',
            '2026-01-31T03:00:00.000Z'
        ]);
    });

    it('keeps the newest backup of a day that holds several', () => {
        const backups: RetainedBackup[] = ['2026-03-30T03:00:00.000Z', '2026-03-30T15:00:00.000Z', '2026-03-31T03:00:00.000Z', '2026-03-31T15:00:00.000Z']
            .map(backupAt);

        expect(findKept(backups, { timeZone: 'UTC', daily: 2 })).toStrictEqual(['2026-03-31T15:00:00.000Z', '2026-03-30T15:00:00.000Z']);
    });

    it('keeps the oldest backup while a rule finds fewer periods than it asks for', () => {
        const backups: RetainedBackup[] = dailyBackups('2026-03-10', '2026-03-12');

        expect(findKept(backups, { timeZone: 'UTC', monthly: 12 })).toStrictEqual(['2026-03-12T03:00:00.000Z', '2026-03-10T03:00:00.000Z']);
    });

    it('counts days in the time zone it is given', () => {
        // 23:30 and 00:30 UTC are both the 2nd in Berlin, an hour ahead
        const backups: RetainedBackup[] = ['2026-01-01T12:00:00.000Z', '2026-01-01T23:30:00.000Z', '2026-01-02T00:30:00.000Z'].map(backupAt);

        expect(findKept(backups, { timeZone: 'UTC', daily: 2 })).toStrictEqual(['2026-01-02T00:30:00.000Z', '2026-01-01T23:30:00.000Z']);
        expect(findKept(backups, { timeZone: 'Europe/Berlin', daily: 2 })).toStrictEqual(['2026-01-02T00:30:00.000Z', '2026-01-01T12:00:00.000Z']);
    });

    it('counts a week across the turn of a year as one, the way ISO weeks do', () => {
        // Thursday the 31st and Friday the 1st are both in week 53 of 2026
        const backups: RetainedBackup[] = ['2026-12-24T03:00:00.000Z', '2026-12-31T03:00:00.000Z', '2027-01-01T03:00:00.000Z'].map(backupAt);

        expect(findKept(backups, { timeZone: 'UTC', weekly: 2 }, '2027-01-01T04:00:00.000Z')).toStrictEqual(['2027-01-01T03:00:00.000Z', '2026-12-24T03:00:00.000Z']);
    });

    it('keeps every backup taken within the time given, and the last ones on top', () => {
        const backups: RetainedBackup[] = dailyBackups('2026-03-20', '2026-03-31');

        expect(findKept(backups, { timeZone: 'UTC', withinInMs: 2 * 24 * 60 * 60 * 1000, last: 2 })).toStrictEqual([
            '2026-03-31T03:00:00.000Z',
            '2026-03-30T03:00:00.000Z',
            '2026-03-29T03:00:00.000Z',
            '2026-03-28T03:00:00.000Z'
        ]);
    });

    it('keeps every backup a kept backup builds on, back to the one in full, and lets a chain go once none of it is kept', () => {
        const older: RetainedBackup[] = chainedBackups(['2026-03-16T03:00:00.000Z', '2026-03-17T03:00:00.000Z', '2026-03-18T03:00:00.000Z']);
        const newer: RetainedBackup[] = chainedBackups(['2026-03-23T03:00:00.000Z', '2026-03-24T03:00:00.000Z', '2026-03-25T03:00:00.000Z']);

        expect(findKept([...older, ...newer], { timeZone: 'UTC', last: 1 })).toStrictEqual([
            '2026-03-25T03:00:00.000Z',
            '2026-03-24T03:00:00.000Z',
            '2026-03-23T03:00:00.000Z'
        ]);
    });

    it('keeps the base of a base that was taken after the backup building on it, as a retried attempt builds on whatever completed last', () => {
        const full: RetainedBackup = backupAt('2026-03-20T03:00:00.000Z');
        // taken late on the 21st, retried, and built on the one taken in the night after it
        const retried: RetainedBackup = { ...backupAt('2026-03-21T23:00:00.000Z'), resources: [{ baseBackupId: '2026-03-22T01:00:00.000Z' }] };
        const builtOn: RetainedBackup = { ...backupAt('2026-03-22T01:00:00.000Z'), resources: [{ baseBackupId: full.id }] };
        const newestFull: RetainedBackup = backupAt('2026-03-22T02:00:00.000Z');

        expect(findKept([full, retried, builtOn, newestFull], { timeZone: 'UTC', daily: 2 }, '2026-03-22T03:00:00.000Z')).toStrictEqual([
            '2026-03-22T02:00:00.000Z',
            '2026-03-22T01:00:00.000Z',
            '2026-03-21T23:00:00.000Z',
            '2026-03-20T03:00:00.000Z'
        ]);
    });

    it('refuses a retention that names no rule, or a count that is not a positive whole number', () => {
        expect(() => BackupRetentionUtilities.validateRetention({ timeZone: 'UTC' })).toThrow('names no rule');
        expect(() => BackupRetentionUtilities.validateRetention({ timeZone: 'UTC', daily: 0, weekly: 1.5 })).toThrow('daily, weekly does not');
        expect(() => BackupRetentionUtilities.validateRetention({ timeZone: 'UTC', daily: 7, monthly: 12 })).not.toThrow();
    });

    it('refuses a fullRead that is no period', () => {
        // @ts-expect-error a period that does not exist, as a configuration read at runtime can hold
        expect(() => BackupRetentionUtilities.validateRetention({ timeZone: 'UTC', daily: 7, fullRead: 'fortnightly' })).toThrow('fullRead');
        expect(() => BackupRetentionUtilities.validateRetention({ timeZone: 'UTC', daily: 7, fullRead: 'weekly' })).not.toThrow();
    });

    it('tells whether two moments fall in the same period, in the time zone given', () => {
        // Sunday the 29th and Monday the 30th are two ISO weeks, and 23:30 UTC on the 29th is the 30th in Berlin
        expect(BackupRetentionUtilities.isSamePeriod(new Date('2026-03-29T12:00:00.000Z'), new Date('2026-03-30T12:00:00.000Z'), 'weekly', 'UTC')).toBe(false);
        expect(BackupRetentionUtilities.isSamePeriod(new Date('2026-03-29T23:30:00.000Z'), new Date('2026-03-30T12:00:00.000Z'), 'weekly', 'Europe/Berlin')).toBe(true);
    });
});