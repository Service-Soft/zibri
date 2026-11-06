import { $ts, Input, MetricsSnapshot, TsxComponent, useContext, useInput } from 'zibri';

import { StatCard } from '../../../components/stat-card';
import { Snapshots } from '../snapshots';

type Props = {
    className?: string
};

export const CacheInFlightStatCard: TsxComponent<Props> = ({ className = '' }) => {
    const snapshots: Input<MetricsSnapshot[]> = useInput(useContext(Snapshots));

    function inFlight(): string {
        const latest: MetricsSnapshot | undefined = snapshots.value.at(-1);
        if (!latest) {
            return '...';
        }
        return String(latest.metrics
            .filter(m => m.name === 'cache_in_flight')
            .reduce((p, c) => p + c.value, 0));
    }

    return <StatCard id="cacheInFlightStat" title={$ts`Ongoing cache operations`} className={className}>{inFlight()}</StatCard>;
};
