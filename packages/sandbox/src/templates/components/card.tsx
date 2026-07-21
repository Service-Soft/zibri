import { ComponentChildren } from 'preact';
import { PreactComponent } from 'zibri';

type Props = {
    className?: string,
    children: ComponentChildren
};

export const Card: PreactComponent<Props> = ({ className = '', children }) => {
    return <div className={`p-4 rounded bg-dark-gray text-white shadow-elevation ${className}`}>
        {children}
    </div>;
};