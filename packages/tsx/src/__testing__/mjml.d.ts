/**
 * Minimal typing for the `mjml` package, which ships no declarations. Only what the parity tests use.
 */
declare module 'mjml' {
    /**
     * The result of compiling MJML source.
     */
    type MjmlResult = {
        /**
         * The rendered HTML document.
         */
        html: string,
        /**
         * Validation errors, empty on success.
         */
        errors: unknown[]
    };

    /**
     * Options accepted by {@link mjml2html}.
     */
    type MjmlOptions = {
        /**
         * How strictly the MJML input is validated.
         */
        validationLevel?: 'strict' | 'soft' | 'skip'
    };

    /**
     * Compiles MJML source to an HTML email. Asynchronous as of MJML 5.
     * @param source - The MJML source.
     * @param options - Compile options.
     * @returns The rendered HTML and any validation errors.
     */
    export default function mjml2html(source: string, options?: MjmlOptions): Promise<MjmlResult>;
}