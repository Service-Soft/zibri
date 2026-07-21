import { $ts, MetricsSnapshot, onClient, PreactComponent } from 'zibri';

import { StatCard } from '../../../components/stat-card';
import { MetricsEvent } from '../metrics';

type Props = { className?: string };

export const RateLimiterBlockRateStatCard: PreactComponent<Props> = ({ className = '' }) => {
    onClient(() => {
        document.addEventListener('metrics:update', (ev) => {
            if (!(ev instanceof CustomEvent) || !('snaps' in ev.detail)) {
                throw new Error($ts`received invalid metrics event`);
            }
            update((ev as MetricsEvent).detail.snaps);
        });
    });

    function update(snaps: MetricsSnapshot[]): void {
        if (snaps.length < 2) {
            return;
        }
        const latest: MetricsSnapshot = snaps[snaps.length - 1];
        const prev: MetricsSnapshot = snaps[snaps.length - 2];

        const allowedNow: number = latest.metrics.filter(m => m.name === 'rate_limit_allowed_total').reduce((p, c) => p + c.value, 0);
        const allowedPrev: number = prev.metrics.filter(m => m.name === 'rate_limit_allowed_total').reduce((p, c) => p + c.value, 0);
        const blockedNow: number = latest.metrics.filter(m => m.name === 'rate_limit_blocked_total').reduce((p, c) => p + c.value, 0);
        const blockedPrev: number = prev.metrics.filter(m => m.name === 'rate_limit_blocked_total').reduce((p, c) => p + c.value, 0);

        const deltaAllowed: number = allowedNow - allowedPrev;
        const deltaBlocked: number = blockedNow - blockedPrev;
        const total: number = deltaAllowed + deltaBlocked;

        const el: HTMLElement | null = document.getElementById('rateLimiterBlockRateStat');
        if (el) {
            el.textContent = total === 0 ? '0' : `${Math.round((deltaBlocked / total) * 100)}`;
        }
    }

    return <StatCard id="rateLimiterBlockRateStat" title={$ts`Block rate`} unit="%" className={className} />;
};