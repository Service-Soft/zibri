/**
 * What a record of the filing of an E-Bilanz records.
 */
export enum EBilanzFilingKind {
    /**
     * The E-Bilanz was prepared and validated, its content archived.
     */
    PREPARED = 'prepared',
    /**
     * The prepared E-Bilanz was sent as a test, which the tax administration does not keep.
     */
    TEST_TRANSMISSION = 'test-transmission',
    /**
     * The prepared E-Bilanz was sent to the tax administration.
     */
    TRANSMISSION = 'transmission',
    /**
     * A person filed the E-Bilanz by hand, such as with another program, and uploaded its protocol.
     */
    MANUAL_FILING = 'manual-filing'
}