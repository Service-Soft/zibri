import { BaseArchivedEntity } from '../../../../archive/base-archived-entity.model';
import { Archive } from '../../../../archive/decorators/archive.decorator';
import { Entity } from '../../../../entity/decorators/entity.decorator';
import { Property } from '../../../../entity/decorators/property.decorator';
import { type OmitStrict } from '../../../../types/omit-strict.type';
import { ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS } from '../e-bilanz.tokens';
import { EBilanzContent } from './e-bilanz-content.model';
import { EBilanzFilingKind } from './e-bilanz-filing-kind.enum';
import { EBilanzPreparationInput } from './e-bilanz-preparation-input.model';
import { EBilanzTransmissionFailure } from './e-bilanz-transmission-failure.model';
import { EBilanzTransmissionStatus } from './e-bilanz-transmission-status.enum';

/**
 * A record of the E-Bilanz of a fiscal year, archived and never changed: its preparation with the content prepared,
 * the start of a test transmission or of its transmission, the result of one with the transfer ticket and protocol,
 * or its filing by hand with the protocol uploaded, each with who and when. Kept for the `retention` of the bookkeeping plugin, counted from the end
 * of the calendar year the fiscal year ends in, like the statements archived at its closing.
 */
// the retention here is the default of the bookkeeping plugin, which counts each row's retainUntil from its options
@Entity({ allowOrphan: true, chained: true })
@Archive({ retention: { years: 10 }, dateProperty: 'end' })
export class EBilanzFiling extends BaseArchivedEntity {
    /**
     * The tenant keeping the books.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The id of the fiscal year.
     */
    @Property.string({ format: 'uuid' })
    fiscalYearId!: string;

    /**
     * The last day of the fiscal year.
     */
    @Property.date()
    end!: Date;

    /**
     * What it records.
     */
    @Property.string({ enum: EBilanzFilingKind })
    kind!: EBilanzFilingKind;

    /**
     * The id of the record of the preparation it sends or files, or null for a preparation.
     */
    @Property.string({ format: 'uuid', required: false })
    preparationId!: string | null;

    /**
     * The SHA-256 of the content prepared, which every transmission of it names.
     */
    @Property.string()
    contentHash!: string;

    /**
     * The content prepared, or null for a record of a transmission or a filing.
     */
    @Property.object({ cls: () => EBilanzContent, required: false })
    content!: EBilanzContent | null;

    /**
     * What the preparation took beside the books, or null for a record of a transmission or a filing.
     */
    @Property.object({ cls: () => EBilanzPreparationInput, required: false })
    input!: EBilanzPreparationInput | null;

    /**
     * The id of the record of the filing a preparation corrects, the latest accepted transmission for real or filing
     * by hand before it. Null for a preparation of a fiscal year not filed, and for every other record.
     */
    @Property.string({ format: 'uuid', required: false })
    correctsFilingId!: string | null;

    /**
     * Where the transmission stands, as this record states it: `transmitting` for the record it was started with,
     * its result for the records naming it as their `transmissionId`. Null for a preparation and a filing by hand.
     */
    @Property.string({ enum: EBilanzTransmissionStatus, required: false })
    status!: EBilanzTransmissionStatus | null;

    /**
     * The id of the record a transmission was started with, which this record states the result of. Null for that
     * record itself, a preparation and a filing by hand.
     */
    @Property.string({ format: 'uuid', required: false })
    transmissionId!: string | null;

    /**
     * Whether the E-Bilanz may have reached the tax administration with the transmission: false for a failure the
     * transmitter says sent nothing, a confirmation that it did not arrive, a preparation and a filing by hand.
     */
    @Property.boolean()
    mayHaveBeenSent!: boolean;

    /**
     * What the transmitter failed with, or null for none.
     */
    @Property.object({ cls: () => EBilanzTransmissionFailure, required: false })
    error!: EBilanzTransmissionFailure | null;

    /**
     * Whether the transmission was accepted, true for a preparation and a filing by hand.
     */
    @Property.boolean()
    succeeded!: boolean;

    /**
     * The transfer ticket the transmission answered, or null for none.
     */
    @Property.string({ required: false })
    ticket!: string | null;

    /**
     * What the tax administration answered, such as why it refused the transmission.
     */
    @Property.array({ items: { type: 'string' } })
    messages!: string[];

    /**
     * The transmission protocol, kept in the file store `store` of the E-Bilanz options names, or null for none.
     */
    @Property.file({ store: ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.FILE_STORE, allowedMimeTypes: 'all', maxSize: '25mb', required: false })
    protocol!: string | null;

    /**
     * The id of the user the record is of.
     */
    @Property.string()
    createdBy!: string;

    /**
     * When it was recorded.
     */
    @Property.date()
    createdAt!: Date;
}

/**
 * What a record is created with: everything but what the repository and the chain fill in.
 */
export type EBilanzFilingCreateData = OmitStrict<EBilanzFiling, 'id' | 'tenantId' | 'chainSequence' | 'chainHash' | 'archivedFiles'>;
