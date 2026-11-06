import { $ts, Input, MetricsSnapshot, TsxComponent, useContext, useInput } from 'zibri';

import { StatCard } from '../../../components/stat-card';
import { Snapshots } from '../snapshots';

type Props = { className?: string };

export const CacheHitRateStatCard: TsxComponent<Props> = ({ className = '' }) => {
    const snapshots: Input<MetricsSnapshot[]> = useInput(useContext(Snapshots));

    function hitRate(): string {
        const latest: MetricsSnapshot | undefined = snapshots.value.at(-1);
        const prev: MetricsSnapshot | undefined = snapshots.value.at(-2);
        if (!latest || !prev) {
            return '...';
        }

        const hitsNow: number = latest.metrics.filter(m => m.name === 'cache_hits_total').reduce((p, c) => p + c.value, 0);
        const hitsPrev: number = prev.metrics.filter(m => m.name === 'cache_hits_total').reduce((p, c) => p + c.value, 0);
        const missesNow: number = latest.metrics.filter(m => m.name === 'cache_misses_total').reduce((p, c) => p + c.value, 0);
        const missesPrev: number = prev.metrics.filter(m => m.name === 'cache_misses_total').reduce((p, c) => p + c.value, 0);

        const deltaHits: number = hitsNow - hitsPrev;
        const deltaMisses: number = missesNow - missesPrev;
        const total: number = deltaHits + deltaMisses;
        return total === 0 ? '0' : `${Math.round((deltaHits / total) * 100)}`;
    }

    return <StatCard id="cacheHitRateStat" title={$ts`Hit rate`} unit="%" className={className}>{hitRate()}</StatCard>;
};
