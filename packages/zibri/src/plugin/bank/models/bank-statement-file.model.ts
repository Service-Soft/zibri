/**
 * A CAMT.053 file to import, as `importStatements` of the bank statement service takes it.
 */
export type BankStatementFile = {
    /**
     * The name the file is kept under, such as `statement-2026-11.xml`.
     */
    name: string,
    /**
     * The bytes of the file.
     */
    data: Buffer,
    /**
     * The user who imports it. The user of the current request by default.
     */
    importedBy?: string
};