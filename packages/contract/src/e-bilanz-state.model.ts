import { type EBilanzContentModel } from './e-bilanz-content.model';
import { type EBilanzExporterModel } from './e-bilanz-exporter.model';
import { type EBilanzFilingModel } from './e-bilanz-filing.model';
import { type EBilanzFindingModel } from './e-bilanz-finding.model';
import { type EBilanzTransmissionModel } from './e-bilanz-transmission.model';

/**
 * The E-Bilanz of a fiscal year: its content as the books state it now with what it needs before it is filed, the
 * records of its filing, its deadline, and how it can be filed.
 */
export type EBilanzStateModel = {
    /**
     * The id of the fiscal year.
     */
    fiscalYearId: string,
    /**
     * The last day the E-Bilanz can be filed on, § 149 AO.
     */
    deadline: string,
    /**
     * The E-Bilanz as the books state it now, or null while it cannot be stated, such as for an open fiscal year.
     */
    content: EBilanzContentModel | null,
    /**
     * What the E-Bilanz needs before it can be prepared, none when it can be.
     */
    findings: EBilanzFindingModel[],
    /**
     * The records of its filing, the earliest first.
     */
    filings: EBilanzFilingModel[],
    /**
     * Each transmission, the earliest first, with where it stands. A frontend polls this after sending, until the
     * transmission it started is no longer `transmitting`.
     */
    transmissions: EBilanzTransmissionModel[],
    /**
     * The id of the latest preparation, which an export and a transmission send, or null for none.
     */
    preparationId: string | null,
    /**
     * Whether the latest preparation still states what the books state.
     */
    preparationCurrent: boolean,
    /**
     * Whether the E-Bilanz is filed: transmitted, or filed by hand.
     */
    filed: boolean,
    /**
     * Whether the E-Bilanz can be sent from the application.
     */
    transmitterConfigured: boolean,
    /**
     * Why it cannot be sent from the application and what enables it, or null when it can.
     */
    transmitterUnavailableReason: string | null,
    /**
     * The formats the E-Bilanz can be downloaded in, to be filed by hand.
     */
    exporters: EBilanzExporterModel[]
};