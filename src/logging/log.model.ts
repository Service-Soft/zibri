import { LogContext } from './log-context.model';
import { LogLevel } from './log-level.enum';
import { LoggedError } from './logged-error.model';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';

/**
 * The data saved for a log entry.
 */
@Entity()
export class Log extends BaseEntity {
    /**
     * The log level.
     */
    @Property.number({ enum: LogLevel })
    level!: LogLevel;
    /**
     * The message that was logged.
     */
    @Property.string()
    message!: string;
    /**
     * An error logged by LogLevel.ERROR and LogLevel.CRITICAL.
     */
    @Property.object({ cls: () => LoggedError, required: false })
    error?: LoggedError;
    /**
     * The context of the log.
     */
    @Property.object({ cls: () => LogContext })
    context!: LogContext;
    /**
     * A timestamp of the log.
     */
    @Property.date({ default: () => new Date() })
    createdAt!: Date;
    /**
     * The timestamp after which the log will be deleted.
     */
    @Property.date()
    cleanupAt!: Date;
}