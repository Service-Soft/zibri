import { type ArchivedFileModel } from './archived-file.model';
import { type EBilanzContentModel } from './e-bilanz-content.model';
import { type EBilanzFilingKind } from './e-bilanz-filing-kind.enum';
import { type EBilanzPreparationInputModel } from './e-bilanz-preparation-input.model';
import { type EBilanzTransmissionFailureModel } from './e-bilanz-transmission-failure.model';
import { type EBilanzTransmissionStatus } from './e-bilanz-transmission-status.enum';
import { type FileReference } from './file-reference.model';

/**
 * A record of the E-Bilanz of a fiscal year, archived and never changed: its preparation, a test transmission, its
 * transmission, or its filing by hand.
 */
export type EBilanzFilingModel = {
    /**
     * The id of the record.
     */
    id: string,
    /**
     * The tenant keeping the books.
     */
    tenantId: string,
    /**
     * The place of the record in the chain of the archived rows of its tenant.
     */
    chainSequence: number,
    /**
     * The hash linking the record to the row before it in its chain.
     */
    chainHash: string,
    /**
     * When the retention of the record ends, from which it may be deleted.
     */
    retainUntil: string,
    /**
     * The protocol, with its SHA-256, as it was when the record was created.
     */
    archivedFiles: ArchivedFileModel[],
    /**
     * The id of the fiscal year.
     */
    fiscalYearId: string,
    /**
     * The last day of the fiscal year.
     */
    end: string,
    /**
     * What the record records.
     */
    kind: EBilanzFilingKind,
    /**
     * The id of the record of the preparation it sends or files, or null for a preparation.
     */
    preparationId: string | null,
    /**
     * The SHA-256 of the content prepared, which every transmission of it names.
     */
    contentHash: string,
    /**
     * The content prepared, or null for a record of a transmission or a filing.
     */
    content: EBilanzContentModel | null,
    /**
     * What the preparation took beside the books, or null for a record of a transmission or a filing.
     */
    input: EBilanzPreparationInputModel | null,
    /**
     * The id of the record of the filing a preparation corrects, the latest accepted transmission for real or filing
     * by hand before it. Null for a preparation of a fiscal year not filed, and for every other record.
     */
    correctsFilingId: string | null,
    /**
     * Where the transmission stands, as this record states it: `transmitting` for the record it was started with,
     * its result for the records naming it as their `transmissionId`. Null for a preparation and a filing by hand.
     */
    status: EBilanzTransmissionStatus | null,
    /**
     * The id of the record a transmission was started with, which this record states the result of. Null for that
     * record itself, a preparation and a filing by hand.
     */
    transmissionId: string | null,
    /**
     * Whether the E-Bilanz may have reached the tax administration with the transmission: false for a failure the
     * transmitter says sent nothing, a confirmation that it did not arrive, a preparation and a filing by hand.
     */
    mayHaveBeenSent: boolean,
    /**
     * What the transmitter failed with, or null for none.
     */
    error: EBilanzTransmissionFailureModel | null,
    /**
     * Whether the transmission was accepted, true for a preparation and a filing by hand.
     */
    succeeded: boolean,
    /**
     * The transfer ticket the transmission answered, or null for none.
     */
    ticket: string | null,
    /**
     * What the tax administration answered, such as why it refused the transmission.
     */
    messages: string[],
    /**
     * The transmission protocol, or null for none.
     */
    protocol: FileReference | null,
    /**
     * The id of the user the record is of.
     */
    createdBy: string,
    /**
     * When it was recorded.
     */
    createdAt: string
};
