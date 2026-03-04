import { ErrorPageTemplate, GlobalRegistry, onServer } from 'zibri';

import { Card } from '../components/card';
import { EmptyPage } from '../components/empty-page';
import { Heading } from '../components/heading';
import { Link } from '../components/link';

export const ErrorPage: ErrorPageTemplate = ({ error }) => {
    let name: string = '';

    onServer(() => {
        name = GlobalRegistry.getAppData('name') ?? '';
    });

    return <EmptyPage title={error.title} className='flex items-center justify-center'>
        <div className="flex gap-8">
            <Card className='!py-0 max-w-64'>
                <Link href="/">
                    <img src="/assets/logo.jpg" width="256px" height="256px" />
                </Link>
                <Link href="/">
                    <Heading tag="h2" className='text-center !text-2xl'>{name}</Heading>
                </Link>
            </Card>
            <div className='flex flex-col gap-4 w-[500px]'>
                <Card>
                    <Heading>{error.status}: {error.title}</Heading>
                </Card>
                <Card className='flex-1'>
                    <div className='flex flex-col gap-2'>
                        {error.paragraphs.map(p => <p>{p}</p>)}
                    </div>
                </Card>
                <Card>
                    <Link icon='/assets/open-api/swagger.png' href="/explorer">
                        OpenAPI Explorer
                    </Link>
                </Card>
            </div>
        </div>
    </EmptyPage>;
};