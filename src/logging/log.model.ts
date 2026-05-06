import { LogContext } from './log-context.model';
import { LogLevel } from './log-level.enum';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';

/**
 * The data saved for a log entry.
 */
@Entity({ allowOrphan: true })
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