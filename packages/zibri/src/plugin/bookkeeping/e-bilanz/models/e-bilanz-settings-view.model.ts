import { type EBilanzCertificateSettingsModel } from 'zibri-contract';

import { Property } from '../../../../entity/decorators/property.decorator';

/**
 * The E-Bilanz settings of a tenant as the routes answer them: whether a certificate is uploaded, never the
 * certificate or its PIN.
 */
export class EBilanzSettingsView implements Omit<EBilanzCertificateSettingsModel, 'certificateUploadedAt'> {
    /**
     * When the certificate was uploaded, or null for none.
     */
    @Property.date({ required: false })
    certificateUploadedAt!: Date | null;

    /**
     * The id of the user who uploaded it, or null for none.
     */
    @Property.string({ required: false })
    certificateUploadedBy!: string | null;
}
