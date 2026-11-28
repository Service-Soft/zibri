/**
 * What an entry of a calendar is synced from, such as a task: the kind of row, and its id.
 */
export type CalendarEntrySource = {
    /**
     * The kind of row, such as `task`, the same for every row of its kind.
     */
    type: string,
    /**
     * The id of the row.
     */
    id: string
};