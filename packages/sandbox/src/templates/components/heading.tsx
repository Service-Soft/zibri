import { ComponentChildren } from 'preact';
import { PreactComponent } from 'zibri';

type Props = {
    tag?: 'h1' | 'h2' | 'h3',
    id?: string,
    children: ComponentChildren,
    className?: string
};

export const Heading: PreactComponent<Props> = ({
    tag = 'h1',
    id,
    children,
    className = ''
}) => {
    const TagName: typeof tag = tag;
    return <TagName id={id} className={`text-white text-4xl tracking-wider ${className}`}>{children}</TagName>;
};