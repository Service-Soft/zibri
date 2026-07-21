import type { Chart as ChartJsChart } from 'chart.js';
import { $f, $ts, MetricsSnapshot, PreactComponent } from 'zibri';

import { Chart } from '../../../components/chart';

type Props = {
    className?: string,
    secondary: string
};

type DataPoint = { x: Date, y: number };

export const CacheOverviewChart: PreactComponent<Props> = ({ secondary, className }) => {

    function updateChart(chart: ChartJsChart<'line', DataPoint[]>, snaps: MetricsSnapshot[]): void {
        if (!snaps.length) {
            return;
        }

        const hitRateSeries: DataPoint[] = snaps.map((snap, i) => {
            if (i === 0) {
                return { x: new Date(snap.timestamp), y: 0 };
            }

            const prev: MetricsSnapshot = snaps[i - 1];
            const hitsNow: number = snap.metrics.filter(m => m.name === 'cache_hits_total').reduce((p, c) => p + c.value, 0);
            const hitsPrev: number = prev.metrics.filter(m => m.name === 'cache_hits_total').reduce((p, c) => p + c.value, 0);
            const missesNow: number = snap.metrics.filter(m => m.name === 'cache_misses_total').reduce((p, c) => p + c.value, 0);
            const missesPrev: number = prev.metrics.filter(m => m.name === 'cache_misses_total').reduce((p, c) => p + c.value, 0);

            const deltaHits: number = hitsNow - hitsPrev;
            const deltaMisses: number = missesNow - missesPrev;
            const total: number = deltaHits + deltaMisses;

            return {
                x: new Date(snap.timestamp),
                y: total === 0 ? 0 : Math.round((deltaHits / total) * 100)
            };
        });

        const errorSeries: DataPoint[] = snaps.map((snap, i) => {
            if (i === 0) {
                return { x: new Date(snap.timestamp), y: 0 };
            }

            const prev: MetricsSnapshot = snaps[i - 1];
            const errorsNow: number = snap.metrics
                .filter(m => m.name === 'cache_invalidation_failures_total' || m.name === 'cache_errors_total')
                .reduce((p, c) => p + c.value, 0);
            const errorsPrev: number = prev.metrics
                .filter(m => m.name === 'cache_invalidation_failures_total' || m.name === 'cache_errors_total')
                .reduce((p, c) => p + c.value, 0);

            return {
                x: new Date(snap.timestamp),
                y: errorsNow - errorsPrev
            };
        });

        chart.data.datasets[0].data = hitRateSeries;
        chart.data.datasets[1].data = errorSeries;

        chart.update();
    }

    return <>
        <Chart
            className={className}
            title={$ts`Overview`}
            canvasId='cacheOverviewChart'
            chartConfig={{
                type: 'line',
                data: {
                    datasets: [
                        {
                            label: $ts`Hit rate`,
                            data: [],
                            backgroundColor: secondary,
                            borderColor: secondary
                        },
                        {
                            label: $ts`Cache Errors`,
                            data: [],
                            fill: true,
                            yAxisID: 'y1',
                            backgroundColor: 'red',
                            borderColor: 'red'
                        }
                    ]
                },
                options: {
                    scales: {
                        x: {
                            type: 'time',
                            time: {
                                unit: 'second',
                                displayFormats: {
                                    second: 'HH:mm:ss'
                                }
                            },
                            ticks: { stepSize: 5, source: 'auto' },
                            grid: { display: false }
                        },
                        y: {
                            min: 0,
                            max: 100,
                            ticks: { callback: v => $f.percent(Number(v)) },
                            title: { display: true, text: $ts`Hit rate (%)` },
                            grid: { display: true }
                        },
                        y1: {
                            min: 0,
                            position: 'right',
                            grid: { drawOnChartArea: false },
                            title: { display: true, text: $ts`Errors` },
                            ticks: { stepSize: 1 }
                        }
                    }
                }
            }}
            updateChart={updateChart}
        />
    </>;
};