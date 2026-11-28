/**
 * How long the rows of an archived entity are kept: a number of years, months and days, counted on the calendar of
 * the application's default time zone. Each is a whole number, and at least one is above 0.
 */
export type ArchiveRetention = {
    /**
     * How many years, such as 10 for a receipt kept under § 147 AO.
     */
    years?: number,
    /**
     * How many months.
     */
    months?: number,
    /**
     * How many days.
     */
    days?: number
};