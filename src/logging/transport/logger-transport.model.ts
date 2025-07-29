import { LogLevel } from '../log-level.enum';
import { Log } from '../log.model';
import { logToConsole } from './log-to-console.function';
import { logToDb } from './log-to-db.function';
import { EmailLoggerTransportConfig, EmailLoggerTransportConfigInput, logToEmail } from './log-to-email.function';

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
     * This is useful if the transport eg. Depends on the database being available.
     */
    register: 'directly' | 'afterStartup'
};

// eslint-disable-next-line jsdoc/require-jsdoc
export type LoggerTransportSend<T extends BaseLoggerTransportConfig> = (log: Log, config: T) => void | Promise<void>;

// eslint-disable-next-line jsdoc/require-jsdoc
export class LoggerTransport<T extends BaseLoggerTransportConfig> {
    /**
     * The configuration options of the transport.
     */
    config: T;
    /**
     * What should happen when a new log should be send.
     */
    send: LoggerTransportSend<T>;

    private constructor(config: T, send: LoggerTransportSend<T>) {
        this.config = config;
        this.send = send;
    }

    /**
     * Creates a new logger transport.
     * @param config - The configuration to be used by the transport.
     * @param send - What should happen when a new log should be send.
     * @returns The newly created transport.
     */
    static create<X extends BaseLoggerTransportConfig>(config: X, send: LoggerTransportSend<X>): LoggerTransport<X> {
        return new this(config, send);
    }

    /**
     * Creates a new logger transport that prints the log to the console.
     * @param level - The log level at which the transport should be active.
     * @returns The newly created transport.
     */
    static console(level: LogLevel): LoggerTransport<BaseLoggerTransportConfig> {
        return this.create<BaseLoggerTransportConfig>({ level, name: 'ConsoleLoggerTransport', register: 'directly' }, logToConsole);
    }

    /**
     * Creates a new logger transport that saves the log into the database.
     * @param level - The log level at which the transport should be active.
     * @returns The newly created transport.
     */
    static db(level: LogLevel): LoggerTransport<BaseLoggerTransportConfig> {
        return this.create<BaseLoggerTransportConfig>({ level, name: 'DbLoggerTransport', register: 'afterStartup' }, logToDb);
    }

    /**
     * Creates a new logger transport that sends the log via email.
     * @param config - The log level at which the transport should be active.
     * @returns The newly created transport.
     */
    static email(config: EmailLoggerTransportConfigInput): LoggerTransport<EmailLoggerTransportConfig> {
        return this.create<EmailLoggerTransportConfig>({ register: 'afterStartup', name: 'EmailLoggerTransport', ...config }, logToEmail);
    }
}