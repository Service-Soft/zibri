import { Metric, MetricsSnapshot, onClient, PreactComponent } from 'zibri';

import { Card } from './card';
import { Checkbox } from './checkbox';
import { Heading } from './heading';
import { MetricsEvent } from '../pages/metrics';

type Props = {
    onReloadChange: () => void,
    version: string,
    automaticReloadChecked: boolean,
    className?: string
};

export const MetricsStatus: PreactComponent<Props> = ({
    className = '',
    version = '-',
    onReloadChange,
    automaticReloadChecked
}) => {

    onClient(() => {
        document.addEventListener('metrics:update', (ev) => {
            if (!(ev instanceof CustomEvent) || !('snaps' in ev.detail)) {
                throw new Error('received invalid metrics event');
            }
            const { snaps } = (ev as MetricsEvent).detail;
            renderUptime(snaps);
        });
    });

    function renderUptime(snaps: MetricsSnapshot[]): void {
        if (!snaps.length) {
            return;
        }

        const latest: MetricsSnapshot = snaps[snaps.length - 1];
        const startTimeMetric: Metric | undefined = latest.metrics.find(m => m.name === 'process_start_time_seconds');
        if (!startTimeMetric) {
            return;
        }

        const start: number = startTimeMetric.value * 1000;
        const diffMs: number = Date.now() - start;
        const { days, hours, minutes, seconds } = {
            days: Math.floor(diffMs / 86400000),
            hours: Math.floor((diffMs % 86400000) / 3600000),
            minutes: Math.floor((diffMs % 3600000) / 60000),
            seconds: Math.floor((diffMs % 60000) / 1000)
        };

        const text: string = `${days}d ${hours}h ${minutes}m ${seconds}s`;
        const sinceText: string = new Date(start).toLocaleDateString(
            'de',
            { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }
        );

        const uptimeInfo: HTMLElement | null = document.getElementById('uptimeInfo');
        if (uptimeInfo) {
            uptimeInfo.textContent = text;
        }
        const uptimeInfoSince: HTMLElement | null = document.getElementById('uptimeInfoSince');
        if (uptimeInfoSince) {
            uptimeInfoSince.textContent = sinceText;
        }
    }

    return (
        <>
            <Card className={className}>
                <Heading className='!text-xl' tag="h2">Status</Heading>

                <Checkbox label="Automatic reload" onChange={() => onReloadChange()} checked={automaticReloadChecked}></Checkbox>

                <div className="w-fit mx-auto">
                    <div className="flex justify-between gap-10">
                        <div>Version:</div>
                        <div>{version}</div>
                    </div>
                    <div className="flex justify-between gap-10">
                        <div>Uptime:</div>
                        <div id="uptimeInfo">...</div>
                    </div>
                    <div className="flex justify-between gap-10">
                        <div>Since:</div>
                        <div id="uptimeInfoSince">...</div>
                    </div>
                </div>
            </Card>
        </>
    );
};