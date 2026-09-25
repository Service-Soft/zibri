import { type CronExpressionString } from './cron-expression.utilities';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { type Timezone, timezoneEnum } from '../localization/models/timezone.model';
import { OmitStrict } from '../types/omit-strict.type';

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
     * Off the schedule because a tick threw and the job is configured to stop for that.
     */
    STOPPED_ON_ERROR = 'STOPPED_ON_ERROR'
}

/**
 * The cron job entity that is stored in the db.
 */
@Entity()
export class CronJobEntity extends BaseEntity {
    /**
     * The name of the cron job.
     */
    @Property.string({ unique: true })
    name!: string;

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
     * Whether or not the cron job should stop on an error.
     */
    @Property.boolean()
    stopOnError!: boolean;

    /**
     * The timestamp at which this cron job has been last run.
     */
    @Property.date({ required: false })
    lastRun?: Date | null;

    /**
     * How far back a start looks for a scheduled time that passed while nothing was up to run it,
     * or undefined to let a missed one stay missed.
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