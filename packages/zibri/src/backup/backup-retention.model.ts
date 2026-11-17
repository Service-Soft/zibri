import { BackupPeriod } from './backup-period.type';
import { Timezone } from '../localization/models/timezone.model';

/**
 * Which completed backups are kept, checked each time a backup completes. Every other completed backup
 * is deleted.
 *
 * Each rule keeps backups of its own. `withinInMs` keeps every backup younger than that, and `last`
 * the newest ones. A period rule, such as `daily`, keeps the newest backup of each of that many
 * periods, the newest period first. A backup an earlier rule kept counts for no later one, in the order
 * `withinInMs`, `last`, `hourly`, `daily`, `weekly`, `monthly`, `quarterly`, `yearly`. While a rule
 * finds fewer periods than it asks for, it keeps the oldest backup as well.
 *
 * A backup that reads only what changed builds on the backups before it, back to one that read in full.
 * Each of them is kept for as long as a backup building on it is.
 */
export type BackupRetention = {
    /**
     * The time zone hours, days, weeks, months, quarters and years are counted in.
     */
    timeZone: Timezone,
    /**
     * Keeps every backup taken within this long before now.
     */
    withinInMs?: number,
    /**
     * Keeps this many of the newest backups.
     */
    last?: number,
    /**
     * Keeps the newest backup of each of this many hours.
     */
    hourly?: number,
    /**
     * Keeps the newest backup of each of this many days.
     */
    daily?: number,
    /**
     * Keeps the newest backup of each of this many weeks, which start on Monday.
     */
    weekly?: number,
    /**
     * Keeps the newest backup of each of this many months.
     */
    monthly?: number,
    /**
     * Keeps the newest backup of each of this many quarters, January to March being the first.
     */
    quarterly?: number,
    /**
     * Keeps the newest backup of each of this many years.
     */
    yearly?: number,
    /**
     * How often a resource that reads only what changed reads in full instead: the first of its backups
     * in each such period does. Weekly when not set.
     */
    fullRead?: BackupPeriod
};