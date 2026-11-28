/**
 * What a line of a journal entry does beyond its amount, which only the books set.
 */
export enum JournalEntryLineRole {
    /**
     * A line of the entry closing a fiscal year that carries the result of the year, revenue less expenses, into an
     * equity account.
     */
    RESULT = 'result'
}
