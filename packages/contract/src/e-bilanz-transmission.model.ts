import { type EBilanzFilingModel } from './e-bilanz-filing.model';
import { type EBilanzTransmissionStatus } from './e-bilanz-transmission-status.enum';

/**
 * A transmission of an E-Bilanz, from the record it was started with and the records of its result.
 */
export type EBilanzTransmissionModel = {
    /**
     * The id of the record it was started with, which the records of its result name as their `transmissionId`.
     */
    id: string,
    /**
     * Whether it is a test, which the tax administration does not keep.
     */
    test: boolean,
    /**
     * Where it stands: `transmitting` until it has a result. A result of the transmitter replaces an `unknown`
     * concluded before it.
     */
    status: EBilanzTransmissionStatus,
    /**
     * Whether the E-Bilanz may have reached the tax administration with it.
     */
    mayHaveBeenSent: boolean,
    /**
     * The id of the user who started it.
     */
    startedBy: string,
    /**
     * When it was started.
     */
    startedAt: string,
    /**
     * The record of the result its status is from, with its ticket, messages, protocol and error, or null while it
     * is transmitting.
     */
    result: EBilanzFilingModel | null
};