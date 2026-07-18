import { PreactComponent } from 'zibri';

import { RateLimiterDetail } from './rate-limiter-detail';

type Props = {
    rateLimiterNames: string[],
    primary: string,
    secondary: string,
    className?: string
};

export const RateLimiterDetailSection: PreactComponent<Props> = ({ rateLimiterNames, primary, secondary, className = '' }) => {
    return (
        <div className={`flex flex-col gap-8 ${className}`}>
            {rateLimiterNames.map(name => <RateLimiterDetail name={name} primary={primary} secondary={secondary} />)}
        </div>
    );
};