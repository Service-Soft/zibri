import { PreactComponent } from 'zibri';

import { Card } from './card';
import { Heading } from './heading';

type Props = {
    title: string,
    canvasId: string,
    className?: string
};

export const Chart: PreactComponent<Props> = ({ className = '', title, canvasId }) => {
    return (
        <Card className={className}>
            <Heading className='!text-xl' tag='h2'>{title}</Heading>
            <canvas id={canvasId}></canvas>
        </Card>
    );
};