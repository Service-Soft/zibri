import type { Chart as ChartJsChart } from 'chart.js';
import { $ts, MetricsSnapshot, PreactComponent } from 'zibri';

import { Chart } from './chart';

type Props = {
    primary: string,
    secondary: string,
    className?: string
};

type DataPoint = { x: Date, y: number };

export const NetworkChart: PreactComponent<Props> = ({ primary, secondary, className = '' }) => {

    function toRateSeries(
        series: number[],
        times: Date[]
    ): DataPoint[] {
        return times.map((t: Date, i: number): DataPoint => {
            if (i === 0) {
                return { x: t, y: 0 };
            }
            const intervalSec: number = (times[i].getTime() - times[i - 1].getTime()) / 1000;
            return { x: t, y: intervalSec > 0 ? (series[i] - series[i - 1]) / intervalSec : 0 };
        });
    }

    function updateChart(chart: ChartJsChart<'line', DataPoint[]>, snaps: MetricsSnapshot[]): void {
        if (snaps.length < 2) {
            return;
        }

        // extract series of cumulative values
        const rxSeries: number[] = snaps.map(s => s.metrics.find(m => m.name === 'network_bytes_received_total')?.value ?? 0);
        const txSeries: number[] = snaps.map(s => s.metrics.find(m => m.name === 'network_bytes_transmitted_total')?.value ?? 0);
        const times: Date[] = snaps.map(s => new Date(s.timestamp));

        // build bytes/sec points
        const dataRx: DataPoint[] = toRateSeries(rxSeries, times);
        const dataTx: DataPoint[] = toRateSeries(txSeries, times);

        chart.data.datasets[0].data = dataRx;
        chart.data.datasets[1].data = dataTx;
        chart.update();
    }

    return (
        <Chart
            canvasId="networkChart"
            title={$ts`Network`}
            className={className}
            chartConfig={{
                type: 'line',
                data: {
                    datasets: [
                        { label: 'bytes received', data: [], backgroundColor: secondary, borderColor: secondary },
                        { label: 'bytes sent', data: [], backgroundColor: primary, borderColor: primary }
                    ]
                },
                options: {
                    scales: {
                        x: {
                            type: 'time',
                            time: { unit: 'second', displayFormats: { second: 'HH:mm:ss' } },
                            grid: { display: false }
                        },
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: v => typeof v === 'number' ? `${(v / 1000).toFixed(1)} KB` : v
                            }
                        }
                    },
                    plugins: { legend: { position: 'top' } }
                }
            }}
            updateChart={updateChart}
        />
    );
};