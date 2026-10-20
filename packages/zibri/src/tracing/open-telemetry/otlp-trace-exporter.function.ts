import { OpenTelemetryOtlpExporter, OpenTelemetrySpanExporter } from './open-telemetry-api.model.ts';
import { optionalPeer } from '../../utilities/optional-peer.function.ts';

/**
 * Where finished spans are sent, and how.
 *
 * Every field is stated rather than read from the environment, so what an application does with its
 * spans is decided in the same file as everything else it is configured with, and is the same
 * wherever it runs.
 */
export type OtlpTraceExporterOptions = {
    /**
     * The collector endpoint, including its path - `http://collector:4318/v1/traces`.
     */
    url: string,
    /**
     * Headers to put on each export, which is where a hosted collector's api key goes.
     */
    headers?: Record<string, string>,
    /**
     * How long one export may take before it is given up on. Ten seconds when nothing says.
     */
    timeoutMs?: number,
    /**
     * How many exports may be in flight at once. Thirty when nothing says.
     */
    concurrencyLimit?: number
};

/**
 * Sends spans to a collector over OTLP, which is the protocol every tracing backend reads.
 *
 * Register it under `ZIBRI_DI_TOKENS.TRACE_EXPORTER` to send the spans this application records
 * somewhere they outlive the process. They are reported under the application's own name and
 * version, so a backend can tell this service from the ones it talks to.
 *
 * `@opentelemetry/exporter-trace-otlp-http` and `@opentelemetry/resources` are optional peers and
 * are asked for here, so an application that keeps its spans in memory never installs either.
 * @param options - Where to send them, and how.
 * @returns The exporter.
 * @throws When the exporter package is not installed.
 */
export function otlpTraceExporter(options: OtlpTraceExporterOptions): OpenTelemetrySpanExporter {
    const otlp: OpenTelemetryOtlpExporter = optionalPeer<OpenTelemetryOtlpExporter>(
        '@opentelemetry/exporter-trace-otlp-http',
        'Sending traces over OTLP'
    );
    return new otlp.OTLPTraceExporter({
        url: options.url,
        headers: options.headers,
        timeoutMillis: options.timeoutMs,
        concurrencyLimit: options.concurrencyLimit
    });
}