import { Chart } from 'chart.js?client';
import { MetricsSnapshot, onClient, PreactComponent } from 'zibri';

import { BasePage } from '../components/base-page';
import { Heading } from '../components/heading';
import { MetricsStatus } from '../components/metrics-status';
import { NetworkChart } from '../components/network-chart';
import { RequestDurationChart } from '../components/request-duration-chart';
import { RequestsPerSecondChart } from '../components/requests-per-second-chart';
import { ResourceUsageChart } from '../components/resource-usage-chart';

export type MetricsEvent = CustomEvent<{
    snaps: MetricsSnapshot[]
}>;

type Props = {
    version: string,
    primary: string,
    secondary: string
};

export const MetricsPage: PreactComponent<Props> = ({ version, primary, secondary }) => {
    Chart.defaults.color = 'whitesmoke';
    Chart.defaults.borderColor = 'whitesmoke';
    Chart.defaults.scale.grid.color = 'rgba(200, 200, 200, 0.3)';

    let snaps: MetricsSnapshot[] = [];
    let automaticReload: boolean = true;

    onClient(() => {
        window.addEventListener('load', () => {
            void loadSnapshots();
            setInterval(() => void loadSnapshots(), 1000);
        });
    });

    async function loadSnapshots(): Promise<void> {
        if (!automaticReload) {
            return;
        }
        try {
            const resp: Response = await fetch('/metrics');
            // eslint-disable-next-line typescript/no-unsafe-assignment
            snaps = await resp.json();
            document.dispatchEvent(new CustomEvent('metrics:update', { detail: { snaps } }));
        }
        catch (error) {
            // eslint-disable-next-line no-console
            console.error('failed to load metrics', error);
        }
    }

    return (
        <>
            <BasePage title='Metrics'
                activeRoute='/metrics/dashboard'
                scripts={['/assets/lib/chartjs-adapter-date-fns.js']}
                className="flex flex-col gap-4 py-8"
            >
                <Heading className="text-center">Metrics</Heading>
                <div className="w-full px-10 flex flex-col gap-5">
                    <div className="grid grid-cols-5 gap-5">
                        <div className="col-span-2 flex flex-col gap-5">
                            <MetricsStatus
                                automaticReloadChecked={automaticReload}
                                onReloadChange={() => automaticReload = !automaticReload}
                                version={version}
                                className="flex-1"
                            >
                            </MetricsStatus>
                            <RequestDurationChart className="flex-1" secondary={secondary}></RequestDurationChart>
                        </div>
                        <RequestsPerSecondChart secondary={secondary} className="col-span-3"></RequestsPerSecondChart>
                    </div>
                    <div className="grid grid-cols-2 gap-5">
                        <ResourceUsageChart primary={primary} secondary={secondary}></ResourceUsageChart>
                        <NetworkChart primary={primary} secondary={secondary}></NetworkChart>
                    </div>
                </div>
            </BasePage>
        </>
    );
};