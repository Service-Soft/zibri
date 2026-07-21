import { ComponentChildren } from 'preact';
import { PreactComponent } from 'zibri';

type Props = {
    id?: string,
    className?: string,
    children: ComponentChildren
};

export const Dialog: PreactComponent<Props> = ({ children, id, className = '' }) => {
    return <dialog id={id} className={`rounded-2xl border-none ${className}`}>
        {children}
    </dialog>;
};