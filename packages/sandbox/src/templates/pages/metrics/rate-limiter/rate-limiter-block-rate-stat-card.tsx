import { $ts, Input, MetricsSnapshot, TsxComponent, useContext, useInput } from 'zibri';

import { StatCard } from '../../../components/stat-card';
import { Snapshots } from '../snapshots';

type Props = { className?: string };

export const RateLimiterBlockRateStatCard: TsxComponent<Props> = ({ className = '' }) => {
    const snapshots: Input<MetricsSnapshot[]> = useInput(useContext(Snapshots));

    function blockRate(): string {
        const latest: MetricsSnapshot | undefined = snapshots.value.at(-1);
        const prev: MetricsSnapshot | undefined = snapshots.value.at(-2);
        if (!latest || !prev) {
            return '...';
        }

        const allowedNow: number = latest.metrics.filter(m => m.name === 'rate_limit_allowed_total').reduce((p, c) => p + c.value, 0);
        const allowedPrev: number = prev.metrics.filter(m => m.name === 'rate_limit_allowed_total').reduce((p, c) => p + c.value, 0);
        const blockedNow: number = latest.metrics.filter(m => m.name === 'rate_limit_blocked_total').reduce((p, c) => p + c.value, 0);
        const blockedPrev: number = prev.metrics.filter(m => m.name === 'rate_limit_blocked_total').reduce((p, c) => p + c.value, 0);

        const deltaAllowed: number = allowedNow - allowedPrev;
        const deltaBlocked: number = blockedNow - blockedPrev;
        const total: number = deltaAllowed + deltaBlocked;
        return total === 0 ? '0' : `${Math.round((deltaBlocked / total) * 100)}`;
    }

    return <StatCard id="rateLimiterBlockRateStat" title={$ts`Block rate`} unit="%" className={className}>{blockRate()}</StatCard>;
};
