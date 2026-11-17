import { Chart } from 'chart.js?client';
import { $ts, MetricsSnapshot, onClient, provideContext, State, TsxComponent, useEffect, useState } from 'zibri';

import { CacheDetailSection } from './cache/cache-details-section';
import { CacheHitRateStatCard } from './cache/cache-hit-rate-stat-card';
import { CacheInFlightStatCard } from './cache/cache-inflight-stat-card';
import { CacheOverviewChart } from './cache/cache-overview-chart';
import { CacheSizeStatCard } from './cache/cache-size-stat-card';
import { MetricsStatus } from './metrics-status';
import { NetworkChart } from './network-chart';
import { RateLimiterBlockRateStatCard } from './rate-limiter/rate-limiter-block-rate-stat-card';
import { RateLimiterDetailSection } from './rate-limiter/rate-limiter-detail-section';
import { RateLimiterOverviewChart } from './rate-limiter/rate-limiter-overview-chart';
import { RateLimiterReservationsStatCard } from './rate-limiter/rate-limiter-reservation-stat-card';
import { RateLimiterSizeStatCard } from './rate-limiter/rate-limiter-size-stat-card';
import { RequestDurationChart } from './request-duration-chart';
import { RequestsPerSecondChart } from './requests-per-second-chart';
import { ResourceUsageChart } from './resource-usage-chart';
import { Snapshots } from './snapshots';
import { BasePage } from '../../components/base-page';
import { Checkbox } from '../../components/checkbox';
import { Heading } from '../../components/heading';
import { StatCard } from '../../components/stat-card';
import { TabBar } from '../../components/tab-bar';
import { TabItem } from '../../components/tab-item';

type Props = {
    version: string,
    primary: string,
    secondary: string,
    cacheNames: string[],
    rateLimiterNames: string[]
};

export const MetricsPage: TsxComponent<Props> = ({ version, primary, secondary, cacheNames, rateLimiterNames }) => {
    const snaps: State<MetricsSnapshot[]> = useState<MetricsSnapshot[]>([]);
    const automaticReload: State<boolean> = useState(true);
    // the charts and cards of the page show them
    provideContext(Snapshots, snaps.value);

    onClient(() => {
        // Chart comes from a ?client import, so it only exists in the browser. A page's onClient runs
        // before those of the components inside it, which is where the charts are created.
        Chart.defaults.color = 'whitesmoke';
        Chart.defaults.borderColor = 'whitesmoke';
        Chart.defaults.scale.grid.color = 'rgba(200, 200, 200, 0.3)';
    });

    useEffect(() => {
        if (!automaticReload.value) {
            return;
        }
        void loadSnapshots();
        const timer: ReturnType<typeof setInterval> = setInterval(() => void loadSnapshots(), 1000);
        return () => clearInterval(timer);
    }, [automaticReload]);

    async function loadSnapshots(): Promise<void> {
        try {
            const resp: Response = await fetch('/metrics');
            // eslint-disable-next-line typescript/no-unsafe-assignment
            snaps.value = await resp.json();
        }
        catch (error) {
            // eslint-disable-next-line no-console
            console.error($ts`failed to load metrics`, error);
        }
    }

    return (
        <>
            <BasePage title={$ts`Metrics`}
                activeRoute='/metrics/dashboard'
                scripts={['/assets/lib/chartjs-adapter-date-fns.js']}
                className="flex flex-col gap-4 py-8"
            >
                <Heading className="text-center">{$ts`Metrics`}</Heading>
                <Checkbox
                    id='automatic-reload'
                    className='text-white'
                    label={$ts`Automatic reload`}
                    onChange={() => automaticReload.value = !automaticReload.value} checked={automaticReload.value}
                />
                <div className="w-full px-10 flex">
                    <TabBar className='w-full' tabs={[
                        { id: 'overview', label: $ts`Overview` },
                        { id: 'caches', label: $ts`Caches` },
                        { id: 'rate-limiters', label: $ts`Rate Limiters` }
                    ]}>
                        <TabItem id='overview'>
                            <div className="grid grid-cols-5 gap-5 mb-5">
                                <div className="col-span-2 flex flex-col gap-5">
                                    <MetricsStatus id='overview' version={version} className="flex-1">
                                    </MetricsStatus>
                                    <RequestDurationChart className="flex-1" secondary={secondary}></RequestDurationChart>
                                </div>
                                <RequestsPerSecondChart className="col-span-3" secondary={secondary}></RequestsPerSecondChart>
                            </div>
                            <div className="grid grid-cols-2 gap-5">
                                <ResourceUsageChart primary={primary} secondary={secondary}></ResourceUsageChart>
                                <NetworkChart primary={primary} secondary={secondary}></NetworkChart>
                            </div>
                        </TabItem>
                        <TabItem id='caches'>
                            <div className="grid grid-cols-5 gap-5 mb-5">
                                <div className="col-span-2 flex flex-col gap-5">
                                    <MetricsStatus id='caches' version={version} className="flex-1" />
                                    <div className='grid grid-cols-2 gap-5'>
                                        <StatCard id='cacheCountStat' title={$ts`Total caches`} unit={$ts`registered`}>
                                            {cacheNames.length}
                                        </StatCard>
                                        <CacheSizeStatCard />
                                        <CacheHitRateStatCard />
                                        <CacheInFlightStatCard />
                                    </div>
                                </div>
                                <CacheOverviewChart className='col-span-3' secondary={secondary} />
                            </div>
                            <CacheDetailSection cacheNames={cacheNames} primary={primary} secondary={secondary} />
                        </TabItem>
                        <TabItem id='rate-limiters'>
                            <div className="grid grid-cols-5 gap-5 mb-5">
                                <div className="col-span-2 flex flex-col gap-5">
                                    <MetricsStatus id='rate-limiter' version={version} className="flex-1" />
                                    <div className='grid grid-cols-2 gap-5'>
                                        <StatCard id='rateLimiterCountStat' title={$ts`Total rate limiters`} unit={$ts`registered`}>
                                            {rateLimiterNames.length}
                                        </StatCard>
                                        <RateLimiterSizeStatCard />
                                        <RateLimiterBlockRateStatCard />
                                        <RateLimiterReservationsStatCard />
                                    </div>
                                </div>
                                <RateLimiterOverviewChart className='col-span-3' secondary={secondary} />
                            </div>
                            <RateLimiterDetailSection rateLimiterNames={rateLimiterNames} primary={primary} secondary={secondary} />
                        </TabItem>
                    </TabBar>
                </div>
            </BasePage>
        </>
    );
};