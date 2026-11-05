/**
 * The metrics in the text format a Prometheus server scrapes.
 */
export type MetricsExposition = {
    /**
     * The content type to answer the scrape with, eg. `text/plain; version=0.0.4; charset=utf-8`.
     */
    contentType: string,
    /**
     * Every metric, in the exposition format.
     */
    body: string
};