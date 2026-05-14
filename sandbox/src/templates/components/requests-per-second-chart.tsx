import type { Chart as ChartJsChart } from 'chart.js';
import { Metric, MetricsSnapshot, PreactComponent } from 'zibri';

import { Chart } from './chart';

type Props = {
    secondary: string,
    className?: string
};

type StatusClass = 'success' | 'client' | 'server';

type DataPoint = { x: Date, y: number };

export const RequestsPerSecondChart: PreactComponent<Props> = ({ secondary, className = '' }) => {

    function sumForStatus(statusClass: StatusClass, metrics: Metric[]): number {
        return metrics.filter(m => {
            if (m.name !== 'http_requests_total') {
                return false;
            }
            if (m.labels.status_code == undefined) {
                return false;
            }
            switch (statusClass) {
                case 'success': {
                    return !m.labels.status_code.toString().startsWith('5') && !m.labels.status_code.toString().startsWith('4');
                }
                case 'client': {
                    return m.labels.status_code.toString().startsWith('4');
                }
                case 'server': {
                    return m.labels.status_code.toString().startsWith('5');
                }
            }
        }).reduce((acc, m) => acc + m.value, 0);
    }

    function updateChart(chart: ChartJsChart<'line', DataPoint[]>, snaps: MetricsSnapshot[]): void {
        const seriesSuccess: DataPoint[] = [];
        const seriesClientError: DataPoint[] = [];
        const seriesServerError: DataPoint[] = [];

        // eslint-disable-next-line unicorn/no-array-for-each
        snaps.forEach((snap, i, all) => {
            const t: Date = new Date(snap.timestamp);
            if (i === 0) {
                seriesSuccess.push({ x: t, y: 0 });
                seriesClientError.push({ x: t, y: 0 });
                seriesServerError.push({ x: t, y: 0 });
                return;
            }

            const intervalSec: number = (new Date(snap.timestamp).getTime() - new Date(all[i - 1].timestamp).getTime()) / 1000;

            const prev: Metric[] = all[i - 1].metrics;
            const curr: Metric[] = snap.metrics;
            // sum counts by class
            const sum: (statusClass: StatusClass) => number = (statusClass: StatusClass) => {
                return (sumForStatus(statusClass, curr) - sumForStatus(statusClass, prev)) / intervalSec;
            };
            seriesSuccess.push({ x: t, y: sum('success') });
            seriesClientError.push({ x: t, y: sum('client') });
            seriesServerError.push({ x: t, y: sum('server') });
        });

        // build event‑loop lag series (in ms)
        const lagSeries: DataPoint[] = snaps.map(snap => {
            // eslint-disable-next-line cspell/spellchecker
            const m: Metric | undefined = snap.metrics.find(m => m.name === 'nodejs_eventloop_lag_seconds');
            return {
                x: new Date(snap.timestamp),
                y: m ? m.value * 1000 : 0
            };
        });

        chart.data.datasets[0].data = lagSeries;
        chart.data.datasets[1].data = seriesServerError;
        chart.data.datasets[2].data = seriesClientError;
        chart.data.datasets[3].data = seriesSuccess;
        chart.update();
    }

    return (
        <Chart
            canvasId="rpsChart"
            title="Requests per second"
            className={className}
            chartConfig={{
                type: 'line',
                data: {
                    datasets: [
                        {
                            label: 'Event Loop Lag',
                            data: [],
                            fill: false,
                            yAxisID: 'y1',
                            backgroundColor: 'purple',
                            borderColor: 'purple'
                        },
                        {
                            label: 'Server Error',
                            data: [],
                            fill: true,
                            backgroundColor: 'red',
                            borderColor: 'red'
                        },
                        {
                            label: 'Client Error',
                            data: [],
                            fill: true,
                            backgroundColor: secondary,
                            borderColor: secondary
                        },
                        {
                            label: 'Success',
                            data: [],
                            fill: true,
                            backgroundColor: 'green',
                            borderColor: 'green'
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
                            stacked: true,
                            beginAtZero: true,
                            title: { display: true, text: 'Requests/sec' },
                            grid: { display: true }
                        },
                        y1: {
                            position: 'right',
                            title: { display: true, text: 'Lag (ms)' },
                            ticks: { callback: (v): string => typeof v === 'number' ? `${v.toFixed(1)} ms` : v }
                        }
                    }
                }
            }}
            updateChart={updateChart}
        />
    );
};