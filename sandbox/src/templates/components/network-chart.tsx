import { ChartDataset, Chart as ChartJsChart } from 'chart.js?client';
import { MetricsSnapshot, onClient, PreactComponent } from 'zibri';

import { Chart } from './chart';
import { MetricsEvent } from '../pages/metrics';

type Props = {
    primary: string,
    secondary: string,
    className?: string
};

type DataPoint = { x: Date, y: number };

export const NetworkChart: PreactComponent<Props> = ({ primary, secondary, className = '' }) => {
    let networkChart: ChartJsChart<'line', DataPoint[]> | undefined;

    onClient(() => {
        document.addEventListener('metrics:update', (ev) => {
            if (!(ev instanceof CustomEvent) || !('snaps' in ev.detail)) {
                throw new Error('received invalid metrics event');
            }
            const { snaps } = (ev as MetricsEvent).detail;
            renderNetworkChart(snaps);
        });
    });

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

    function renderNetworkChart(snaps: MetricsSnapshot[]): void {
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

        const datasets: ChartDataset<'line', DataPoint[]>[] = [
            { label: 'bytes received', data: dataRx, backgroundColor: secondary, borderColor: secondary },
            { label: 'bytes sent', data: dataTx, backgroundColor: primary, borderColor: primary }
        ];

        if (networkChart) {
            networkChart.data.datasets[0].data = datasets[0].data;
            networkChart.data.datasets[1].data = datasets[1].data;
            networkChart.update();
            return;
        }

        const el: HTMLCanvasElement | null = document.querySelector('#networkChart');
        if (!el) {
            return;
        }

        networkChart = new ChartJsChart<'line', DataPoint[]>(el, {
            type: 'line',
            data: { datasets },
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
        });
    }

    return (
        <>
            <Chart canvasId="networkChart" title="Network" className={className}></Chart>
        </>
    );
};