/**
 * Interface for the holidays of the calendars your application knows, such as the public holidays of a federal state,
 * which are no working days for the projects whose working calendar names them. Zibri ships no holidays: provide one
 * under `ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.HOLIDAY_CALENDAR`.
 */
export interface HolidayCalendarInterface {
    /**
     * Finds the holidays of a calendar within a range of days.
     * @param calendarId - The id of the calendar, as a working calendar names it, such as `de-by`.
     * @param from - The first day of the range, at its midnight UTC.
     * @param until - The last day of the range, at its midnight UTC.
     * @returns The holidays, each at its midnight UTC, or undefined for a calendar it does not know.
     */
    findHolidays: (calendarId: string, from: Date, until: Date) => Promise<Date[] | undefined>
}
