import { randomFillSync } from 'node:crypto';

import { TraceSpanContext } from './trace-span-context.model.ts';
import { KnownHeader } from '../http/known-header.enum.ts';

/**
 * Headers as they arrive, where one that was sent twice is an array.
 */
export type TraceContextHeaders = Record<string, string | string[] | undefined>;

/**
 * The version this writes, and the only one whose trailing data is refused rather than ignored.
 */
const writtenVersion: string = '00';

/**
 * The version the standard reserves so that it can never be a real one.
 */
const forbiddenVersion: string = 'ff';

/**
 * `version-traceId-spanId-flags`, with anything a later version appended captured separately.
 *
 * Lowercase only, because the standard writes the fields in lowercase hex and a value that is not
 * is one some other implementation produced by accident.
 */
const traceparentPattern: RegExp = /^([\da-f]{2})-([\da-f]{32})-([\da-f]{16})-([\da-f]{2})(-.*)?$/;

const allZeroes: RegExp = /^0+$/;

/**
 * A tracestate key: lowercase, or a tenant and a system separated by an `@`.
 */
const traceStateKeyPattern: RegExp = /^[\da-z][\d*/_a-z-]{0,255}(@[\da-z][\d*/_a-z-]{0,13})?$/;

/**
 * A tracestate value: printable ascii, without the two characters that separate the list.
 */
const traceStateValuePattern: RegExp = /^[\x20-\x2B\x2D-\x3C\x3E-\x7E]{0,256}$/;

const maxTraceStateMembers: number = 32;

const sampledFlag: number = 0b0000_0001;

const traceIdBytes: number = 16;

const spanIdBytes: number = 8;

/**
 * Random bytes taken ahead of time, and how many ids one draw covers.
 *
 * Drawing per id is the single most expensive thing tracing does: every call reaches the platform's
 * generator, and an id costs more that way than recording the whole span costs. Taking the same
 * stream in larger pieces is the same stream - a generator is not more predictable because it was
 * read in one call instead of five hundred - and is what id generation elsewhere has always done.
 */
const pooledIdCount: number = 512;

const entropyPool: Buffer = Buffer.allocUnsafe(traceIdBytes * pooledIdCount);

/**
 * Reads and writes the `traceparent` and `tracestate` headers of the W3C Trace Context standard.
 *
 * What makes a trace one trace: an id that survives crossing a process boundary, in the spelling
 * every other tracing system already reads. Nothing here needs a tracer to be registered - an
 * application that records no spans still passes the context on, so a service that does record them
 * on the far side of this one is not left starting a second trace for the same work.
 */
export abstract class TraceContextUtilities {
    /**
     * How far into the pool the ids handed out so far reach. Starts spent, so the first id fills it.
     */
    private static entropyOffset: number = entropyPool.length;

    /**
     * Reads the trace context an incoming request carries.
     *
     * Anything that does not parse is treated as though nothing arrived, which is what the standard
     * asks for: a broken header is a bug in whoever sent it, and refusing the request over it would
     * make this application the one that fails.
     * @param headers - The headers of the request.
     * @returns The context, or undefined when none arrived or what arrived cannot be read.
     */
    static findSpanContext(headers: TraceContextHeaders): TraceSpanContext | undefined {
        const traceparent: string | undefined = this.findFirstValue(headers[KnownHeader.TRACEPARENT]);
        if (traceparent == undefined) {
            return undefined;
        }

        const match: RegExpExecArray | null = traceparentPattern.exec(traceparent);
        if (match == undefined) {
            return undefined;
        }
        const [, version = '', traceId = '', spanId = '', flags = '', trailing] = match;

        if (version === forbiddenVersion) {
            return undefined;
        }
        // a later version may append fields, and the four that exist today keep their place - so
        // one is read as far as it is understood. The version written here has no trailing fields,
        // so anything after them is not a newer version but a malformed header
        if (version === writtenVersion && trailing != undefined) {
            return undefined;
        }
        if (allZeroes.test(traceId) || allZeroes.test(spanId)) {
            return undefined;
        }

        return {
            traceId,
            spanId,
            sampled: (Number.parseInt(flags, 16) & sampledFlag) === sampledFlag,
            traceState: this.findTraceState(headers)
        };
    }

    /**
     * Writes a context into the headers a request carries it in.
     * @param context - The context to send.
     * @returns The headers to add to the request.
     */
    static resolveHeaders(context: TraceSpanContext): Record<string, string> {
        const traceparent: string = this.resolveTraceparent(context);
        if (context.traceState == undefined) {
            return { [KnownHeader.TRACEPARENT]: traceparent };
        }
        return { [KnownHeader.TRACEPARENT]: traceparent, [KnownHeader.TRACESTATE]: context.traceState };
    }

    /**
     * Writes a context as the one header that identifies it.
     * @param context - The context to write.
     * @returns The value of a `traceparent`.
     */
    static resolveTraceparent(context: TraceSpanContext): string {
        const flags: string = context.sampled ? '01' : '00';
        return `${writtenVersion}-${context.traceId}-${context.spanId}-${flags}`;
    }

    /**
     * The context for a new piece of work.
     *
     * Used where there is no tracer to ask: the trace still needs an id for the log lines to carry
     * and for the next service to continue, whether or not anything here records spans.
     * @param parent - The context this continues, if any. Absent starts a new trace.
     * @returns The context.
     */
    static resolveSpanContext(parent: TraceSpanContext | undefined): TraceSpanContext {
        if (parent != undefined) {
            return { ...parent, spanId: this.generateSpanId() };
        }
        return {
            traceId: this.generateTraceId(),
            spanId: this.generateSpanId(),
            // a recommendation rather than a claim, which is what the standard says the flag is. An
            // application recording nothing itself still wants the services it calls to record, and
            // a trace with a hole where this process sits is worth more than no trace at all
            sampled: true
        };
    }

    /**
     * A new trace id.
     * @returns 32 lowercase hex characters.
     */
    static generateTraceId(): string {
        return this.takeRandomHex(traceIdBytes);
    }

    /**
     * A new span id.
     * @returns 16 lowercase hex characters.
     */
    static generateSpanId(): string {
        return this.takeRandomHex(spanIdBytes);
    }

    /**
     * The next unused bytes of the pool, as hex, refilling it when it runs out.
     * @param bytes - How many bytes the id is.
     * @returns Twice that many lowercase hex characters.
     */
    private static takeRandomHex(bytes: number): string {
        if (this.entropyOffset + bytes > entropyPool.length) {
            randomFillSync(entropyPool);
            this.entropyOffset = 0;
        }
        const hex: string = entropyPool.toString('hex', this.entropyOffset, this.entropyOffset + bytes);
        this.entropyOffset += bytes;
        return hex;
    }

    /**
     * The vendor state that travels with the trace, when it is readable.
     *
     * Dropped rather than repaired when it is not, and the traceparent beside it is kept either way:
     * the two are separate statements, and losing the vendor's own state is survivable in a way that
     * losing the trace is not.
     * @param headers - The headers of the request.
     * @returns The tracestate to pass on, or undefined.
     */
    private static findTraceState(headers: TraceContextHeaders): string | undefined {
        const traceState: string | undefined = this.findFirstValue(headers[KnownHeader.TRACESTATE]);
        if (traceState == undefined) {
            return undefined;
        }

        const members: string[] = traceState.split(',').map(member => member.trim())
            .filter(member => member.length > 0);
        if (members.length === 0 || members.length > maxTraceStateMembers) {
            return undefined;
        }
        return members.every(member => this.isTraceStateMember(member)) ? traceState : undefined;
    }

    /**
     * Whether one entry of a tracestate list is spelled the way the standard spells one.
     * @param member - The entry, already trimmed.
     * @returns True when it is a key and a value.
     */
    private static isTraceStateMember(member: string): boolean {
        const separator: number = member.indexOf('=');
        if (separator <= 0) {
            return false;
        }
        const key: string = member.slice(0, separator);
        const value: string = member.slice(separator + 1);
        return traceStateKeyPattern.test(key) && traceStateValuePattern.test(value);
    }

    /**
     * The one value to read where a header may have arrived more than once.
     *
     * The first: a proxy chain prepends, so the first is the one the request started with.
     * @param value - What the header holds.
     * @returns The value, or undefined when the header is absent or empty.
     */
    private static findFirstValue(value: string | string[] | undefined): string | undefined {
        const first: string | undefined = Array.isArray(value) ? value[0] : value;
        return first == undefined || first.length === 0 ? undefined : first;
    }
}