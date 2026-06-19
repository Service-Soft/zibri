import { $ts, MetricsSnapshot, onClient, PreactComponent } from 'zibri';

import { StatCard } from './stat-card';
import { MetricsEvent } from '../pages/metrics';

type Props = {
    className?: string
};

export const CacheInFlightStatCard: PreactComponent<Props> = ({ className = '' }) => {
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
        const inFlight: number = latest.metrics
            .filter(m => m.name === 'cache_in_flight')
            .reduce((p, c) => p + c.value, 0);

        const el: HTMLElement | null = document.getElementById('cacheInFlightStat');
        if (el) {
            el.textContent = String(inFlight);
        }
    }

    return <StatCard id="cacheInFlightStat" title={$ts`Ongoing cache operations`} className={className} />;
};