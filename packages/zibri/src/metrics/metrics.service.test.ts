import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

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
            const req: HttpRequest = { method: 'GET', originalUrl: '/some/route' } as unknown as HttpRequest;
            const res: HttpResponse = { statusCode: 200 } as unknown as HttpResponse;

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
            const req: HttpRequest = { method: 'GET', originalUrl: '/assets/some/file.png' } as unknown as HttpRequest;
            const res: HttpResponse = { statusCode: 200 } as unknown as HttpResponse;

            service.measureFinishedRequest(req, res, 1);
            await service.collect();

            const snapshot: MetricsSnapshot = service.getMetricSnapshots().at(-1) as MetricsSnapshot;
            const counterMetric: Metric | undefined = snapshot.metrics.find(
                m => m.name === 'http_requests_total' && m.labels['route'] === '/assets/some/file.png'
            );
            expect(counterMetric).toBeUndefined();
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

            const counter: Metric | undefined = snapshot.metrics.find(
                m => m.name === 'http_requests_total'
                    && m.labels['route'] === '/metrics-integration-test/abc/missing'
                    && m.labels['status_code'] === '404'
            );
            expect(counter?.value).toBeGreaterThanOrEqual(1);
        });
    });
});