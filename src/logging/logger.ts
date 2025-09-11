import { Inject, ZIBRI_DI_TOKENS } from '../di';
import { errorToLoggedError } from './error-to-logged-error.function';
import { LogCleanupCronJob } from './log-cleanup.cron-job';
import { LogContextInput } from './log-context.model';
import { LogLevel } from './log-level.enum';
import { Log } from './log.model';
import { LoggerInterface } from './logger.interface';
import { ZibriApplication } from '../application';
import { GlobalRegistry } from '../global';
import { UUIDUtilities } from '../utilities';
import { BaseLoggerTransportConfig, LoggerTransport } from './transport/logger-transport.model';

/**
 * Default logger implementation of Zibri.
 */
export class Logger implements LoggerInterface {

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER_TRANSPORTS)
        readonly transports: LoggerTransport<BaseLoggerTransportConfig>[],
        @Inject(ZIBRI_DI_TOKENS.LOGGER_CLEANUP_AFTER_MS)
        protected readonly cleanupAfterMs: Record<LogLevel, number>
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    attachTo(app: ZibriApplication): void {
        app.options.cronJobs.push(LogCleanupCronJob);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async debug(message: string, context?: LogContextInput): Promise<void> {
        await this.log(LogLevel.DEBUG, message, undefined, context);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async info(message: string, context?: LogContextInput): Promise<void> {
        await this.log(LogLevel.INFO, message, undefined, context);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async warn(message: string, context?: LogContextInput): Promise<void> {
        await this.log(LogLevel.WARN, message, undefined, context);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async error(error: Error, context?: LogContextInput): Promise<void> {
        await this.log(LogLevel.ERROR, error.message, error, context);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async critical(error: Error, context?: LogContextInput): Promise<void> {
        await this.log(LogLevel.CRITICAL, error.message, error, context);
    }

    private async log(level: LogLevel, message: string, error: Error | undefined, context: LogContextInput | undefined): Promise<void> {
        if (!this.transports.find(t => t.config.level <= level)) {
            return;
        }

        // eslint-disable-next-line unicorn/error-message
        const line: string = (new Error().stack ?? '').split('\n')[3];
        const matches: RegExpMatchArray | null = line.match(/\((.*):\d+:\d+\)/);
        const origin: string = matches?.[0].split('(')[1].split(')')[0] ?? 'unknown';
        const log: Log = {
            id: UUIDUtilities.generate(),
            createdAt: new Date(),
            cleanupAt: new Date(Date.now() + this.cleanupAfterMs[level]),
            message,
            error: error ? errorToLoggedError(error) : undefined,
            context: { ...context, origin },
            level
        };

        await Promise.all(this.transports.map(async transport => {
            if (transport.config.level > level) {
                return;
            }
            if (transport.config.register !== 'directly' && !GlobalRegistry.isAppInitialized() && !GlobalRegistry.isAppRunning()) {
                return;
            }

            try {
                await transport.send(log, transport.config);
            }
            catch (error) {
                // eslint-disable-next-line no-console
                console.error(`There was an error when logging on the transport ${transport.config.name}`, error);
            }
        }));
    }
}