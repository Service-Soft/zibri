/**
 * Thrown by a transmitter that knows the E-Bilanz did not reach the tax administration, such as when the certificate
 * could not be read or the program sending it never started. The transmission is recorded as `failed` with
 * `mayHaveBeenSent` false, and can be sent again. Any other error a transmitter throws records it as one that may
 * have been sent. Pass what failed as the `cause`, whose paragraphs the record keeps.
 */
export class EBilanzNotSentError extends Error {
    constructor(message: string, options?: ErrorOptions) {
        super(message, options);
        this.name = 'EBilanzNotSentError';
    }
}