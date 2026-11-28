/**
 * Something a conformance asks of a fiscal year once it is closed, such as filing its E-Bilanz, with its deadline, as
 * `GET /bookkeeping/fiscal-years/:id/obligations` answers it.
 */
export type BookkeepingObligationModel = {
    /**
     * The name of the conformance asking for it.
     */
    conformance: string,
    /**
     * What it is, such as `e-bilanz`.
     */
    name: string,
    /**
     * What it asks, in the locale of the request.
     */
    description: string,
    /**
     * The last day it can be done on.
     */
    dueOn: string,
    /**
     * When it was done, or null while it is not.
     */
    fulfilledAt: string | null
};
