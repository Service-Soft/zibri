import { errorToLoggedError } from './error-to-logged-error.function';
import { LogCleanupCronJob } from './log-cleanup.cron-job';
import { LogContextInput, LogRequestContext } from './log-context.model';
import { LogLevel } from './log-level.enum';
import { Log } from './log.model';
import { LoggerInterface } from './logger.interface';
import { ZibriApplication } from '../application';
import { BaseLoggerTransportConfig, LoggerTransport } from './transport/logger-transport.model';
import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { ErrorUtilities } from '../error-handling/error.utilities';
import { GlobalRegistry } from '../global/global-registry';
import { OnAppInit } from '../global/on-app-init.interface';
import { KnownHeader } from '../http/known-header.enum';
import { OmitStrict } from '../types/omit-strict.type';
import { UUIDUtilities } from '../utilities/uuid.utilities';

/**
 * Default logger implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class Logger implements LoggerInterface, OnAppInit {

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER_TRANSPORTS)
        readonly transports: LoggerTransport<BaseLoggerTransportConfig>[],
        @Inject(ZIBRI_DI_TOKENS.LOGGER_CLEANUP_AFTER_MS)
        protected readonly cleanupAfterMs: Record<LogLevel, number>
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        if (!app.options.cronJobs.includes(LogCleanupCronJob)) {
            app.options.cronJobs.push(LogCleanupCronJob);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async debug(message: string, context?: LogContextInput): Promise<void> {
        await this.log(LogLevel.DEBUG, message, context);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async info(message: string, context?: LogContextInput): Promise<void> {
        await this.log(LogLevel.INFO, message, context);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async warn(message: string, context?: LogContextInput): Promise<void> {
        await this.log(LogLevel.WARN, message, context);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async error(error: Error, context?: OmitStrict<LogContextInput, 'error'>): Promise<void> {
        await this.log(LogLevel.ERROR, error.message, { ...context, error });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async critical(error: Error, context?: OmitStrict<LogContextInput, 'error'>): Promise<void> {
        await this.log(LogLevel.CRITICAL, error.message, { ...context, error });
    }

    private async log(level: LogLevel, message: string, context: LogContextInput | undefined): Promise<void> {
        if (!this.transports.find(t => t.config.level <= level)) {
            return;
        }

        // eslint-disable-next-line unicorn/error-message
        const line: string = (new Error().stack ?? '').split('\n')[3];
        const matches: RegExpMatchArray | null = line.match(/\((.*):\d+:\d+\)/);
        const origin: string = matches?.[0].split('(')[1].split(')')[0] ?? 'unknown';
        let error: Error | undefined;
        if (context && 'error' in context) {
            error = ErrorUtilities.isError(context.error) ? context.error : new Error('Error');
        }
        let request: LogRequestContext | undefined;
        const requestContext: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (requestContext?.type === 'http-request') {
            request = {
                status: requestContext.request.res?.statusCode,
                // TODO: track duration on requests
                // durationInMs: currentRequest.res?.app,
                method: requestContext.request.method,
                url: requestContext.request.originalUrl,
                userAgent: requestContext.request.headers[KnownHeader.USER_AGENT] ?? '',
                clientIp: requestContext.request.ip ?? requestContext.request.socket?.remoteAddress ?? ''
            };
        }
        const log: Log = {
            id: UUIDUtilities.generate(),
            createdAt: new Date(),
            cleanupAt: new Date(Date.now() + this.cleanupAfterMs[level]),
            message,
            context: {
                ...context,
                origin,
                request,
                error: error ? errorToLoggedError(error) : undefined,
                cache: inject(ZIBRI_DI_TOKENS.CURRENT_CACHE_CONTEXT)
            },
            level
        };

        await Promise.all(this.transports.map(async transport => {
            if (transport.config.level > level) {
                return;
            }
            if (transport.config.register !== 'directly' && !GlobalRegistry.isAppInitialized() && !GlobalRegistry.isAppStarted()) {
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