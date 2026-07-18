import type { Chart as ChartJsChart } from 'chart.js';
import { $f, $ts, MetricsSnapshot, PreactComponent } from 'zibri';

import { Chart } from '../../../components/chart';

type Props = {
    className?: string,
    secondary: string
};

type DataPoint = { x: Date, y: number };

export const RateLimiterOverviewChart: PreactComponent<Props> = ({ secondary, className }) => {

    function updateChart(chart: ChartJsChart<'line', DataPoint[]>, snaps: MetricsSnapshot[]): void {
        if (!snaps.length) {
            return;
        }

        const blockRateSeries: DataPoint[] = snaps.map((snap, i) => {
            if (i === 0) {
                return { x: new Date(snap.timestamp), y: 0 };
            }

            const prev: MetricsSnapshot = snaps[i - 1];
            const allowedNow: number = snap.metrics.filter(m => m.name === 'rate_limit_allowed_total').reduce((p, c) => p + c.value, 0);
            const allowedPrev: number = prev.metrics.filter(m => m.name === 'rate_limit_allowed_total').reduce((p, c) => p + c.value, 0);
            const blockedNow: number = snap.metrics.filter(m => m.name === 'rate_limit_blocked_total').reduce((p, c) => p + c.value, 0);
            const blockedPrev: number = prev.metrics.filter(m => m.name === 'rate_limit_blocked_total').reduce((p, c) => p + c.value, 0);

            const deltaAllowed: number = allowedNow - allowedPrev;
            const deltaBlocked: number = blockedNow - blockedPrev;
            const total: number = deltaAllowed + deltaBlocked;

            return {
                x: new Date(snap.timestamp),
                y: total === 0 ? 0 : Math.round((deltaBlocked / total) * 100)
            };
        });

        const errorSeries: DataPoint[] = snaps.map((snap, i) => {
            if (i === 0) {
                return { x: new Date(snap.timestamp), y: 0 };
            }

            const prev: MetricsSnapshot = snaps[i - 1];
            const errorsNow: number = snap.metrics.filter(m => m.name === 'rate_limit_errors_total').reduce((p, c) => p + c.value, 0);
            const errorsPrev: number = prev.metrics.filter(m => m.name === 'rate_limit_errors_total').reduce((p, c) => p + c.value, 0);

            return {
                x: new Date(snap.timestamp),
                y: errorsNow - errorsPrev
            };
        });

        chart.data.datasets[0].data = blockRateSeries;
        chart.data.datasets[1].data = errorSeries;

        chart.update();
    }

    return <>
        <Chart
            className={className}
            title={$ts`Overview`}
            canvasId='rateLimiterOverviewChart'
            chartConfig={{
                type: 'line',
                data: {
                    datasets: [
                        {
                            label: $ts`Block rate`,
                            data: [],
                            backgroundColor: secondary,
                            borderColor: secondary
                        },
                        {
                            label: $ts`Errors`,
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
                            title: { display: true, text: $ts`Block rate (%)` },
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