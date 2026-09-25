import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import si from 'systeminformation';

import { MetricType } from './metric-type.enum';
import { Metric } from './metric.model';
import { MetricsSnapshot } from './metrics-service.interface';
import { PrometheusMetricsService } from './metrics.service';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { inject } from '../di/inject.function';
import { NotFoundError } from '../error-handling/errors/not-found.error';
import { HttpRequest } from '../http/http-request.model';
import { HttpResponse } from '../http/http-response.model';
import { $ts } from '../localization/translate.function';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Param } from '../routing/decorators/param.decorator';

@Controller('/metrics-integration-test')
class MetricsIntegrationController {
    @Get('/ok')
    ok(): { ok: true } {
        return { ok: true };
    }

    @Get('/:id/missing')
    missing(
        @Param.path('id')
        id: string
    ): never {
        throw new NotFoundError($ts`Could not find resource with id "${id}".`);
    }
}

/**
 * A request as the metrics middleware sees one at the end of its life.
 * @param path - The path that was asked for.
 * @param template - The route template express matched, or nothing when no route did.
 * @returns The request.
 */
function requestFor(path: string, template?: string): HttpRequest {
    return {
        method: 'GET',
        path: path.split('?')[0],
        originalUrl: path,
        baseUrl: '',
        route: template == undefined ? undefined : { path: template }
    } as unknown as HttpRequest;
}

/**
 * A response that was written in full.
 * @param statusCode - The status it ended with.
 * @returns The response.
 */
function responseFor(statusCode: number): HttpResponse {
    return { statusCode, writableFinished: true } as unknown as HttpResponse;
}

/**
 * One interface's counters, as `systeminformation` reports them.
 * @param iface - The name of the interface.
 * @param rxBytes - How many bytes it received.
 * @param txBytes - How many bytes it transmitted.
 * @returns The stats entry for that interface.
 */
function networkStatsFor(iface: string, rxBytes: number, txBytes: number): si.Systeminformation.NetworkStatsData {
    return {
        iface,
        operstate: 'up',
        rx_bytes: rxBytes,
        rx_dropped: 0,
        rx_errors: 0,
        tx_bytes: txBytes,
        tx_dropped: 0,
        tx_errors: 0,
        rx_sec: 0,
        tx_sec: 0,
        ms: 1000
    };
}

describe('PrometheusMetricsService', () => {
    let server: StartedTestServer;
    let baseUrl: string;
    let service: PrometheusMetricsService;

    beforeAll(async () => {
        server = await startTestServer({ controllers: [MetricsIntegrationController] });
        baseUrl = await server.start();
        service = inject(PrometheusMetricsService);
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    describe('getCounter / getGauge / getHistogram', () => {
        it('reuses the same underlying registration on repeated calls with the same name instead of registering a duplicate', async () => {
            // prom-client throws when a metric with the same name is registered twice on the same registry,
            // so this only passes if getCounter is actually caching rather than re-registering every call.
            expect(() => {
                service.getCounter('test_counter_reuse').increase({}, 3);
                service.getCounter('test_counter_reuse').increase({}, 4);
            }).not.toThrow();

            await service.collect();
            const snapshot: MetricsSnapshot = service.getMetricSnapshots().at(-1) as MetricsSnapshot;
            const metric: Metric | undefined = snapshot.metrics.find(m => m.name === 'test_counter_reuse');
            expect(metric?.value).toBe(7);
        });
    });

    describe('measureFinishedRequest', () => {
        it('increments the http_requests_total counter and observes the duration histogram', async () => {
            const req: HttpRequest = requestFor('/some/route', '/some/route');
            const res: HttpResponse = responseFor(200);

            service.measureFinishedRequest(req, res, 42);
            await service.collect();

            const snapshot: MetricsSnapshot = service.getMetricSnapshots().at(-1) as MetricsSnapshot;
            const counterMetric: Metric | undefined = snapshot.metrics.find(
                m => m.name === 'http_requests_total' && m.labels['route'] === '/some/route'
            );
            expect(counterMetric?.value).toBeGreaterThanOrEqual(1);

            const histogramSum: Metric | undefined = snapshot.metrics.find(
                m => m.name === 'http_request_duration_ms_sum' && m.labels['route'] === '/some/route'
            );
            expect(histogramSum?.value).toBeGreaterThanOrEqual(42);
        });

        it('ignores requests whose route is under the assets route', async () => {
            const req: HttpRequest = requestFor('/assets/some/file.png');
            const res: HttpResponse = responseFor(200);

            service.measureFinishedRequest(req, res, 1);
            await service.collect();

            const snapshot: MetricsSnapshot = service.getMetricSnapshots().at(-1) as MetricsSnapshot;
            const counterMetric: Metric | undefined = snapshot.metrics.find(
                m => m.name === 'http_requests_total' && m.labels['route'] === '/assets/some/file.png'
            );
            expect(counterMetric).toBeUndefined();
        });

        it('labels a request with the route template rather than the url that was asked for', async () => {
            const req: HttpRequest = requestFor('/invoices/2b8f0c1e-1a2b-4c3d-8e9f-0a1b2c3d4e5f', '/invoices/:id');
            const res: HttpResponse = responseFor(200);

            service.measureFinishedRequest(req, res, 5);
            await service.collect();

            const snapshot: MetricsSnapshot = service.getMetricSnapshots().at(-1) as MetricsSnapshot;

            // the id must not reach the label. Every distinct value is a series that is kept
            // forever, so labelling by url turns ordinary traffic into unbounded memory growth -
            // and lets anyone cause it deliberately
            expect(snapshot.metrics.find(m => m.name === 'http_requests_total' && m.labels['route'] === '/invoices/:id'))
                .toBeDefined();
            expect(snapshot.metrics.filter(m => String(m.labels['route'] ?? '').includes('2b8f0c1e'))).toEqual([]);
        });

        it('collapses every request that matched no route onto one label', async () => {
            service.measureFinishedRequest(requestFor('/nope?x=1'), responseFor(404), 1);
            service.measureFinishedRequest(requestFor('/nope?x=2'), responseFor(404), 1);
            service.measureFinishedRequest(requestFor('/also-nope'), responseFor(404), 1);
            await service.collect();

            const snapshot: MetricsSnapshot = service.getMetricSnapshots().at(-1) as MetricsSnapshot;
            const unmatched: Metric[] = snapshot.metrics.filter(
                m => m.name === 'http_requests_total' && m.labels['route'] === '<unmatched>'
            );

            // there is no template to report for a request nothing matched, and reporting the url
            // instead is the hole itself - a scan for admin panels would mint a series per guess
            expect(unmatched).toHaveLength(1);
            expect(unmatched[0]?.value).toBeGreaterThanOrEqual(3);
        });

        it('counts a request the client abandoned, rather than reporting it as a success', async () => {
            const req: HttpRequest = requestFor('/slow', '/slow');
            // the status was never written, so whatever it holds is the default nothing sent
            const res: HttpResponse = { statusCode: 200, writableFinished: false } as unknown as HttpResponse;

            service.measureFinishedRequest(req, res, 3);
            await service.collect();

            const snapshot: MetricsSnapshot = service.getMetricSnapshots().at(-1) as MetricsSnapshot;
            const aborted: Metric | undefined = snapshot.metrics.find(
                m => m.name === 'http_requests_total' && m.labels['route'] === '/slow' && m.labels['status_code'] === '499'
            );

            // these used to be invisible: the middleware listened for 'finish', which never fires
            // for a response that was not written in full, so client aborts and dead requests were
            // missing from the metric meant to show them
            expect(aborted?.value).toBeGreaterThanOrEqual(1);
        });
    });

    describe('collect', () => {
        it('appends a snapshot with a timestamp and includes network metrics', async () => {
            const before: number = service.getMetricSnapshots().length;
            await service.collect();
            const after: number = service.getMetricSnapshots().length;

            expect(after).toBe(before + 1);
            const snapshot: MetricsSnapshot = service.getMetricSnapshots().at(-1) as MetricsSnapshot;
            expect(snapshot.timestamp).toBeInstanceOf(Date);
            expect(snapshot.metrics.some(m => m.name === 'network_bytes_received_total' && m.type === MetricType.COUNTER)).toBe(true);
            expect(snapshot.metrics.some(m => m.name === 'network_bytes_transmitted_total' && m.type === MetricType.COUNTER)).toBe(true);
        });

        it('reports every interface under its own label rather than whichever one is enumerated first', async () => {
            const networkStats: jest.Spied<typeof si.networkStats> = jest.spyOn(si, 'networkStats');
            networkStats.mockResolvedValue([networkStatsFor('lo', 11, 12), networkStatsFor('eth0', 21, 22)]);

            try {
                await service.collect();
                const snapshot: MetricsSnapshot = service.getMetricSnapshots().at(-1) as MetricsSnapshot;
                const received: Metric[] = snapshot.metrics.filter(m => m.name === 'network_bytes_received_total');

                // an unlabelled pair read the first interface the probe listed, which is the
                // loopback as often as it is the uplink - so the counter said "11" for a machine
                // that had moved 21 bytes, and nothing in the series said which one it meant
                expect(received.map(m => m.labels['interface'])).toEqual(['lo', 'eth0']);
                expect(received.map(m => m.value)).toEqual([11, 21]);
                expect(
                    snapshot.metrics
                        .filter(m => m.name === 'network_bytes_transmitted_total')
                        .map(m => [m.labels['interface'], m.value])
                ).toEqual([['lo', 12], ['eth0', 22]]);
            }
            finally {
                networkStats.mockRestore();
            }
        });

        it('still records a snapshot on a machine that reports no network interface', async () => {
            const networkStats: jest.Spied<typeof si.networkStats> = jest.spyOn(si, 'networkStats');
            // a container with no interface of its own, or a probe the host would not answer. The
            // only way to be that machine from here
            networkStats.mockResolvedValue([]);

            try {
                service.getCounter('test_counter_without_network').increase({}, 1);
                await expect(service.collect()).resolves.not.toThrow();

                const snapshot: MetricsSnapshot = service.getMetricSnapshots().at(-1) as MetricsSnapshot;

                // reading the first interface without checking there is one turned an empty list
                // into a TypeError inside the collection cron, so nothing was recorded at all - the
                // two network counters took every other metric down with them
                expect(snapshot.metrics.find(m => m.name === 'test_counter_without_network')?.value).toBe(1);
                expect(snapshot.metrics.some(m => m.name === 'network_bytes_received_total')).toBe(false);
            }
            finally {
                networkStats.mockRestore();
            }
        });

        it('caps the retained snapshots at 60, dropping the oldest first', async () => {
            for (let i: number = 0; i < 65; i++) {
                await service.collect();
            }

            expect(service.getMetricSnapshots().length).toBe(60);
        }, 20000);
    });

    // Everything above drives PrometheusMetricsService's public methods directly. These instead go
    // through a real HTTP request against the real controller registered above, to confirm the
    // onAppInit() middleware (app.use + res.on('finish')) actually wires measureFinishedRequest up
    // correctly end to end — that wiring can't be exercised by calling measureFinishedRequest() by hand.
    describe('real HTTP request through the app', () => {
        it('records a real successful request against the http_requests_total counter and duration histogram', async () => {
            const res: Response = await fetch(`${baseUrl}/metrics-integration-test/ok`);
            expect(res.status).toBe(200);
            await res.json();

            await service.collect();
            const snapshot: MetricsSnapshot = service.getMetricSnapshots().at(-1) as MetricsSnapshot;

            const counter: Metric | undefined = snapshot.metrics.find(
                m => m.name === 'http_requests_total'
                    && m.labels['route'] === '/metrics-integration-test/ok'
                    && m.labels['status_code'] === '200'
                    && m.labels['method'] === 'GET'
            );
            expect(counter?.value).toBeGreaterThanOrEqual(1);

            const histogramCount: Metric | undefined = snapshot.metrics.find(
                m => m.name === 'http_request_duration_ms_count' && m.labels['route'] === '/metrics-integration-test/ok'
            );
            expect(histogramCount?.value).toBeGreaterThanOrEqual(1);
        });

        it('records the real status code for a request that ends in an error response', async () => {
            const res: Response = await fetch(`${baseUrl}/metrics-integration-test/abc/missing`);
            expect(res.status).toBe(404);

            await service.collect();
            const snapshot: MetricsSnapshot = service.getMetricSnapshots().at(-1) as MetricsSnapshot;

            // the template, not the url that was asked for. `abc` is a path parameter, and labelling
            // by the url is what made every distinct id its own series - the cardinality bomb this
            // was fixed for. A 404 raised by a route that matched is still a matched route
            const counter: Metric | undefined = snapshot.metrics.find(
                m => m.name === 'http_requests_total'
                    && m.labels['route'] === '/metrics-integration-test/:id/missing'
                    && m.labels['status_code'] === '404'
            );
            expect(counter?.value).toBeGreaterThanOrEqual(1);
        });
    });
});