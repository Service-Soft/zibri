import { $ts, TsxComponent } from 'zibri';

import { BasePage } from '../components/base-page';
import { Card } from '../components/card';
import { Heading } from '../components/heading';
import { Link } from '../components/link';

type Props = {
    appName: string
};

export const HomePage: TsxComponent<Props> = ({ appName }) => {
    return (
        <BasePage title='' activeRoute='/' className="flex flex-col gap-4 py-8">
            <Heading className="text-center">{appName}</Heading>
            <div className="max-w-fit mx-auto grid grid-cols-2 gap-4">
                <Card className="flex flex-col gap-2 max-w-80">
                    <Link href="/explorer" icon="/assets/explorer.svg">
                        {$ts`API Explorer`}
                    </Link>
                    <p>
                        {$ts`The OpenAPI and AsyncAPI documentation of every version, to try each route out.`}
                    </p>
                </Card>
                <Card className="flex flex-col gap-2 max-w-80">
                    <Link href="/assets" icon="/assets/assets.svg">
                        {$ts`Assets`}
                    </Link>
                    <p>
                        {$ts`Lists all publicly registered assets.`}
                    </p>
                </Card>
                <Card className="flex flex-col gap-2 max-w-80">
                    <Link href="/docs" id="home-docs" icon="/assets/docs.svg">
                        {$ts`Docs`}
                    </Link>
                    <p>
                        {$ts`The documentation, written in markdown, with a search.`}
                    </p>
                </Card>
                {/* <Card className="flex flex-col gap-2 max-w-80">
                    <Link href="/metrics/dashboard" icon="/assets/metrics.svg">
                        {$ts`Metrics`}
                    </Link>
                    <p>
                        {$ts`A basic metrics dashboard.`}
                    </p>
                </Card> */}
            </div>
        </BasePage>
    );
};