import { ComponentChildren } from 'preact';
import { PreactComponent } from 'zibri';

type Props = {
    id: string,
    children: ComponentChildren,
    className?: string
};

export const TabItem: PreactComponent<Props> = ({ id, className = '', children }) => {
    return (
        <div id={id} className={className}>
            {children}
        </div>
    );
};