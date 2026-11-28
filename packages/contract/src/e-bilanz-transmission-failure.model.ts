/**
 * What a transmitter failed with, as a record of a failed transmission keeps it.
 */
export type EBilanzTransmissionFailureModel = {
    /**
     * The name of the error, such as `EBilanzNotSentError`.
     */
    name: string,
    /**
     * The message of the error.
     */
    message: string,
    /**
     * The message and what caused it, one paragraph each.
     */
    paragraphs: string[]
};
