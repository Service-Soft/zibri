import { AuditEvent, AuditOutcome } from './audit-event.model';
import { errorToLoggedError } from './error-to-logged-error.function';
import { LogBuffer } from './log-buffer';
import { LogCleanupCronJob } from './log-cleanup.cron-job';
import { LogContextInput, LogRequestContext } from './log-context.model';
import { LogLevel } from './log-level.enum';
import { Log } from './log.model';
import { LoggerInterface } from './logger.interface';
import { ZibriApplication } from '../application/application';
import { logToDb } from './transport/log-to-db.function';
import { BaseLoggerTransportConfig, LoggerTransport } from './transport/logger-transport.model';
import { AlsUtilities } from '../context/als.utilities';
import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { ErrorUtilities } from '../error-handling/error.utilities';
import { GlobalRegistry } from '../global/global-registry';
import { OnAppInit } from '../global/on-app-init.interface';
import { OnAppShutdown } from '../global/on-app-shutdown.interface';
import { HttpRequest } from '../http/http-request.model';
import { KnownHeader } from '../http/known-header.enum';
import { MiddlewarePhase } from '../http/middleware-phase.enum';
import { TraceContextUtilities } from '../tracing/trace-context.utilities';
import { TraceSpanContext } from '../tracing/trace-span-context.model';
import { TracingUtilities } from '../tracing/tracing.utilities';
import { OmitStrict } from '../types/omit-strict.type';
import { resolveCallSites } from '../utilities/resolve-call-sites.function';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';

/**
 * Finds the file the log call came from.
 *
 * The frame is found by *name* rather than by position. Indexing a fixed depth is what made this
 * throw whenever the depth was anything else, including when `Error.stackTraceLimit` is 0 - which is
 * an ordinary production tuning, and used to make every log call in the application raise a
 * TypeError. With no frames collected this simply answers 'unknown'.
 * @returns The file the call came from, or 'unknown' when the frames do not say.
 */
function resolveOrigin(): string {
    // hides this function and everything it was called from below the logger, so the frames
    // start at `log` and the first one outside this file is the caller
    const callSites: NodeJS.CallSite[] = resolveCallSites(resolveOrigin);
    return callSites
        .map(callSite => callSite.getFileName())
        .find(fileName => fileName != undefined && fileName !== __filename)
        ?? 'unknown';
}

/**
 * Default logger implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class Logger implements LoggerInterface, OnAppInit, OnAppShutdown {

    /**
     * Entries waiting to be written.
     *
     * Logging does not wait for its transports, so nothing throttles whatever is producing logs.
     * The buffer is what refuses work instead of growing - see LogBuffer for which entry gives way.
     */
    private readonly buffer: LogBuffer;

    /**
     * The drain currently running, if there is one. Also what flush waits on.
     */
    private draining: Promise<void> | undefined;

    /**
     * The timer waiting to start the next drain, if entries are queued and none is running.
     */
    private pending: NodeJS.Timeout | undefined;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER_TRANSPORTS)
        readonly transports: LoggerTransport<BaseLoggerTransportConfig>[],
        @Inject(ZIBRI_DI_TOKENS.LOGGER_CLEANUP_AFTER_MS)
        protected readonly cleanupAfterMs: Record<LogLevel, number>,
        @Inject(ZIBRI_DI_TOKENS.LOGGER_BUFFER_CAPACITY)
        bufferCapacity: number,
        @Inject(ZIBRI_DI_TOKENS.LOGGER_FLUSH_INTERVAL_MS)
        private readonly flushIntervalMs: number
    ) {
        this.buffer = new LogBuffer(bufferCapacity);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        // only for the builtin db transport: it is what writes the table, and without it there is
        // neither a table to require nor anything for the cleanup to remove
        if (this.transports.some(t => t.send === logToDb)) {
            validateEntitiesRegistered(Logger.name, app, Log);
            if (!app.options.cronJobs.includes(LogCleanupCronJob)) {
                app.options.cronJobs.push(LogCleanupCronJob);
            }
        }
        if (inject(ZIBRI_DI_TOKENS.ACCESS_LOG)) {
            this.registerAccessLog(app);
        }
    }

    /**
     * Writes one line per finished request.
     *
     * The record that says a request happened at all. Without it the only http a log ever shows is
     * the requests that failed with a 5xx, so an endpoint answering 404 to everything, a 400 spike
     * after a client release and a route that got slow are all invisible - none of them is an error,
     * and none of them should be logged as one.
     *
     * `'close'` rather than `'finish'`, matching the metrics middleware for the same reason: `finish`
     * only fires once a response has been written in full, so a client that hung up and a request
     * that died halfway would never be recorded - the two cases most worth seeing.
     *
     * The context is built here rather than read out of async local storage, because by now there is
     * none: this runs after the request was handled, and a request that matched no route never had
     * one to begin with.
     * @param app - The application to register the middleware on.
     */
    private registerAccessLog(app: ZibriApplication): void {
        app.use((expressRequest, res, next) => {
            const start: number = performance.now();
            // express types the method as a plain string; the framework narrows it to HttpMethod on
            // the way in. The metrics middleware makes the same cast for the same reason
            const req: HttpRequest = expressRequest as HttpRequest;
            res.on('close', () => {
                // off the request rather than through async local storage: this runs once the
                // response has closed, and the middleware above wrote the resolved context onto the
                // headers for exactly this reader
                const trace: TraceSpanContext | undefined = TraceContextUtilities.findSpanContext(req.headers);
                const request: LogRequestContext = {
                    traceId: trace?.traceId,
                    spanId: trace?.spanId,
                    method: req.method,
                    url: req.originalUrl,
                    status: res.statusCode,
                    durationInMs: performance.now() - start,
                    userAgent: req.headers[KnownHeader.USER_AGENT] ?? '',
                    clientIp: req.ip ?? req.socket?.remoteAddress ?? ''
                };
                this.log(LogLevel.INFO, `${req.method} ${req.originalUrl} ${res.statusCode}`, { request });
            });
            next();
        }, MiddlewarePhase.OBSERVABILITY);
    }

    /**
     * Writes whatever is still queued before the application goes away.
     *
     * OnAppShutdown rather than afterAppShutdown, because the data sources close in the latter and
     * the db transport has nowhere to write once they have.
     */
    async onAppShutdown(): Promise<void> {
        await this.flush();
    }

    /**
     * Waits until everything queued has been handed to the transports.
     *
     * Looped rather than a single await: writing can queue more, since the notice about dropped
     * entries is itself a log entry.
     *
     * The wait before a drain is skipped here rather than waited out - a caller asking to flush is
     * saying it will not be around for the timer, which is exactly the shutdown case.
     */
    async flush(): Promise<void> {
        while (this.buffer.size || this.draining) {
            if (this.pending) {
                clearTimeout(this.pending);
                this.pending = undefined;
            }
            this.draining ??= this.drain();
            await this.draining;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    debug(message: string, context?: LogContextInput): void {
        this.log(LogLevel.DEBUG, message, context);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    info(message: string, context?: LogContextInput): void {
        this.log(LogLevel.INFO, message, context);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    warn(message: string, context?: LogContextInput): void {
        this.log(LogLevel.WARN, message, context);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    error(error: Error, context?: OmitStrict<LogContextInput, 'error'>): void {
        this.log(LogLevel.ERROR, error.message, { ...context, error });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    critical(error: Error, context?: OmitStrict<LogContextInput, 'error'>): void {
        this.log(LogLevel.CRITICAL, error.message, { ...context, error });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    audit(event: AuditEvent): void {
        // info rather than debug so that the default db transport keeps it, and warn rather than
        // error for a failure because error() wants an Error and a refused login is not one - a
        // rule keys on metadata.audit.action, not on the level.
        const level: LogLevel = event.outcome === AuditOutcome.SUCCESS ? LogLevel.INFO : LogLevel.WARN;
        const suffix: string = event.reason == undefined ? '' : ` (${event.reason})`;
        this.log(level, `${event.action} ${event.outcome}${suffix}`, { metadata: { audit: event } });
    }

    private log(level: LogLevel, message: string, context: LogContextInput | undefined): void {
        if (!this.transports.find(t => t.config.level <= level)) {
            return;
        }

        const origin: string = resolveOrigin();
        let error: Error | undefined;
        if (context && 'error' in context) {
            error = ErrorUtilities.isError(context.error) ? context.error : new Error('Error');
        }
        // whatever the caller knows wins over what can be read out of async local storage. Only the
        // access log passes one, and it is the only writer that can: it runs on 'close', where the
        // request has finished and there is no context left to read
        let request: LogRequestContext | undefined = context?.request;
        const requestContext: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (!request && requestContext?.type === 'http-request') {
            // through async local storage rather than off the header, so a line written inside a
            // span names that span rather than the request that contains it
            const trace: TraceSpanContext | undefined = TracingUtilities.getCurrentTraceContext();
            request = {
                traceId: trace?.traceId,
                spanId: trace?.spanId,
                status: requestContext.request.res?.statusCode,
                // no duration: this line is being written while the request is still being handled,
                // so the only honest answer is the one the access log gives once it has closed
                method: requestContext.request.method,
                url: requestContext.request.originalUrl,
                userAgent: requestContext.request.headers[KnownHeader.USER_AGENT] ?? '',
                clientIp: requestContext.request.ip ?? requestContext.request.socket?.remoteAddress ?? ''
            };
        }
        const log: Log = {
            id: UUIDUtilities.generate(),
            // read now, for the reason the request is: the entry is written later, outside the tenant
            tenantId: AlsUtilities.getCurrentTenant(),
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

        this.buffer.add(log);
        this.scheduleDrain();
    }

    /**
     * Arranges for what is queued to be written shortly, unless that is already arranged.
     *
     * **The wait is what makes the batch a batch.** Draining the instant an entry arrives means the
     * first entry of every quiet period is written on its own - and an application that logs one
     * line per request is quiet between requests, so every line would be its own write and the
     * batching would buy nothing on the one path it was built for. Letting entries gather for
     * `flushIntervalMs` is what turns a busy second into a handful of writes.
     *
     * Unref'd, so a pending drain never holds the process open. Shutdown flushes explicitly.
     *
     * The result is deliberately not returned. Nothing on the logging path waits for a write - that
     * is the entire point of the buffer - so the only thing allowed to await this is flush.
     */
    private scheduleDrain(): void {
        if (this.draining || this.pending) {
            return;
        }
        if (!this.flushIntervalMs) {
            this.draining = this.drain();
            return;
        }
        this.pending = setTimeout(() => {
            this.pending = undefined;
            this.draining ??= this.drain();
        }, this.flushIntervalMs);
        this.pending.unref();
    }

    /**
     * Writes everything queued, including anything that arrives while it is running.
     */
    private async drain(): Promise<void> {
        try {
            while (this.buffer.size) {
                const batch: Log[] = this.buffer.takeAll();
                const dropped: number = this.buffer.takeDropped();
                if (dropped) {
                    // reported alongside the entries that survived rather than queued, which would
                    // race with the very pressure that caused it
                    batch.push(this.droppedNotice(dropped));
                }
                await this.write(batch);
            }
        }
        finally {
            this.draining = undefined;
        }
    }

    /**
     * Hands the batch to every transport, narrowed to what each of them admits.
     *
     * The transport filter runs here rather than when the entry was made, so an entry logged during
     * boot still reaches a transport that only became available afterwards. It narrows the batch
     * rather than deciding per entry, which is what lets a transport write once for all of them -
     * the difference between one statement and one per log call.
     * @param batch - The entries to write, oldest first.
     */
    private async write(batch: Log[]): Promise<void> {
        await Promise.all(this.transports.map(async transport => {
            if (transport.config.register !== 'directly' && !GlobalRegistry.isAppInitialized() && !GlobalRegistry.isAppStarted()) {
                return;
            }
            const logs: Log[] = batch.filter(l => transport.config.level <= l.level);
            // an empty batch is a round trip that buys nothing - a transaction writing no rows, or
            // a digest of nothing
            if (!logs.length) {
                return;
            }

            try {
                await transport.send(logs, transport.config);
            }
            catch (error) {
                // console rather than this.logger: a transport that fails while reporting its own
                // failure would loop, and console is the one that cannot fail the same way.
                // Per transport, so one broken aggregator does not cost the others the whole batch
                // eslint-disable-next-line no-console
                console.error(`There was an error when logging on the transport ${transport.config.name}`, error);
            }
        }));
    }

    /**
     * Builds the entry that records how many others were dropped.
     * @param count - How many were dropped.
     * @returns The entry to write alongside the survivors.
     */
    private droppedNotice(count: number): Log {
        return {
            id: UUIDUtilities.generate(),
            createdAt: new Date(),
            cleanupAt: new Date(Date.now() + this.cleanupAfterMs[LogLevel.WARN]),
            message: `dropped ${count} log entries because the write queue was full`,
            context: { origin: 'Logger' },
            level: LogLevel.WARN
        };
    }
}