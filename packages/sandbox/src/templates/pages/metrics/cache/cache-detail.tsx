import type { Chart as ChartJsChart } from 'chart.js';
import { $ts, MetricsSnapshot, PreactComponent } from 'zibri';

import { Chart } from '../../../components/chart';

type Props = {
    name: string,
    primary: string,
    secondary: string
};

export const CacheDetail: PreactComponent<Props> = ({ name, primary, secondary }) => {
    return (
        <div className="flex flex-col gap-3">
            <h3 className="text-white text-2xl tracking-wider">{name}</h3>
            <div className="grid grid-cols-3 gap-5">
                <Chart
                    title={$ts`Hit / Miss`}
                    canvasId={`hitMiss-${name}`}
                    chartConfig={{
                        type: 'line',
                        data: {
                            datasets: [
                                {
                                    label: $ts`Hits`,
                                    data: [],
                                    borderColor: 'green',
                                    backgroundColor: 'green',
                                    fill: false
                                },
                                {
                                    label: $ts`Misses`,
                                    data: [],
                                    borderColor: secondary,
                                    backgroundColor: secondary,
                                    fill: false
                                }
                            ]
                        },
                        options: {
                            animation: false,
                            scales: {
                                x: {
                                    type: 'time',
                                    time: { unit: 'second', displayFormats: { second: 'HH:mm:ss' } },
                                    grid: { display: false }
                                },
                                y: { beginAtZero: true, title: { display: true, text: $ts`Count (delta)` } }
                            }
                        }
                    }}
                    updateChart={(chart: ChartJsChart, snaps: MetricsSnapshot[]) => {
                        const hitSeries: { x: number, y: number }[] = [];
                        const missSeries: { x: number, y: number }[] = [];

                        for (let i: number = 0; i < snaps.length; i++) {
                            const snap: MetricsSnapshot = snaps[i];
                            const prev: MetricsSnapshot = snaps[i - 1];
                            const t: number = new Date(snap.timestamp).getTime();

                            const get: (metricName: string, s: MetricsSnapshot) => number = (metricName, s) => s.metrics
                                .filter(m => m.name === metricName && m.labels['cache'] === name)
                                .reduce((p, c) => p + c.value, 0);

                            if (i === 0) {
                                hitSeries.push({ x: t, y: 0 });
                                missSeries.push({ x: t, y: 0 });
                            }
                            else {
                                hitSeries.push({ x: t, y: get('cache_hits_total', snap) - get('cache_hits_total', prev) });
                                missSeries.push({ x: t, y: get('cache_misses_total', snap) - get('cache_misses_total', prev) });
                            }
                        }

                        chart.data.datasets[0].data = hitSeries;
                        chart.data.datasets[1].data = missSeries;
                        chart.update();
                    }}
                />
                <Chart
                    title={$ts`Source & Store duration`}
                    canvasId={`duration-${name}`}
                    chartConfig={{
                        type: 'bar',
                        data: {
                            labels: [],
                            datasets: [
                                { label: $ts`Source (mean)`, data: [], backgroundColor: secondary },
                                { label: $ts`Store (mean)`, data: [], backgroundColor: primary }
                            ]
                        },
                        options: {
                            animation: false,
                            scales: {
                                x: { title: { display: true, text: $ts`Operation` } },
                                y: { beginAtZero: true, title: { display: true, text: 'ms' } }
                            }
                        }
                    }}
                    updateChart={(chart: ChartJsChart, snaps: MetricsSnapshot[]) => {
                        if (!snaps.length) {
                            return;
                        }
                        const latest: MetricsSnapshot = snaps[snaps.length - 1];

                        const operations: string[] = [
                            ...new Set(
                                latest.metrics
                                    .filter(m => (m.name === 'cache_source_duration_ms_sum' || m.name === 'cache_store_duration_ms_sum')
                                        && m.labels['cache'] === name
                                        && m.labels['operation'] != undefined)
                                    .map(m => m.labels['operation'] as string)
                            )
                        ];

                        const getMean: (base: string, op: string) => number = (base, op) => {
                            const sum: number = latest.metrics.find(
                                m => m.name === `${base}_sum` && m.labels['cache'] === name && m.labels['operation'] === op
                            )?.value ?? 0;
                            const count: number = latest.metrics.find(
                                m => m.name === `${base}_count` && m.labels['cache'] === name && m.labels['operation'] === op
                            )?.value ?? 0;
                            return count === 0 ? 0 : Math.round((sum / count) * 10) / 10;
                        };

                        chart.data.labels = operations;
                        chart.data.datasets[0].data = operations.map(op => getMean('cache_source_duration_ms', op));
                        chart.data.datasets[1].data = operations.map(op => getMean('cache_store_duration_ms', op));
                        chart.update();
                    }}
                />
                <Chart
                    title={$ts`Size & In-flight`}
                    canvasId={`sizeInflight-${name}`}
                    chartConfig={{
                        type: 'line',
                        data: {
                            datasets: [
                                {
                                    label: $ts`Size`,
                                    data: [],
                                    borderColor: secondary,
                                    backgroundColor: secondary,
                                    fill: false,
                                    yAxisID: 'y'
                                },
                                {
                                    label: $ts`In-flight`,
                                    data: [],
                                    borderColor: primary,
                                    backgroundColor: primary,
                                    fill: false,
                                    yAxisID: 'y1'
                                }
                            ]
                        },
                        options: {
                            animation: false,
                            scales: {
                                x: {
                                    type: 'time',
                                    time: { unit: 'second', displayFormats: { second: 'HH:mm:ss' } },
                                    grid: { display: false }
                                },
                                y: { beginAtZero: true, title: { display: true, text: $ts`Entries` } },
                                y1: {
                                    position: 'right',
                                    beginAtZero: true,
                                    grid: { drawOnChartArea: false },
                                    title: { display: true, text: $ts`In-flight` }
                                }
                            }
                        }
                    }}
                    updateChart={(chart: ChartJsChart, snaps: MetricsSnapshot[]) => {
                        chart.data.datasets[0].data = snaps.map(snap => ({
                            x: new Date(snap.timestamp).getTime(),
                            y: snap.metrics.find(m => m.name === 'cache_size' && m.labels['cache'] === name)?.value ?? 0
                        }));
                        chart.data.datasets[1].data = snaps.map(snap => ({
                            x: new Date(snap.timestamp).getTime(),
                            y: snap.metrics.find(m => m.name === 'cache_in_flight' && m.labels['cache'] === name)?.value ?? 0
                        }));
                        chart.update();
                    }}
                />
            </div>
        </div>
    );
};