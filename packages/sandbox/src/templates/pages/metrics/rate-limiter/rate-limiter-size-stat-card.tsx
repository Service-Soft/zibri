import { $ts, MetricsSnapshot, onClient, PreactComponent } from 'zibri';

import { StatCard } from '../../../components/stat-card';
import { MetricsEvent } from '../metrics';

type Props = { className?: string };

export const RateLimiterSizeStatCard: PreactComponent<Props> = ({ className = '' }) => {
    onClient(() => {
        document.addEventListener('metrics:update', (ev) => {
            if (!(ev instanceof CustomEvent) || !('snaps' in ev.detail)) {
                throw new Error($ts`received invalid metrics event`);
            }
            update((ev as MetricsEvent).detail.snaps);
        });
    });

    function update(snaps: MetricsSnapshot[]): void {
        if (!snaps.length) {
            return;
        }
        const latest: MetricsSnapshot = snaps[snaps.length - 1];
        const activeKeys: number = latest.metrics
            .filter(m => m.name === 'rate_limit_active_keys')
            .reduce((p, c) => p + c.value, 0);
        const el: HTMLElement | null = document.getElementById('rateLimiterSizeStat');
        if (el) {
            el.textContent = String(activeKeys);
        }
    }

    return <StatCard id="rateLimiterSizeStat" title={$ts`Tracked identities`} unit={$ts`keys`} className={className} />;
};