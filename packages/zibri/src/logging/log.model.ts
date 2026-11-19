import { FrameworkColumnRegistry } from '../data-source/migration/framework-column.registry';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { GlobalRegistry } from '../global/global-registry';
import { LogContext } from './log-context.model';
import { LogLevel } from './log-level.enum';

/**
 * The data saved for a log entry.
 */
@Entity({ allowOrphan: true, expiresBy: 'cleanupAt' })
export class Log extends BaseEntity {
    /**
     * The tenant the entry was logged in, or null for one logged outside every tenant.
     */
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string | null;
    /**
     * The application that logged the entry: the name of the application options for an entry of the server, the
     * name a frontend sends for one of its own. Null for an entry logged while no application ran, like by a test
     * harness before it created one.
     */
    @Property.string({ required: false })
    application?: string | null;
    /**
     * The log level.
     */
    @Property.number({ format: 'integer', enum: LogLevel })
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

// the logs stored before were written by an application, and the one that adds the column is the one that wrote
// them, unless several shared the table
FrameworkColumnRegistry.register({ entity: Log, property: 'application', storedValue: () => GlobalRegistry.getAppData('name') });