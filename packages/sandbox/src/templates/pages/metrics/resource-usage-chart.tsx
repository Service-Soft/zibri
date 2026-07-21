import type { Chart as ChartJsChart } from 'chart.js';
import { $f, $ts, Metric, MetricsSnapshot, PreactComponent } from 'zibri';

import { Chart } from '../../components/chart';

type Props = {
    primary: string,
    secondary: string,
    className?: string
};

type DataPoint = { x: Date, y: number };

export const ResourceUsageChart: PreactComponent<Props> = ({ primary, secondary, className = '' }) => {

    function updateChart(chart: ChartJsChart<'line', DataPoint[]>, snaps: MetricsSnapshot[]): void {
        const ramSeries: DataPoint[] = snaps.map(snap => {
            const mem: Metric | undefined = snap.metrics.find(m => m.name === 'process_resident_memory_bytes');
            return {
                x: new Date(snap.timestamp),
                y: mem ? mem.value / 1024 / 1024 : 0 // MB
            };
        });

        const userSeries: number[] = snaps.map(s => s.metrics.find(m => m.name === 'process_cpu_user_seconds_total')?.value ?? 0);
        const systemSeries: number[] = snaps.map(s => s.metrics.find(m => m.name === 'process_cpu_system_seconds_total')?.value ?? 0);
        const times: number[] = snaps.map(s => new Date(s.timestamp).getTime() / 1000); // seconds
        const coresSeries: number[] = snaps.map(s => s.metrics.find(m => m.name === 'process_cpu_count')?.value ?? 1);
        const cpuSeries: DataPoint[] = times.map((t, i) => {
            if (i === 0) {
                return { x: new Date(t * 1000), y: 0 };
            }
            const dt: number = t - times[i - 1]; // interval in seconds (should be ~5)
            const du: number = userSeries[i] - userSeries[i - 1];
            const ds: number = systemSeries[i] - systemSeries[i - 1];
            const cores: number = coresSeries[i];
            const usedSec: number = du + ds; // total CPU seconds used in that interval
            const pct: number = (usedSec / dt / cores) * 100; // CPU% across all cores
            return { x: new Date(t * 1000), y: pct };
        });

        chart.data.datasets[0].data = ramSeries;
        chart.data.datasets[1].data = cpuSeries;
        chart.update();
    }

    return (
        <Chart
            canvasId="resourceUsageChart"
            title={$ts`Resource Usage`}
            className={className}
            chartConfig={{
                type: 'line',
                data: {
                    datasets: [
                        {
                            label: $ts`RAM (MB)`,
                            data: [],
                            yAxisID: 'y',
                            borderColor: secondary,
                            backgroundColor: secondary
                        },
                        {
                            label: $ts`CPU (%)`,
                            data: [],
                            yAxisID: 'yCPU',
                            borderColor: primary,
                            backgroundColor: primary
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
                            grid: { display: false }
                        },
                        y: {
                            ticks: {
                                callback: v => `${v} MB`
                            },
                            beginAtZero: true
                        },
                        yCPU: {
                            position: 'right',
                            grid: { drawOnChartArea: false }, // don't duplicate grid lines
                            min: 0,
                            max: 100,
                            ticks: {
                                callback: v => $f.percent(Number(v))
                            }
                        }
                    }
                }
            }}
            updateChart={updateChart}
        />
    );
};