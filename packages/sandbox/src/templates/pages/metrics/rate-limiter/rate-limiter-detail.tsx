import type { Chart as ChartJsChart } from 'chart.js';
import { $ts, MetricsSnapshot, PreactComponent } from 'zibri';

import { Chart } from '../../../components/chart';

type Props = {
    name: string,
    primary: string,
    secondary: string
};

export const RateLimiterDetail: PreactComponent<Props> = ({ name, primary, secondary }) => {
    return (
        <div className="flex flex-col gap-3">
            <h3 className="text-white text-2xl tracking-wider">{name}</h3>
            <div className="grid grid-cols-3 gap-5">
                <Chart
                    title={$ts`Allowed / Blocked`}
                    canvasId={`hitMiss-${name}`}
                    chartConfig={{
                        type: 'line',
                        data: {
                            datasets: [
                                {
                                    label: $ts`Allowed`,
                                    data: [],
                                    borderColor: 'green',
                                    backgroundColor: 'green',
                                    fill: false
                                },
                                {
                                    label: $ts`Blocked`,
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
                                y: { beginAtZero: true, title: { display: true, text: $ts`Count` } }
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
                                .filter(m => m.name === metricName && m.labels['limiter'] === name)
                                .reduce((p, c) => p + c.value, 0);

                            if (i === 0) {
                                hitSeries.push({ x: t, y: 0 });
                                missSeries.push({ x: t, y: 0 });
                            }
                            else {
                                hitSeries.push({
                                    x: t,
                                    y: get('rate_limit_allowed_total', snap) - get('rate_limit_allowed_total', prev)
                                });
                                missSeries.push({
                                    x: t,
                                    y: get('rate_limit_blocked_total', snap) - get('rate_limit_blocked_total', prev)
                                });
                            }
                        }

                        chart.data.datasets[0].data = hitSeries;
                        chart.data.datasets[1].data = missSeries;
                        chart.update();
                    }}
                />
                <Chart
                    title={$ts`Decision & Store duration`}
                    canvasId={`duration-${name}`}
                    chartConfig={{
                        type: 'bar',
                        data: {
                            labels: [],
                            datasets: [
                                { label: $ts`Decision (mean)`, data: [], backgroundColor: secondary },
                                { label: $ts`Store (mean)`, data: [], backgroundColor: primary }
                            ]
                        },
                        options: {
                            animation: false,
                            scales: {
                                // x: { title: { display: true, text: $ts`Mean` } },
                                y: { beginAtZero: true, title: { display: true, text: 'ms' } }
                            }
                        }
                    }}
                    updateChart={(chart: ChartJsChart, snaps: MetricsSnapshot[]) => {
                        if (!snaps.length) {
                            return;
                        }
                        const latest: MetricsSnapshot = snaps[snaps.length - 1];

                        const getMean: (base: string) => number = (base: string): number => {
                            const sum: number = latest.metrics.find(
                                m => m.name === `${base}_sum` && m.labels['limiter'] === name
                            )?.value ?? 0;

                            const count: number = latest.metrics.find(
                                m => m.name === `${base}_count` && m.labels['limiter'] === name
                            )?.value ?? 0;

                            return count === 0 ? 0 : Math.round((sum / count) * 10) / 10;
                        };

                        chart.data.labels = [$ts`Mean`];
                        chart.data.datasets[0].data = [getMean('rate_limit_decision_duration_ms')];
                        chart.data.datasets[1].data = [getMean('rate_limit_store_duration_ms')];
                        chart.update();
                    }}
                />
                <Chart
                    title={$ts`Active Keys`}
                    canvasId={`sizeInflight-${name}`}
                    chartConfig={{
                        type: 'line',
                        data: {
                            datasets: [
                                {
                                    label: $ts`Active keys`,
                                    data: [],
                                    borderColor: secondary,
                                    backgroundColor: secondary,
                                    fill: false,
                                    yAxisID: 'y'
                                },
                                {
                                    label: $ts`Reservations`,
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
                                y: { beginAtZero: true, title: { display: true, text: $ts`Count` } },
                                y1: {
                                    position: 'right',
                                    beginAtZero: true,
                                    grid: { drawOnChartArea: false },
                                    title: { display: true, text: $ts`Count` }
                                }
                            }
                        }
                    }}
                    updateChart={(chart: ChartJsChart, snaps: MetricsSnapshot[]) => {
                        chart.data.datasets[0].data = snaps.map(snap => ({
                            x: new Date(snap.timestamp).getTime(),
                            y: snap.metrics.find(
                                m => m.name === 'rate_limit_active_keys' && m.labels['limiter'] === name
                            )?.value ?? 0
                        }));
                        chart.data.datasets[1].data = snaps.map(snap => ({
                            x: new Date(snap.timestamp).getTime(),
                            y: snap.metrics.find(
                                m => m.name === 'rate_limit_active_reservations' && m.labels['limiter'] === name
                            )?.value ?? 0
                        }));
                        chart.update();
                    }}
                />
            </div>
        </div>
    );
};