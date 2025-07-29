/**
 * Operations you can do on a histogram.
 */
export interface HistogramInterface {
    /**
     *
     */
    observe: (labels: Record<string, string>, value: number) => void
}