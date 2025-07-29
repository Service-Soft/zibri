import { BaseEntity, Entity, Property } from '../entity';
import { LogContext } from './log-context.model';
import { LogLevel } from './log-level.enum';
import { LoggedError } from './logged-error.model';

/**
 * The data saved for a log entry.
 */
@Entity()
export class Log implements BaseEntity {
    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string({ primary: true })
    id!: string;
    /**
     * The log level.
     */
    @Property.string({ enum: LogLevel })
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