import { ChartConfiguration, Chart as ChartJsChart } from 'chart.js?client';
import { Input, MetricsSnapshot, onClient, Ref, TsxComponent, useContext, useEffect, useInput, useRef } from 'zibri';

import { Card } from './card';
import { Heading } from './heading';
import { Snapshots } from '../pages/metrics/snapshots';

type Props = {
    title: string,
    canvasId: string,
    chartConfig: ChartConfiguration,
    // eslint-disable-next-line typescript/no-explicit-any
    updateChart: (chart: ChartJsChart<any, any>, snaps: MetricsSnapshot[]) => void,
    className?: string
};

export const Chart: TsxComponent<Props> = ({ className = '', title, canvasId, chartConfig, updateChart }) => {
    const canvas: Ref<HTMLCanvasElement> = useRef<HTMLCanvasElement>();
    const snapshots: Input<MetricsSnapshot[]> = useInput(useContext(Snapshots));
    let chart: ChartJsChart | undefined;

    onClient(() => {
        // the date adapter of the charts is a deferred script, which runs before this event
        document.addEventListener('DOMContentLoaded', () => {
            new IntersectionObserver(([entry]) => {
                if (entry.isIntersecting) {
                    if (!chart) {
                        chart = new ChartJsChart(canvas.current, chartConfig);
                    }
                    else {
                        chart.update();
                    }
                }
                else {
                    chart?.stop();
                }
            }).observe(canvas.current);
        });
    });

    useEffect(() => {
        if (chart) {
            updateChart(chart, [...snapshots.value]);
        }
    }, [snapshots]);

    return (
        <Card className={className}>
            <Heading className='text-xl!' tag='h2'>{title}</Heading>
            <canvas id={canvasId} ref={canvas}></canvas>
        </Card>
    );
};