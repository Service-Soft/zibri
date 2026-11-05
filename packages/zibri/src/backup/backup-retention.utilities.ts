import { BackupEntity } from './backup-entity.model';
import { BackupRetention } from './backup-retention.model';
import { InternalError } from '../error-handling/internal-error.model';
import { getZonedDate, ZonedDate } from '../localization/format-date.function';

/**
 * What a retention reads of a backup.
 */
export type RetainedBackup = Pick<BackupEntity, 'id' | 'createdAt'>;

/**
 * The rules of a retention that count periods, in the order they are applied.
 */
type PeriodRule = 'hourly' | 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

const PERIOD_RULES: PeriodRule[] = ['hourly', 'daily', 'weekly', 'monthly', 'quarterly', 'yearly'];

const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

/**
 * Decides which backups a retention keeps.
 *
 * The rules are those of `borg prune`, which is what backup policies are usually written against: a
 * policy of 7 daily, 4 weekly and 12 monthly means the same here as it does there.
 */
export abstract class BackupRetentionUtilities {
    /**
     * Validates that a retention keeps something, and that every count it names is one.
     * @param retention - The retention.
     * @throws When it has no rule, or a rule is not a positive whole number.
     */
    static validateRetention(retention: BackupRetention): void {
        const counts: [string, number | undefined][] = [
            ['last', retention.last],
            ...PERIOD_RULES.map((r): [string, number | undefined] => [r, retention[r]])
        ];
        const invalid: string[] = counts
            .filter(([, count]) => count != undefined && (!Number.isInteger(count) || count < 1))
            .map(([rule]) => rule);
        if (retention.withinInMs != undefined && !(retention.withinInMs > 0 && Number.isFinite(retention.withinInMs))) {
            invalid.push('withinInMs');
        }
        if (invalid.length) {
            throw new InternalError(
                `The backup retention has to keep a positive whole number of backups per rule: ${invalid.join(', ')} does not.`
            );
        }
        if (retention.withinInMs == undefined && counts.every(([, count]) => count == undefined)) {
            // the same as deleting every backup but the one just taken, which nobody means
            throw new InternalError(
                'The backup retention names no rule, so it would keep no backup but the newest. Name at least one, such as daily.'
            );
        }
    }

    /**
     * Finds the backups a retention does not keep.
     * @param backups - The completed backups.
     * @param retention - The retention.
     * @param now - The time `withinInMs` is counted back from.
     * @returns The backups no rule keeps, the newest first.
     */
    static findExpired<T extends RetainedBackup>(backups: T[], retention: BackupRetention, now: Date): T[] {
        const newestFirst: T[] = [...backups].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const kept: Set<string> = new Set();
        const { withinInMs, last, timeZone } = retention;
        if (withinInMs != undefined) {
            for (const backup of newestFirst.filter(b => now.getTime() - b.createdAt.getTime() <= withinInMs)) {
                kept.add(backup.id);
            }
        }
        this.keepPerPeriod(newestFirst, last, backup => backup.id, kept);
        for (const rule of PERIOD_RULES) {
            this.keepPerPeriod(
                newestFirst,
                retention[rule],
                backup => this.resolvePeriod(getZonedDate(backup.createdAt, timeZone), rule),
                kept
            );
        }
        return newestFirst.filter(b => !kept.has(b.id));
    }

    /**
     * Keeps the newest backup of each of the given number of periods, the newest period first.
     * @param newestFirst - The backups, the newest first.
     * @param count - How many periods, or undefined for a rule that is not used.
     * @param periodOf - The period a backup falls in.
     * @param kept - The backups kept so far, which count for no period here and are added to.
     */
    private static keepPerPeriod(
        newestFirst: RetainedBackup[],
        count: number | undefined,
        periodOf: (backup: RetainedBackup) => string,
        kept: Set<string>
    ): void {
        if (count == undefined) {
            return;
        }
        let keptHere: number = 0;
        let lastPeriod: string | undefined;
        for (const backup of newestFirst) {
            const period: string = periodOf(backup);
            if (period === lastPeriod) {
                continue;
            }
            lastPeriod = period;
            // a period whose newest backup an earlier rule kept is used up all the same, as borg does
            if (!kept.has(backup.id)) {
                kept.add(backup.id);
                keptHere++;
                if (keptHere === count) {
                    return;
                }
            }
        }
        // a rule with fewer periods behind it than it asks for keeps the oldest backup too, so that a
        // policy that just started does not delete the one backup reaching furthest back
        const oldest: RetainedBackup | undefined = newestFirst.at(-1);
        if (oldest != undefined) {
            kept.add(oldest.id);
        }
    }

    /**
     * Names the period of a rule a moment falls in.
     * @param date - The moment, in the time zone of the retention.
     * @param rule - The rule.
     * @returns The period, the same for every moment in it.
     */
    private static resolvePeriod(date: ZonedDate, rule: PeriodRule): string {
        switch (rule) {
            case 'hourly': {
                return `${date.year}-${date.month}-${date.day}T${date.hours}`;
            }
            case 'daily': {
                return `${date.year}-${date.month}-${date.day}`;
            }
            case 'weekly': {
                return this.resolveIsoWeek(date);
            }
            case 'monthly': {
                return `${date.year}-${date.month}`;
            }
            case 'quarterly': {
                return `${date.year}-Q${Math.floor(date.month / 3)}`;
            }
            case 'yearly': {
                return String(date.year);
            }
        }
    }

    /**
     * Names the ISO week a day falls in: weeks start on Monday, and the first week of a year is the
     * one holding its first Thursday, so a week belongs to the year most of its days are in.
     * @param date - The day.
     * @returns The year of the week and its number.
     */
    private static resolveIsoWeek(date: ZonedDate): string {
        const day: number = Date.UTC(date.year, date.month, date.day);
        // the Thursday of the same week decides the year it belongs to
        const thursday: Date = new Date(day + ((3 - ((date.weekday + 6) % 7)) * DAY_IN_MS));
        const year: number = thursday.getUTCFullYear();
        const week: number = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_IN_MS / 7) + 1;
        return `${year}-W${week}`;
    }
}