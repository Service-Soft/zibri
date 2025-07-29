/**
 * Operations you can do on a counter.
 */
export interface CounterInterface {
    /**
     * Increases the value of the counter.
     */
    increase: (labels?: Record<string, string>, value?: number) => void
}