/**
 * Configuration of the E-Bilanz of the bookkeeping plugin.
 */
export type EBilanzPluginOptions = {
    /**
     * The name of the file store the ELSTER certificates and the transmission protocols are kept in.
     * @default the `receiptStore` of the bookkeeping plugin options
     */
    readonly store: string,
    /**
     * How long a transmitter may take to answer, after which the transmission is recorded as `unknown`, as it may
     * have reached the tax administration, and the signal it was handed fires.
     * @default 30 minutes
     */
    readonly transmissionTimeoutInMs: number
};