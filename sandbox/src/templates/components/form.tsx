import { ComponentChildren } from 'preact';
import { PreactComponent } from 'zibri';

type Props = {
    children: ComponentChildren,
    onSubmit: () => void,
    className?: string
};

export const Form: PreactComponent<Props> = ({ onSubmit, children, className = '' }: Props) => {
    return <form className={className} onSubmit={ev => {
        ev.preventDefault();
        onSubmit();
    } }>
        {children}
    </form>;
};