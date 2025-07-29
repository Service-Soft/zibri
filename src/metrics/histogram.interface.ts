/**
 * Operations you can do on a histogram.
 */
export interface HistogramInterface {
    /**
     * Observes a new value.
     */
    observe: (labels: Record<string, string>, value: number) => void
}