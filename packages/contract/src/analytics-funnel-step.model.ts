/**
 * One step of a funnel: a page view of a path, or an event of a name. Exactly one of the two.
 */
export type AnalyticsFunnelStepModel = {
    /**
     * The path a page view of the step is of, such as `/takeover`.
     */
    path?: string,
    /**
     * The name an event of the step has, such as `contact-form-sent`.
     */
    event?: string
};