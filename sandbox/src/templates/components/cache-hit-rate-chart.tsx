import type { Chart as ChartJsChart } from 'chart.js';
import { MetricsSnapshot, PreactComponent } from 'zibri';

import { Chart } from './chart';

type Props = {
    className?: string,
    primary: string
};

type DataPoint = { x: Date, y: number };

export const CacheHitRateChart: PreactComponent<Props> = ({ className = '', primary }) => {

    function updateChart(chart: ChartJsChart<'line', DataPoint[]>, snaps: MetricsSnapshot[]): void {
        if (!snaps.length) {
            return;
        }

        const cacheNames: Set<string> = new Set(
            snaps.flatMap(s => s.metrics)
                .filter(m => m.name === 'cache_hits_total' && m.labels['cache'] != undefined)
                .map(m => m.labels['cache'] as string)
        );

        const dataPerCache: Record<string, DataPoint[]> = {};

        for (const snap of snaps) {
            const getTotal: (metricName: string, cacheName: string) => number = (metricName, cacheName) => snap.metrics
                .filter(m => m.name === metricName && m.labels['cache'] === cacheName)
                .reduce((sum, m) => sum + m.value, 0);

            for (const cacheName of cacheNames) {
                const hits: number = getTotal('cache_hits_total', cacheName);
                const misses: number = getTotal('cache_misses_total', cacheName);
                const total: number = hits + misses;
                dataPerCache[cacheName] ??= [];
                dataPerCache[cacheName].push({
                    x: snap.timestamp,
                    y: total === 0 ? 0 : Math.round((hits / total) * 100)
                });
            }
        }

        chart.data.datasets = [...cacheNames].map((cacheName, i) => ({
            label: cacheName,
            data: dataPerCache[cacheName],
            borderColor: i === 0 ? primary : `hsl(${(i * 47) % 360}, 70%, 60%)`,
            fill: false,
            tension: 0.3
        }));
        chart.update();
    }

    return <Chart
        canvasId="cacheHitRateChart"
        title="Cache hit rate"
        className={className}
        chartConfig={{
            type: 'line',
            data: { datasets: [] },
            options: {
                scales: {
                    x: { type: 'time', time: { unit: 'second' } },
                    y: { min: 0, max: 100, ticks: { callback: v => `${v}%` } }
                }
            }
        }}
        updateChart={updateChart}
    />;
};