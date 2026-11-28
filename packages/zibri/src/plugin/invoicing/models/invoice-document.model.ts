import { BaseArchivedEntity } from '../../../archive/base-archived-entity.model';
import { Archive } from '../../../archive/decorators/archive.decorator';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { MimeType } from '../../../http/mime-type.enum';
import { type OmitStrict } from '../../../types/omit-strict.type';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../invoicing.tokens';
import { InvoiceType } from './invoice-type.enum';

/**
 * The documents of an issued invoice or credit note, rendered once as it was issued and archived unchanged for the
 * `retention` of the `archive` of the invoicing options, counted from the end of the calendar year it was issued in:
 * its pdf, and its electronic invoice.
 */
// the retention here is the default of the plugin, which counts each row's retainUntil from its options instead
@Entity({ allowOrphan: true, chained: true, uniques: [['invoiceId']] })
@Archive({ retention: { years: 8 }, dateProperty: 'issuedAt' })
export class InvoiceDocument extends BaseArchivedEntity {
    /**
     * The tenant that issued the invoice.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The id of the invoice. Unique among the documents of its tenant.
     */
    @Property.string({ format: 'uuid' })
    invoiceId!: string;

    /**
     * The number of the invoice.
     */
    @Property.string()
    number!: string;

    /**
     * Whether it is an invoice or a credit note.
     */
    @Property.string({ enum: InvoiceType })
    type!: InvoiceType;

    /**
     * When the invoice was issued, from the end of whose year the retention is counted.
     */
    @Property.date()
    issuedAt!: Date;

    /**
     * The locale the pdf was rendered in.
     */
    @Property.string()
    locale!: string;

    /**
     * The time zone the dates of the invoice were read in, that of its company.
     */
    @Property.string()
    timezone!: string;

    /**
     * The electronic invoice the pdf carries, such as `x-rechnung`, or null for a pdf alone.
     */
    @Property.string({ required: false })
    conformance?: string | null;

    /**
     * The pdf, kept in the file store `store` of the `archive` of the invoicing options names.
     */
    @Property.file({ store: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.DOCUMENT_FILE_STORE, allowedMimeTypes: [MimeType.PDF], maxSize: '50mb' })
    pdf!: string;

    /**
     * The xml of the electronic invoice, or null for none, such as for a pdf alone or a conformance that writes
     * its xml into the pdf only.
     */
    @Property.file({
        store: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.DOCUMENT_FILE_STORE,
        allowedMimeTypes: [MimeType.XML],
        maxSize: '50mb',
        required: false
    })
    electronicInvoice?: string | null;

    /**
     * When the documents were archived.
     */
    @Property.date()
    archivedAt!: Date;
}

/**
 * What the documents of an invoice are archived with: everything but what the repository and the chain fill in.
 */
export type InvoiceDocumentCreateData = OmitStrict<InvoiceDocument, 'id' | 'tenantId' | 'chainSequence' | 'chainHash' | 'archivedFiles'>;
