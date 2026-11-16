import { Property } from '../../entity/decorators/property.decorator';
import { type Timezone } from '../../localization/models/timezone.model';
import { type BackupPeriod } from '../backup-period.type';

/**
 * A retention a tenant keeps its backups by, as it is stored: the rules of `BackupRetention`.
 */
export class TenantBackupRetention {
    /**
     * The time zone periods are counted in.
     */
    @Property.string()
    timeZone!: Timezone;

    /**
     * Keeps every backup taken within this long before now.
     */
    @Property.number({ format: 'integer', required: false })
    withinInMs?: number;

    /**
     * Keeps this many of the newest backups.
     */
    @Property.number({ format: 'integer', required: false })
    last?: number;

    /**
     * Keeps the newest backup of each of this many hours.
     */
    @Property.number({ format: 'integer', required: false })
    hourly?: number;

    /**
     * Keeps the newest backup of each of this many days.
     */
    @Property.number({ format: 'integer', required: false })
    daily?: number;

    /**
     * Keeps the newest backup of each of this many weeks.
     */
    @Property.number({ format: 'integer', required: false })
    weekly?: number;

    /**
     * Keeps the newest backup of each of this many months.
     */
    @Property.number({ format: 'integer', required: false })
    monthly?: number;

    /**
     * Keeps the newest backup of each of this many quarters.
     */
    @Property.number({ format: 'integer', required: false })
    quarterly?: number;

    /**
     * Keeps the newest backup of each of this many years.
     */
    @Property.number({ format: 'integer', required: false })
    yearly?: number;

    /**
     * How often a resource that reads only what changed reads in full.
     */
    @Property.string({ required: false })
    fullRead?: BackupPeriod;
}