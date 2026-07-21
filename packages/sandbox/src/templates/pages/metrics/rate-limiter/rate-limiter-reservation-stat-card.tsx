import { $ts, MetricsSnapshot, onClient, PreactComponent } from 'zibri';

import { StatCard } from '../../../components/stat-card';
import { MetricsEvent } from '../metrics';

type Props = {
    className?: string
};

export const RateLimiterReservationsStatCard: PreactComponent<Props> = ({ className = '' }) => {
    onClient(() => {
        document.addEventListener('metrics:update', (ev) => {
            if (!(ev instanceof CustomEvent) || !('snaps' in ev.detail)) {
                throw new Error($ts`received invalid metrics event`);
            }
            const { snaps } = (ev as MetricsEvent).detail;
            update(snaps);
        });
    });

    function update(snaps: MetricsSnapshot[]): void {
        if (!snaps.length) {
            return;
        }
        const latest: MetricsSnapshot = snaps[snaps.length - 1];
        const activeReservations: number = latest.metrics
            .filter(m => m.name === 'rate_limit_active_reservations')
            .reduce((p, c) => p + c.value, 0);
        const el: HTMLElement | null = document.getElementById('rateLimiterReservationsStat');
        if (el) {
            el.textContent = String(activeReservations);
        }
    }

    return <StatCard id="rateLimiterReservationsStat" title={$ts`Active reservations`} className={className} />;
};