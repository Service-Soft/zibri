import { $f, $ts, Input, Metric, MetricsSnapshot, TsxComponent, useContext, useInput } from 'zibri';

import { Snapshots } from './snapshots';
import { Card } from '../../components/card';
import { Heading } from '../../components/heading';

type Props = {
    version: string,
    id: string,
    className?: string
};

export const MetricsStatus: TsxComponent<Props> = ({
    className = '',
    version = '-',
    id
}) => {
    const uptimeInfoId: string = `uptimeInfo-${id}`;
    const uptimeInfoSinceId: string = `uptimeInfoSince-${id}`;
    const snapshots: Input<MetricsSnapshot[]> = useInput(useContext(Snapshots));

    function findStart(): number | undefined {
        const latest: MetricsSnapshot | undefined = snapshots.value.at(-1);
        const startTimeMetric: Metric | undefined = latest?.metrics.find(m => m.name === 'process_start_time_seconds');
        return startTimeMetric === undefined ? undefined : startTimeMetric.value * 1000;
    }

    function uptime(): string {
        const start: number | undefined = findStart();
        if (start === undefined) {
            return '...';
        }
        const diffMs: number = Date.now() - start;
        const { days, hours, minutes, seconds } = {
            days: Math.floor(diffMs / 86400000),
            hours: Math.floor((diffMs % 86400000) / 3600000),
            minutes: Math.floor((diffMs % 3600000) / 60000),
            seconds: Math.floor((diffMs % 60000) / 1000)
        };
        return $ts`${days}d ${hours}h ${minutes}m ${seconds}s`;
    }

    function since(): string {
        const start: number | undefined = findStart();
        return start === undefined ? '...' : $f.dateTime(new Date(start));
    }

    return (
        <>
            <Card className={className}>
                <Heading className='text-xl!' tag="h2">{$ts`Status`}</Heading>

                <div className="w-fit mx-auto">
                    <div className="flex justify-between gap-10">
                        <div>{$ts`Version`}:</div>
                        <div>{version}</div>
                    </div>
                    <div className="flex justify-between gap-10">
                        <div>{$ts`Uptime`}:</div>
                        <div id={uptimeInfoId}>{uptime()}</div>
                    </div>
                    <div className="flex justify-between gap-10">
                        <div>{$ts`Since`}:</div>
                        <div id={uptimeInfoSinceId}>{since()}</div>
                    </div>
                </div>
            </Card>
        </>
    );
};