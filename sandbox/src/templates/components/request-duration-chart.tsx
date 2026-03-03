import { Chart as ChartJsChart } from 'chart.js?client';
import { Metric, MetricsSnapshot, onClient, PreactComponent } from 'zibri';

import { Chart } from './chart';
import { MetricsEvent } from '../pages/metrics';

type Props = {
    className?: string,
    secondary: string
};

export const RequestDurationChart: PreactComponent<Props> = ({ className = '', secondary }) => {
    let requestDurationChart: ChartJsChart | undefined;

    onClient(() => {
        document.addEventListener('metrics:update', (ev) => {
            if (!(ev instanceof CustomEvent) || !('snaps' in ev.detail)) {
                throw new Error('received invalid metrics event');
            }
            const { snaps } = (ev as MetricsEvent).detail;
            renderRequestDurationChart(snaps);
        });
    });

    function renderRequestDurationChart(snaps: MetricsSnapshot[]): void {
        if (!snaps.length) {
            return;
        }
        // Build histogram from the *latest* snapshot only
        const latest: Metric[] = snaps[snaps.length - 1]?.metrics ?? [];
        const sumsByLe: Record<string, number> = latest
            .reduce<Record<string, number>>((map, m) => {
                if (m.name !== 'http_request_duration_ms' || m.labels.le == undefined) {
                    return map;
                }
                const le: string | number = m.labels.le;
                map[le] = (map[le] ?? 0) + m.value;
                return map;
            }, {});
        const sorted: { le: string, v: number }[] = Object.entries(sumsByLe)
            .map(([le, v]) => ({ le, v }))
            .sort((a, b) => {
                const na: number = a.le === '+Inf' ? Infinity : +a.le;
                const nb: number = b.le === '+Inf' ? Infinity : +b.le;
                return na - nb;
            });
        const perBucket: { le: string, v: number }[] = sorted.map((cur, i) => {
            const prev: number = i > 0 ? sorted[i - 1].v : 0;
            return { le: cur.le, v: cur.v - prev };
        });
        const hist: { labels: string[], values: number[] } = perBucket.reduce<{ labels: string[], values: number[] }>(
            (acc, m) => {
                acc.labels.push(`${m.le} ms`);
                acc.values.push(m.v);
                return acc;
            },
            { labels: [], values: [] }
        );

        if (requestDurationChart) {
            requestDurationChart.data.labels = hist.labels;
            requestDurationChart.data.datasets[0].data = hist.values;
            requestDurationChart.update();
            return;
        }

        const el: HTMLCanvasElement | null = document.querySelector('#requestDurationChart');
        if (!el) {
            return;
        }
        // render latency histogram
        requestDurationChart = new ChartJsChart(el, {
            type: 'bar',
            data: { labels: hist.labels, datasets: [{ label: 'Count', data: hist.values, backgroundColor: secondary }] }
        });
    }

    return (
        <>
            <Chart canvasId="requestDurationChart" title="Request duration" className={className}></Chart>
        </>
    );
};