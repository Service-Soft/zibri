/**
 * Where a transmission of an E-Bilanz stands, as a record of it states it.
 */
export enum EBilanzTransmissionStatus {
    /**
     * The transmission was started and has no result yet. Recorded before the transmitter is called.
     */
    TRANSMITTING = 'transmitting',
    /**
     * The tax administration accepted it.
     */
    ACCEPTED = 'accepted',
    /**
     * The tax administration refused it, such as for a rule its check found broken.
     */
    REFUSED = 'refused',
    /**
     * The transmitter failed. `mayHaveBeenSent` says whether the E-Bilanz may have reached the tax administration.
     */
    FAILED = 'failed',
    /**
     * Its result is not known: the transmitter did not answer in time, or the instance sending it stopped. It may
     * have reached the tax administration, which a person checks in ELSTER.
     */
    UNKNOWN = 'unknown',
    /**
     * A person confirmed that a transmission whose result was not known did not reach the tax administration.
     */
    NOT_RECEIVED = 'not-received'
}