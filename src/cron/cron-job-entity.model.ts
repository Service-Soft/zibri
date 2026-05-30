import { type CronExpressionString } from './cron-expression.utilities';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitStrict } from '../types/omit-strict.type';

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
     * Whether or not the cron job is currently active.
     */
    @Property.boolean()
    active!: boolean;

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
     * The error message that this cron job failed with.
     */
    @Property.string({ required: false })
    errorMessage?: string | null;
}

/**
 * The data for creating a new cron job entity.
 */
export type CreateCronJobEntityData = OmitStrict<CronJobEntity, 'id'>;