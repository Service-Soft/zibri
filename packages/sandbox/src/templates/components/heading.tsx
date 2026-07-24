import { TsxComponent, TsxChildren } from 'zibri';

type Props = {
    tag?: 'h1' | 'h2' | 'h3',
    id?: string,
    children: TsxChildren,
    className?: string
};

export const Heading: TsxComponent<Props> = ({
    tag = 'h1',
    id,
    children,
    className = ''
}) => {
    const TagName: typeof tag = tag;
    return <TagName id={id} className={`text-white text-4xl tracking-wider ${className}`}>{children}</TagName>;
};