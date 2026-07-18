import { $ts, MetricsSnapshot, onClient, PreactComponent } from 'zibri';

import { StatCard } from '../../../components/stat-card';
import { MetricsEvent } from '../metrics';

type Props = { className?: string };

export const CacheSizeStatCard: PreactComponent<Props> = ({ className = '' }) => {
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
        const size: number = latest.metrics
            .filter(m => m.name === 'cache_size')
            .reduce((p, c) => p + c.value, 0);
        const el: HTMLElement | null = document.getElementById('cacheSizeStat');
        if (el) {
            el.textContent = String(size);
        }
    }

    return <StatCard id="cacheSizeStat" title={$ts`Total cached entries`} unit="entries" className={className} />;
};