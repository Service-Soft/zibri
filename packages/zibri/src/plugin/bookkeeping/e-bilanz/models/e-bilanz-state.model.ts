import { type EBilanzStateModel } from 'zibri-contract';

import { Property } from '../../../../entity/decorators/property.decorator';
import { EBilanzContent } from './e-bilanz-content.model';
import { EBilanzExporterInfo } from './e-bilanz-exporter-info.model';
import { EBilanzFiling } from './e-bilanz-filing.model';
import { EBilanzFinding } from './e-bilanz-finding.model';
import { EBilanzTransmissionSummary } from './e-bilanz-transmission-summary.model';

/**
 * The E-Bilanz of a fiscal year: its latest preparation, what it needs now, the records of its filing and its
 * transmissions, its deadline, and how it can be filed.
 */
export class EBilanzState implements Omit<
    EBilanzStateModel,
    'deadline' | 'content' | 'findings' | 'filings' | 'transmissions' | 'exporters'
> {
    /**
     * The id of the fiscal year.
     */
    @Property.string({ format: 'uuid' })
    fiscalYearId!: string;

    /**
     * The last day the E-Bilanz can be filed on, § 149 AO.
     */
    @Property.date()
    deadline!: Date;

    /**
     * The content of the latest preparation, or null for none.
     */
    @Property.object({ cls: () => EBilanzContent, required: false })
    content!: EBilanzContent | null;

    /**
     * What the E-Bilanz needs now, as the books state it with what the latest preparation took, none for none.
     */
    @Property.array({ items: { type: 'object', cls: () => EBilanzFinding } })
    findings!: EBilanzFinding[];

    /**
     * The records of its filing, the earliest first.
     */
    @Property.array({ items: { type: 'object', cls: () => EBilanzFiling } })
    filings!: EBilanzFiling[];

    /**
     * Each transmission, the earliest first, with where it stands. A frontend polls this after sending, until the
     * transmission it started is no longer `transmitting`.
     */
    @Property.array({ items: { type: 'object', cls: () => EBilanzTransmissionSummary } })
    transmissions!: EBilanzTransmissionSummary[];

    /**
     * The id of the latest preparation, or null for none.
     */
    @Property.string({ format: 'uuid', required: false })
    preparationId!: string | null;

    /**
     * Whether the latest preparation still states what the books state.
     */
    @Property.boolean()
    preparationCurrent!: boolean;

    /**
     * Whether the E-Bilanz is filed: transmitted, or filed by hand.
     */
    @Property.boolean()
    filed!: boolean;

    /**
     * Whether the E-Bilanz can be sent from the application.
     */
    @Property.boolean()
    transmitterConfigured!: boolean;

    /**
     * Why it cannot be sent from the application and what enables it, or null when it can.
     */
    @Property.string({ required: false })
    transmitterUnavailableReason!: string | null;

    /**
     * The formats it can be downloaded in.
     */
    @Property.array({ items: { type: 'object', cls: () => EBilanzExporterInfo } })
    exporters!: EBilanzExporterInfo[];
}