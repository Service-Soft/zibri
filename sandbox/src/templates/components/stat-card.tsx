import { ComponentChildren } from 'preact';
import { PreactComponent } from 'zibri';

import { Card } from './card';
import { Heading } from './heading';

type Props = {
    title: string,
    id: string,
    unit?: string,
    className?: string,
    children?: ComponentChildren
};

export const StatCard: PreactComponent<Props> = ({ title, id, unit = '', className = '', children = '...' }) => {
    return (
        <Card className={`flex flex-col gap-2 ${className}`}>
            <Heading className='!text-xl' tag='h2'>{title}</Heading>
            <div class="flex items-end gap-1 mt-auto">
                <span id={id} class="text-4xl font-bold text-white">{children}</span>
                {unit && <span class="text-sm text-gray-400 mb-1">{unit}</span>}
            </div>
        </Card>
    );
};