import { type CronExpressionString } from './cron-expression.utilities.ts';
import { BaseEntity } from '../entity/base-entity.model.ts';
import { Entity } from '../entity/decorators/entity.decorator.ts';
import { Property } from '../entity/decorators/property.decorator.ts';
import { type Timezone, timezoneEnum } from '../localization/models/timezone.model.ts';
import { OmitStrict } from '../types/omit-strict.type.ts';

/**
 * Whether a cron job is on the schedule, and when it is not, why not.
 *
 * A boolean could only say that a job is off, which is the half that does not help: being turned off
 * by somebody who meant it and being taken off the schedule by a failure call for opposite handling
 * the next time the app starts.
 */
export enum CronJobState {
    /**
     * On the schedule.
     */
    ACTIVE = 'ACTIVE',
    /**
     * Off the schedule because that is what was asked for, either in the job's configuration or
     * through the cron service. Nothing puts it back but an explicit enable.
     */
    INACTIVE = 'INACTIVE',
    /**
     * Off the schedule because its ticks threw as often in a row as the job's `onFailure` allows.
     */
    STOPPED_ON_ERROR = 'STOPPED_ON_ERROR'
}

/**
 * The cron job entity that is stored in the db.
 */
@Entity({ tenant: 'shared', allowOrphan: true })
export class CronJobEntity extends BaseEntity {
    /**
     * The name of the cron job.
     */
    @Property.string({ unique: true })
    name!: string;

    /**
     * Where the job is declared: 'code' for a job class of the application, which only `enable`,
     * `disable` and `changeCron` change at runtime.
     */
    // a string rather than an enum: jobs created at runtime are planned to name the tenant that
    // created them here
    @Property.string()
    source!: 'code' | string & {};

    /**
     * The cron expression.
     */
    @Property.string()
    cron!: CronExpressionString;

    /**
     * The time zone the cron expression is read in, eg. 'Europe/Berlin'.
     *
     * Half of a schedule: "03:00" names no moment on its own, and the same expression means different
     * things in different places and at different times of the year. Stored next to the expression
     * because the two are only meaningful together.
     */
    @Property.string({ enum: timezoneEnum })
    timezone!: Timezone;

    /**
     * Whether the cron job is on the schedule, and when it is not, why not.
     */
    @Property.string({ enum: CronJobState })
    state!: CronJobState;

    /**
     * The state to return to when the app next starts, or undefined when there is nothing to undo.
     *
     * Written only where the framework itself took the job off the schedule, which is the case a
     * restart can plausibly resolve - a new deploy, a dependency that has since recovered. A job
     * somebody turned off plants nothing here, so it stays off until somebody turns it back on.
     */
    @Property.string({ enum: CronJobState, required: false })
    previousState?: CronJobState | null;

    /**
     * Whether or not the cron job should run on app start.
     */
    @Property.boolean()
    runOnInit!: boolean;

    /**
     * How many ticks in a row have failed, on every instance. A tick that succeeds sets it back to 0.
     */
    @Property.number({ format: 'integer' })
    consecutiveFailures!: number;

    /**
     * The moment before which the job skips its slots, because it keeps failing and backs off, or
     * undefined when it runs every slot.
     */
    @Property.date({ required: false })
    backedOffUntil?: Date | null;

    /**
     * The timestamp at which this cron job has been last run.
     */
    @Property.date({ required: false })
    lastRun?: Date | null;

    /**
     * How far back a start looks for a scheduled time that passed while nothing was up to run it,
     * or undefined to let a missed one stay missed. Also how late a running process may reach a
     * scheduled time and still run it; undefined allows a second.
     *
     * Whether owing the work still means anything once it is late is a property of the work, and only
     * the job knows: a nightly invoice run is worth doing at 06:00 when the outage cleared, and a
     * collection of this minute's metrics is not worth doing at all. Past this age the make-up run
     * stops being a service and becomes a surprise, which is where the limit comes from.
     */
    @Property.number({ required: false })
    catchUpWithinMs?: number | null;

    /**
     * The error message that this cron job failed with.
     */
    @Property.string({ required: false })
    errorMessage?: string | null;
}

/**
 * The data for creating a new cron job entity.
 */
export type CreateCronJobEntityData = OmitStrict<CronJobEntity, 'id'>;