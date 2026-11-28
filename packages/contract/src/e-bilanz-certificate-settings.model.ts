/**
 * Whether the ELSTER certificate the E-Bilanz is sent with is uploaded, as `GET /e-bilanz/settings` answers it: never
 * the certificate or its PIN.
 */
export type EBilanzCertificateSettingsModel = {
    /**
     * When the certificate was uploaded, or null for none.
     */
    certificateUploadedAt: string | null,
    /**
     * The id of the user who uploaded it, or null for none.
     */
    certificateUploadedBy: string | null
};