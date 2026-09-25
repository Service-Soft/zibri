import { TsxEmailComponent } from '../../tsx/tsx-email-component.model';
import { LogLevel } from '../log-level.enum';
import { Log } from '../log.model';
import { logToConsole } from './log-to-console.function';
import { logToDb } from './log-to-db.function';
import { createLogToEmail, EmailLoggerTransportConfig, EmailLoggerTransportConfigInput } from './log-to-email.function';

/**
 * Properties for a log email template.
 */
type LogEmailTemplateProps = {
    /**
     * The entries this email is reporting, oldest first.
     *
     * A list rather than one entry, because one mail per entry is what turns a log storm into a mail
     * storm. It holds at most `maxEntriesPerEmail` of them - the subject says how many there were
     * in total.
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
    register: 'directly' | 'afterStartup'
};

/**
 * What a transport does with the entries it is given.
 *
 * A batch rather than one entry, because the logger buffers and therefore always has one - and a
 * transport handed them one at a time cannot do anything but one write per line. That is one INSERT
 * per log call on the way to the database and one queued mail per log call on the way to a mailbox.
 *
 * Only entries this transport's level admits are in the list, and it is never called with an empty
 * one. The order is the order they were logged.
 */
export type LoggerTransportSend<T extends BaseLoggerTransportConfig> = (logs: Log[], config: T) => void | Promise<void>;

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
     * Creates a new logger transport that prints the log to the terminal.
     * @param level - The log level at which the transport should be active.
     * @returns The newly created transport.
     */
    static console(level: LogLevel): LoggerTransport<BaseLoggerTransportConfig> {
        return this.create<BaseLoggerTransportConfig>({ level, name: 'ConsoleLoggerTransport', register: 'directly' }, logToConsole);
    }

    /**
     * Creates a new logger transport that saves the log into the data source.
     * @param level - The log level at which the transport should be active.
     * @returns The newly created transport.
     */
    static db(level: LogLevel): LoggerTransport<BaseLoggerTransportConfig> {
        return this.create<BaseLoggerTransportConfig>({ level, name: 'DbLoggerTransport', register: 'afterStartup' }, logToDb);
    }

    /**
     * Creates a new logger transport that sends the logs via email.
     *
     * The send is built per transport rather than shared, because throttling needs somewhere to
     * remember when it last sent and how much it has swallowed since - and that belongs to this
     * transport rather than to every transport at once.
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