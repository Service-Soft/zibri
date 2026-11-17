import { TsxEmailComponent } from '../../tsx/tsx-email-component.model';
import { LogLevel } from '../log-level.enum';
import { Log } from '../log.model';
import { LogBudget } from './log-budget';
import { logToConsole } from './log-to-console.function';
import { logToDb } from './log-to-db.function';
import { createLogToEmail, EmailLoggerTransportConfig, EmailLoggerTransportConfigInput } from './log-to-email.function';
import { logToJson } from './log-to-json.function';

/**
 * Properties for a log email template.
 */
export type LogEmailTemplateProps = {
    /**
     * The entries this email is reporting, oldest first.
     *
     * At most `maxEntriesPerEmail` of them - the subject says how many there were in total.
     */
    logs: Log[]
};

/**
 * Definition for a log email template.
 */
export type LogEmailTemplate = TsxEmailComponent<LogEmailTemplateProps>;

/**
 * The base configuration options shared by all logger transports.
 */
export type BaseLoggerTransportConfig = {
    /**
     * The name of the transport.
     */
    name: string,
    /**
     * The log level at which the transport should be active.
     */
    level: LogLevel,
    /**
     * Whether to register the transport as soon as possible or after the startup of the app.
     *
     * This is useful if the transport eg. Depends on a data source being available.
     */
    register: 'directly' | 'afterStartup',
    /**
     * The level of the entries of some origins, in place of `level`, keyed by a part of the path of
     * the file that logs them, such as `'/services/payment'`. The longest key the path contains wins,
     * and the extension of a key or of the file does not count.
     * @default undefined
     */
    levelsByOrigin?: Record<string, LogLevel>
};

/**
 * The options of a console or JSON logger transport.
 */
export type LoggerTransportOptions = Pick<BaseLoggerTransportConfig, 'levelsByOrigin'>;

// A batch rather than one entry, because the logger buffers and therefore always has one - and a
// transport handed them one at a time cannot do anything but one write per line. That is one INSERT
// per log call on the way to the database and one queued mail per log call on the way to a mailbox.
/**
 * What a transport does with the entries it is given, a batch at a time.
 *
 * Only entries this transport's level admits are in the list, and it is never called with an empty
 * one. The order is the order they were logged.
 */
export type LoggerTransportSend<T extends BaseLoggerTransportConfig> = (logs: Log[], config: T) => void | Promise<void>;

/**
 * Writes out what a transport holds back, for a transport that holds anything back. The logger calls
 * it when it is flushed, after every queued entry was sent.
 */
export type LoggerTransportFlush = () => Promise<void>;

/**
 * The options of a db logger transport.
 */
export type DbLoggerTransportOptions = LoggerTransportOptions & {
    /**
     * How many entries a minute the transport writes as rows of their own, on this instance.
     *
     * Past it, entries of the same level, message and metadata are written as one row per kind when
     * the minute ends, counted under `context.collapsed`. At most 100 kinds are kept apart; the rest
     * are counted in one row per level.
     * Defaults to 1000.
     */
    maxEntriesPerMinute?: number
};

// eslint-disable-next-line jsdoc/require-jsdoc
export class LoggerTransport<T extends BaseLoggerTransportConfig> {
    /**
     * The configuration options of the transport.
     */
    config: T;
    /**
     * What should happen when new logs should be sent.
     */
    send: LoggerTransportSend<T>;
    /**
     * Writes out what the transport holds back, if it holds anything back.
     */
    flush?: LoggerTransportFlush;

    private constructor(config: T, send: LoggerTransportSend<T>, flush?: LoggerTransportFlush) {
        this.config = config;
        this.send = send;
        this.flush = flush;
    }

    /**
     * The lowest level this transport admits from any origin.
     * @returns The level.
     */
    resolveLowestLevel(): LogLevel {
        return Math.min(this.config.level, ...Object.values(this.config.levelsByOrigin ?? {}));
    }

    /**
     * The level this transport admits from the given origin.
     * @param origin - The path of the file that logs the entry.
     * @returns The level of the longest key of `levelsByOrigin` the origin contains, or `level` without one.
     */
    resolveLevel(origin: string): LogLevel {
        const levels: Record<string, LogLevel> | undefined = this.config.levelsByOrigin;
        if (levels == undefined) {
            return this.config.level;
        }
        // without the extension, since one file is `.ts` or `.js` depending on how the application runs:
        // a key has to mean the same file in a test, in development and in a bundle
        const file: string = LoggerTransport.removeExtension(origin);
        const key: string | undefined = Object.keys(levels)
            .filter(k => file.includes(LoggerTransport.removeExtension(k)))
            .sort((a, b) => LoggerTransport.removeExtension(b).length - LoggerTransport.removeExtension(a).length)[0];
        return key == undefined ? this.config.level : levels[key] ?? this.config.level;
    }

    private static removeExtension(path: string): string {
        return path.replace(/\.[cm]?[jt]sx?$/, '');
    }

    /**
     * Creates a new logger transport.
     * @param config - The configuration to be used by the transport.
     * @param send - What should happen when a new log should be send.
     * @param flush - Writes out what the transport holds back, for a transport that holds anything back.
     * @returns The newly created transport.
     */
    static create<X extends BaseLoggerTransportConfig>(
        config: X,
        send: LoggerTransportSend<X>,
        flush?: LoggerTransportFlush
    ): LoggerTransport<X> {
        return new this(config, send, flush);
    }

    /**
     * Creates a new logger transport that prints the log to the terminal.
     * @param level - The log level at which the transport should be active.
     * @param options - The levels of some origins.
     * @returns The newly created transport.
     */
    static console(level: LogLevel, options: LoggerTransportOptions = {}): LoggerTransport<BaseLoggerTransportConfig> {
        return this.create<BaseLoggerTransportConfig>(
            { ...options, level, name: 'ConsoleLoggerTransport', register: 'directly' },
            logToConsole
        );
    }

    /**
     * Creates a new logger transport that writes the log to standard output as one JSON object per
     * entry and line, which log collectors read.
     * @param level - The log level at which the transport should be active.
     * @param options - The levels of some origins.
     * @returns The newly created transport.
     */
    static json(level: LogLevel, options: LoggerTransportOptions = {}): LoggerTransport<BaseLoggerTransportConfig> {
        return this.create<BaseLoggerTransportConfig>({ ...options, level, name: 'JsonLoggerTransport', register: 'directly' }, logToJson);
    }

    /**
     * Creates a new logger transport that saves the log into the data source.
     * @param level - The log level at which the transport should be active.
     * @param options - How many rows it writes, and the levels of some origins.
     * @returns The newly created transport.
     */
    static db(level: LogLevel, options: DbLoggerTransportOptions = {}): LoggerTransport<BaseLoggerTransportConfig> {
        // without a budget a caller fills the log table at request rate. Per transport, for the
        // reason the email transport keeps its throttle per transport
        const budget: LogBudget = new LogBudget(options.maxEntriesPerMinute ?? 1000, logToDb);
        return this.create<BaseLoggerTransportConfig>(
            { level, name: 'DbLoggerTransport', register: 'afterStartup', levelsByOrigin: options.levelsByOrigin },
            async logs => await budget.write(logs),
            async () => await budget.flush()
        );
    }

    // the send is built per transport rather than shared, because throttling needs somewhere to
    // remember when it last sent and how much it has swallowed since
    /**
     * Creates a new logger transport that sends the logs via email.
     * @param config - The log level at which the transport should be active, and how much mail it may send.
     * @returns The newly created transport.
     */
    static email(config: EmailLoggerTransportConfigInput): LoggerTransport<EmailLoggerTransportConfig> {
        return this.create<EmailLoggerTransportConfig>(
            { register: 'afterStartup', name: 'EmailLoggerTransport', ...config },
            createLogToEmail()
        );
    }
}