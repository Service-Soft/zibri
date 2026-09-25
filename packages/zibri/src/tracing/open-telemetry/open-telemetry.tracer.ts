import { OpenTelemetryApi, OpenTelemetryApiTracer, OpenTelemetryContext, OpenTelemetryNodeSdk, OpenTelemetryResource, OpenTelemetryResources, OpenTelemetrySpanContext, OpenTelemetrySpanExporter, OpenTelemetrySpanProcessor, OpenTelemetryTracerProvider } from './open-telemetry-api.model';
import { OpenTelemetrySpanAdapter } from './open-telemetry.span';
import { OpenTelemetryUtilities } from './open-telemetry.utilities';
import { TraceBufferSpanProcessor } from './trace-buffer.span-processor';
import { ZibriApplication } from '../../application/application';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { OnAppInit } from '../../global/on-app-init.interface';
import { OnAppShutdown } from '../../global/on-app-shutdown.interface';
import { optionalPeer } from '../../utilities/optional-peer.function';
import { zibriVersion } from '../../versioning/zibri-version.function';
import { TraceBufferInterface } from '../trace-buffer.interface';
import { TraceSpanContext } from '../trace-span-context.model';
import { TraceSpanInterface } from '../trace-span.interface';
import { StartSpanOptions, TracerInterface } from '../tracer.interface';

const sampledFlag: number = 0b0000_0001;

/**
 * The name this instrumentation reports itself under, which is what a backend groups its spans by.
 */
const instrumentationName: string = 'zibri';

/**
 * What the feature is called in the error naming a package that is not installed.
 */
const neededFor: string = 'Tracing';

/**
 * Records spans, and sets up the OpenTelemetry SDK that keeps them.
 *
 * Registered by default, and it configures itself. Every span it records goes into the trace buffer,
 * so an application that was given no exporter still answers what it has been doing lately, out of
 * memory it bounds itself and with nothing listening anywhere.
 *
 * Sending them somewhere is one provider: whatever `ZIBRI_DI_TOKENS.TRACE_EXPORTER` holds is handed
 * a batch of finished spans as they accumulate. Nothing is sent when it holds nothing, which is the
 * default - a framework that opened a connection to a collector nobody deployed would be spending a
 * request every few seconds on being ignored.
 *
 * Its packages are optional peers rather than dependencies, so that an application registering a
 * tracer of its own does not carry an SDK it never calls. This one needs them and says which by name
 * at startup rather than on the first request, because a missing package is a deployment that is
 * wrong rather than a request that is.
 */
@Injectable({ register: 'onUse' })
export class OpenTelemetryTracer implements TracerInterface, OnAppInit, OnAppShutdown {
    private readonly api: OpenTelemetryApi;
    private readonly tracer: OpenTelemetryApiTracer;

    /**
     * The provider this set up, which is also the thing that has to be flushed on the way out.
     */
    private provider: OpenTelemetryTracerProvider | undefined;

    constructor() {
        this.api = optionalPeer<OpenTelemetryApi>('@opentelemetry/api', neededFor);
        // asked for before anything is registered, which the api allows: what it hands back forwards
        // to whichever provider is global at the time a span is started, so a span started during
        // boot and one started later both reach the provider below
        this.tracer = this.api.trace.getTracer(instrumentationName, zibriVersion());
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        const sdk: OpenTelemetryNodeSdk = optionalPeer<OpenTelemetryNodeSdk>('@opentelemetry/sdk-trace-node', neededFor);
        const exporter: OpenTelemetrySpanExporter | undefined = inject(ZIBRI_DI_TOKENS.TRACE_EXPORTER);

        this.provider = new sdk.NodeTracerProvider({
            spanProcessors: this.resolveSpanProcessors(sdk, exporter),
            // only for spans that leave: who recorded them is the question a backend holding several
            // services has to answer, and a buffer this application reads back out of itself has
            // already answered it
            resource: exporter == undefined ? undefined : this.resolveResource(app)
        });
        this.provider.register();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppShutdown(): Promise<void> {
        // what a batch costs: everything gathered since the last export is still in this process,
        // and an application that exits without saying so loses the spans of whatever it was doing
        // when it was told to stop - which is the most interesting part of the trace
        await this.provider?.shutdown();
        this.provider = undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    startSpan(name: string, options: StartSpanOptions): TraceSpanInterface {
        return new OpenTelemetrySpanAdapter(
            this.tracer.startSpan(
                name,
                {
                    kind: OpenTelemetryUtilities.resolveApiKind(options.kind, this.api),
                    attributes: options.attributes,
                    // a span with no parent is a new trace, and saying so explicitly is what stops
                    // the sdk reaching for whatever context it happens to find active. Background
                    // work that fired while a request was in flight is not part of that request
                    root: options.parent == undefined ? true : undefined
                },
                this.findParentContext(options.parent)
            ),
            this.api,
            options.parent
        );
    }

    /**
     * What every finished span is handed to.
     *
     * The buffer always, because it is what an application that configured nothing can still read,
     * and an exporter beside it when one was registered. Batched rather than one request per span: a
     * span is written on the path of every request the application answers, and an exporter that
     * sent each one would put a network call inside the work it is measuring.
     * @param sdk - The installed sdk, which is where a batch processor comes from.
     * @param exporter - Where spans are sent, if anywhere.
     * @returns What to build the provider with.
     */
    private resolveSpanProcessors(
        sdk: OpenTelemetryNodeSdk,
        exporter: OpenTelemetrySpanExporter | undefined
    ): OpenTelemetrySpanProcessor[] {
        const buffer: TraceBufferInterface = inject(ZIBRI_DI_TOKENS.TRACE_BUFFER);
        const processors: OpenTelemetrySpanProcessor[] = [new TraceBufferSpanProcessor(buffer, this.api)];

        if (exporter != undefined) {
            processors.push(new sdk.BatchSpanProcessor(exporter));
        }
        return processors;
    }

    /**
     * Who the exported spans say recorded them.
     *
     * Taken from what the application already calls itself rather than from a setting of its own:
     * two names for one service is two things to keep in step, and a backend showing a name nobody
     * recognizes is what happens when they drift.
     * @param app - The running application.
     * @returns The resource to report under.
     */
    private resolveResource(app: ZibriApplication): OpenTelemetryResource {
        const resources: OpenTelemetryResources = optionalPeer<OpenTelemetryResources>(
            '@opentelemetry/resources',
            neededFor
        );
        return resources.resourceFromAttributes({
            'service.name': app.options.name,
            'service.version': app.options.version
        });
    }

    /**
     * The sdk context holding the parent, when there is one.
     * @param parent - What the span hangs under.
     * @returns The context to start the span in, or undefined for a new trace.
     */
    private findParentContext(parent: TraceSpanContext | undefined): OpenTelemetryContext | undefined {
        if (parent == undefined) {
            return undefined;
        }
        const spanContext: OpenTelemetrySpanContext = {
            traceId: parent.traceId,
            spanId: parent.spanId,
            traceFlags: parent.sampled ? sampledFlag : 0,
            isRemote: true,
            traceState: parent.traceState == undefined ? undefined : this.api.createTraceState(parent.traceState)
        };
        return this.api.trace.setSpanContext(this.api.ROOT_CONTEXT, spanContext);
    }
}