import { $ts, MetricsSnapshot, onClient, PreactComponent } from 'zibri';

import { StatCard } from '../../../components/stat-card';
import { MetricsEvent } from '../metrics';

type Props = { className?: string };

export const CacheHitRateStatCard: PreactComponent<Props> = ({ className = '' }) => {
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

        const hitsNow: number = latest.metrics.filter(m => m.name === 'cache_hits_total').reduce((p, c) => p + c.value, 0);
        const hitsPrev: number = prev.metrics.filter(m => m.name === 'cache_hits_total').reduce((p, c) => p + c.value, 0);
        const missesNow: number = latest.metrics.filter(m => m.name === 'cache_misses_total').reduce((p, c) => p + c.value, 0);
        const missesPrev: number = prev.metrics.filter(m => m.name === 'cache_misses_total').reduce((p, c) => p + c.value, 0);

        const deltaHits: number = hitsNow - hitsPrev;
        const deltaMisses: number = missesNow - missesPrev;
        const total: number = deltaHits + deltaMisses;

        const el: HTMLElement | null = document.getElementById('cacheHitRateStat');
        if (el) {
            el.textContent = total === 0 ? '0' : `${Math.round((deltaHits / total) * 100)}`;
        }
    }

    return <StatCard id="cacheHitRateStat" title={$ts`Hit rate`} unit="%" className={className} />;
};