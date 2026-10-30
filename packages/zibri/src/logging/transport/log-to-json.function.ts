import { JsonUtilities } from '../../utilities/json.utilities';
import { LogLevel } from '../log-level.enum';
import { Log } from '../log.model';
import { BaseLoggerTransportConfig, LoggerTransportSend } from './logger-transport.model';

/**
 * The name of each level in a line, the lowercase names log collectors recognize.
 */
const levelNames: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: 'debug',
    [LogLevel.INFO]: 'info',
    [LogLevel.WARN]: 'warn',
    [LogLevel.ERROR]: 'error',
    [LogLevel.CRITICAL]: 'critical'
};

/**
 * Writes the given logs to standard output, one JSON object per entry and line.
 *
 * The trace and span ids are repeated at the top level, where a collector joins a line to its
 * trace without knowing the shape of the request context.
 * @param logs - The logs to write, oldest first.
 */
export const logToJson: LoggerTransportSend<BaseLoggerTransportConfig> = (logs: Log[]) => {
    // one write for the batch, so the lines of concurrent writers do not interleave within it
    process.stdout.write(logs.map(log => `${JsonUtilities.stringify({
        id: log.id,
        time: log.createdAt.toISOString(),
        level: levelNames[log.level],
        message: log.message,
        tenantId: log.tenantId ?? undefined,
        traceId: log.context.request?.traceId ?? undefined,
        spanId: log.context.request?.spanId ?? undefined,
        ...log.context
    })}\n`).join(''));
};