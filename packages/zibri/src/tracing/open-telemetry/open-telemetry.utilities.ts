import { OpenTelemetryApi, OpenTelemetryHrTime } from './open-telemetry-api.model.ts';
import { TraceSpanKind } from '../trace-span-kind.enum.ts';
import { TraceSpanStatus } from '../trace-span-status.enum.ts';

/**
 * What the api calls each of the framework's kinds.
 */
const kindKeys: Record<TraceSpanKind, 'INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER'> = {
    [TraceSpanKind.INTERNAL]: 'INTERNAL',
    [TraceSpanKind.SERVER]: 'SERVER',
    [TraceSpanKind.CLIENT]: 'CLIENT',
    [TraceSpanKind.PRODUCER]: 'PRODUCER',
    [TraceSpanKind.CONSUMER]: 'CONSUMER'
};

/**
 * What the api calls each of the framework's statuses.
 */
const statusKeys: Record<TraceSpanStatus, 'UNSET' | 'OK' | 'ERROR'> = {
    [TraceSpanStatus.UNSET]: 'UNSET',
    [TraceSpanStatus.OK]: 'OK',
    [TraceSpanStatus.ERROR]: 'ERROR'
};

const nanosecondsPerMillisecond: number = 1_000_000;

const millisecondsPerSecond: number = 1000;

/**
 * Translates between what the framework says about a span and what the api numbers it.
 *
 * The names are written here and the numbers are read off the installed package, so a value the api
 * ever renumbers is right by construction rather than by this file having been updated. Both
 * directions live together because a span is written through the api and read back out of it.
 */
export abstract class OpenTelemetryUtilities {
    /**
     * The api's number for a kind of work.
     * @param kind - The framework's kind.
     * @param api - The installed api.
     * @returns What to start the span with.
     */
    static resolveApiKind(kind: TraceSpanKind, api: OpenTelemetryApi): number {
        return api.SpanKind[kindKeys[kind]];
    }

    /**
     * The api's number for how a span ended.
     * @param status - The framework's status.
     * @param api - The installed api.
     * @returns What to end the span with.
     */
    static resolveApiStatus(status: TraceSpanStatus, api: OpenTelemetryApi): number {
        return api.SpanStatusCode[statusKeys[status]];
    }

    /**
     * The kind of work a recorded span covers.
     * @param apiKind - What the sdk reported.
     * @param api - The installed api.
     * @returns The framework's kind, and internal for a number it does not know.
     */
    static findKind(apiKind: number, api: OpenTelemetryApi): TraceSpanKind {
        return Object.values(TraceSpanKind).find(kind => this.resolveApiKind(kind, api) === apiKind)
            ?? TraceSpanKind.INTERNAL;
    }

    /**
     * How a recorded span ended.
     * @param apiStatus - What the sdk reported.
     * @param api - The installed api.
     * @returns The framework's status, and unset for a number it does not know.
     */
    static findStatus(apiStatus: number, api: OpenTelemetryApi): TraceSpanStatus {
        return Object.values(TraceSpanStatus).find(status => this.resolveApiStatus(status, api) === apiStatus)
            ?? TraceSpanStatus.UNSET;
    }

    /**
     * A moment or a length the sdk states in seconds and nanoseconds, as milliseconds.
     * @param hrTime - What the sdk reported.
     * @returns The same value in milliseconds, keeping the fraction.
     */
    static resolveMilliseconds(hrTime: OpenTelemetryHrTime): number {
        const [seconds, nanoseconds] = hrTime;
        return (seconds * millisecondsPerSecond) + (nanoseconds / nanosecondsPerMillisecond);
    }
}