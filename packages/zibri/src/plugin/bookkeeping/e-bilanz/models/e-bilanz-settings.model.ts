import { BaseEntity } from '../../../../entity/base-entity.model';
import { Entity } from '../../../../entity/decorators/entity.decorator';
import { Property } from '../../../../entity/decorators/property.decorator';
import { ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS } from '../e-bilanz.tokens';

/**
 * What the E-Bilanz of a tenant takes beside its books, at most one row per tenant: the ELSTER certificate a
 * transmitter sends it with, its file and its PIN, which is stored encrypted. The company it states is the one of the
 * bookkeeping settings.
 */
@Entity({ allowOrphan: true, uniques: [['tenantId']] })
export class EBilanzSettings extends BaseEntity {
    /**
     * The tenant keeping the books.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The ELSTER certificate (a `.pfx` file), kept in the file store `store` of the E-Bilanz options names, or null
     * for none.
     */
    @Property.file({ store: ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.FILE_STORE, allowedMimeTypes: 'all', maxSize: '1mb', required: false })
    certificate?: string | null;

    /**
     * The PIN of the certificate, encrypted, or null for none.
     */
    @Property.string({ required: false, encryption: true })
    certificatePin?: string | null;

    /**
     * When the certificate was uploaded, or null for none.
     */
    @Property.date({ required: false })
    certificateUploadedAt?: Date | null;

    /**
     * The id of the user who uploaded the certificate, or null for none.
     */
    @Property.string({ required: false })
    certificateUploadedBy?: string | null;
}

/**
 * What the settings are created with.
 */
export type EBilanzSettingsCreateData = Pick<
    EBilanzSettings,
    'certificate' | 'certificatePin' | 'certificateUploadedAt' | 'certificateUploadedBy'
>;