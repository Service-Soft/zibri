/**
 * Operations you can do on a counter.
 */
export interface CounterInterface {
    /**
     *
     */
    increase: (labels?: Record<string, string>, value?: number) => void
}