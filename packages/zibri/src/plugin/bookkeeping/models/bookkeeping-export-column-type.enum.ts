/**
 * What a column of a table of the export of a fiscal year holds.
 */
export enum BookkeepingExportColumnType {
    /**
     * A number, with the decimals its column names.
     */
    NUMBER = 'NUMBER',
    /**
     * Text, such as an id or a name, and a moment as its ISO 8601 form in UTC.
     */
    TEXT = 'TEXT',
    /**
     * A day, held as its midnight UTC.
     */
    DAY = 'DAY'
}
