import { ChartConfiguration, Chart as ChartJsChart } from 'chart.js?client';
import { $ts, MetricsSnapshot, onClient, PreactComponent } from 'zibri';

import { Card } from './card';
import { Heading } from './heading';
import { MetricsEvent } from '../pages/metrics/metrics';

type Props = {
    title: string,
    canvasId: string,
    chartConfig: ChartConfiguration,
    // eslint-disable-next-line typescript/no-explicit-any
    updateChart: (chart: ChartJsChart<any, any>, snaps: MetricsSnapshot[]) => void,
    className?: string
};

export const Chart: PreactComponent<Props> = ({ className = '', title, canvasId, chartConfig, updateChart }) => {
    onClient(() => {
        let chart: ChartJsChart | undefined;

        window.addEventListener('load', () => {
            const el: HTMLElement | null = document.getElementById(canvasId);
            if (!el) {
                return;
            }

            new IntersectionObserver(([entry]) => {
                if (entry.isIntersecting) {
                    if (!chart) {
                        const canvas: HTMLCanvasElement | null = document.querySelector<HTMLCanvasElement>(`#${canvasId}`);
                        if (!canvas) {
                            return;
                        }
                        chart = new ChartJsChart(canvas, chartConfig);
                    }
                    else {
                        chart.update();
                    }
                }
                else {
                    chart?.stop();
                }
            }).observe(el);
        });

        document.addEventListener('metrics:update', (ev) => {
            if (!(ev instanceof CustomEvent) || !('snaps' in ev.detail)) {
                throw new Error($ts`received invalid metrics event`);
            }
            if (!chart) {
                return;
            }
            updateChart(chart, (ev as MetricsEvent).detail.snaps);
        });
    });

    return (
        <Card className={className}>
            <Heading className='!text-xl' tag='h2'>{title}</Heading>
            <canvas id={canvasId}></canvas>
        </Card>
    );
};