/**
 * An import of a source file of the framework.
 */
export type SourceImport = {
    /**
     * The importing file, relative to `src`.
     */
    file: string,
    /**
     * The imported file, relative to `src`.
     */
    imported: string,
    /**
     * Whether it imports types only, which the compiler erases: no cycle of these is one at runtime.
     */
    isTypeOnly: boolean
};
