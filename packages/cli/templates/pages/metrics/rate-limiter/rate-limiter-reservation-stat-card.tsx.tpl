import { $ts, Input, MetricsSnapshot, TsxComponent, useContext, useInput } from 'zibri';

import { StatCard } from '../../../components/stat-card';
import { Snapshots } from '../snapshots';

type Props = {
    className?: string
};

export const RateLimiterReservationsStatCard: TsxComponent<Props> = ({ className = '' }) => {
    const snapshots: Input<MetricsSnapshot[]> = useInput(useContext(Snapshots));

    function activeReservations(): string {
        const latest: MetricsSnapshot | undefined = snapshots.value.at(-1);
        if (!latest) {
            return '...';
        }
        return String(latest.metrics
            .filter(m => m.name === 'rate_limit_active_reservations')
            .reduce((p, c) => p + c.value, 0));
    }

    return <StatCard id="rateLimiterReservationsStat" title={$ts`Active reservations`} className={className}>{activeReservations()}</StatCard>;
};
