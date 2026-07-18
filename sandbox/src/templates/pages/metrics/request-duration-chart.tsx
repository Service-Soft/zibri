import type { Chart as ChartJsChart } from 'chart.js';
import { $ts, Metric, MetricsSnapshot, PreactComponent } from 'zibri';

import { Chart } from '../../components/chart';

type Props = {
    className?: string,
    secondary: string
};

export const RequestDurationChart: PreactComponent<Props> = ({ className = '', secondary }) => {

    function updateChart(chart: ChartJsChart, snaps: MetricsSnapshot[]): void {
        if (!snaps.length) {
            return;
        }
        // Build histogram from the *latest* snapshot only
        const latest: Metric[] = snaps[snaps.length - 1]?.metrics ?? [];
        const sumsByLe: Record<string, number> = latest
            .reduce<Record<string, number>>((map, m) => {
                if (m.name !== 'http_request_duration_ms_bucket' || m.labels.le == undefined) {
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

        chart.data.labels = hist.labels;
        chart.data.datasets[0].data = hist.values;
        chart.update();
    }

    return (
        <Chart
            canvasId="requestDurationChart"
            title={$ts`Request duration`}
            className={className}
            chartConfig={{
                type: 'bar',
                data: { labels: [], datasets: [{ label: 'Count', data: [], backgroundColor: secondary }] }
            }}
            updateChart={updateChart}
        />
    );
};