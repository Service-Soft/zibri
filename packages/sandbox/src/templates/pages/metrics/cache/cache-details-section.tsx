import { PreactComponent } from 'zibri';

import { CacheDetail } from './cache-detail';

type Props = {
    cacheNames: string[],
    primary: string,
    secondary: string,
    className?: string
};

export const CacheDetailSection: PreactComponent<Props> = ({ cacheNames, primary, secondary, className = '' }) => {
    return (
        <div className={`flex flex-col gap-8 ${className}`}>
            {cacheNames.map(n => <CacheDetail name={n} primary={primary} secondary={secondary} />)}
        </div>
    );
};