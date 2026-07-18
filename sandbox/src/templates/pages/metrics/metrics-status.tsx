import { $f, $ts, Metric, MetricsSnapshot, onClient, PreactComponent } from 'zibri';

import { MetricsEvent } from './metrics';
import { Card } from '../../components/card';
import { Heading } from '../../components/heading';

type Props = {
    version: string,
    id: string,
    className?: string
};

export const MetricsStatus: PreactComponent<Props> = ({
    className = '',
    version = '-',
    id
}) => {
    const uptimeInfoId: string = `uptimeInfo-${id}`;
    const uptimeInfoSinceId: string = `uptimeInfoSince-${id}`;

    onClient(() => {
        document.addEventListener('metrics:update', (ev) => {
            if (!(ev instanceof CustomEvent) || !('snaps' in ev.detail)) {
                throw new Error($ts`received invalid metrics event`);
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

        const text: string = $ts`${days}d ${hours}h ${minutes}m ${seconds}s`;
        const sinceText: string = $f.dateTime(new Date(start));

        const uptimeInfo: HTMLElement | null = document.getElementById(uptimeInfoId);
        if (uptimeInfo) {
            uptimeInfo.textContent = text;
        }
        const uptimeInfoSince: HTMLElement | null = document.getElementById(uptimeInfoSinceId);
        if (uptimeInfoSince) {
            uptimeInfoSince.textContent = sinceText;
        }
    }

    return (
        <>
            <Card className={className}>
                <Heading className='!text-xl' tag="h2">{$ts`Status`}</Heading>

                <div className="w-fit mx-auto">
                    <div className="flex justify-between gap-10">
                        <div>{$ts`Version`}:</div>
                        <div>{version}</div>
                    </div>
                    <div className="flex justify-between gap-10">
                        <div>{$ts`Uptime`}:</div>
                        <div id={uptimeInfoId}>...</div>
                    </div>
                    <div className="flex justify-between gap-10">
                        <div>{$ts`Since`}:</div>
                        <div id={uptimeInfoSinceId}>...</div>
                    </div>
                </div>
            </Card>
        </>
    );
};