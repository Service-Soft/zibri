import { type EBilanzTransmissionModel } from 'zibri-contract';

import { Property } from '../../../../entity/decorators/property.decorator';
import { EBilanzFiling } from './e-bilanz-filing.model';
import { EBilanzTransmissionStatus } from './e-bilanz-transmission-status.enum';

/**
 * A transmission of an E-Bilanz, from the record it was started with and the records of its result.
 */
export class EBilanzTransmissionSummary implements Omit<EBilanzTransmissionModel, 'startedAt' | 'result'> {
    /**
     * The id of the record it was started with, which the records of its result name as their `transmissionId`.
     */
    @Property.string({ format: 'uuid' })
    id!: string;

    /**
     * Whether it is a test, which the tax administration does not keep.
     */
    @Property.boolean()
    test!: boolean;

    /**
     * Where it stands: `transmitting` until it has a result. A result of the transmitter replaces an `unknown`
     * concluded before it.
     */
    @Property.string({ enum: EBilanzTransmissionStatus })
    status!: EBilanzTransmissionStatus;

    /**
     * Whether the E-Bilanz may have reached the tax administration with it.
     */
    @Property.boolean()
    mayHaveBeenSent!: boolean;

    /**
     * The id of the user who started it.
     */
    @Property.string()
    startedBy!: string;

    /**
     * When it was started.
     */
    @Property.date()
    startedAt!: Date;

    /**
     * The record of the result its status is from, with its ticket, messages, protocol and error, or null while it
     * is transmitting.
     */
    @Property.object({ cls: () => EBilanzFiling, required: false })
    result!: EBilanzFiling | null;
}