import { TsxComponent, TsxChildren } from 'zibri';

type HeadingLevel = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

type Props = {
    tag?: HeadingLevel,
    // how large it looks, as large as its tag when not given
    size?: HeadingLevel,
    id?: string,
    children: TsxChildren,
    className?: string
};

const SIZE_CLASSES: Record<HeadingLevel, string> = {
    h1: 'text-4xl',
    h2: 'text-2xl',
    h3: 'text-xl',
    h4: 'text-lg font-semibold',
    h5: 'text-base font-semibold',
    h6: 'text-sm font-semibold'
};

export const Heading: TsxComponent<Props> = ({
    tag = 'h1',
    size = tag,
    id,
    children,
    className = ''
}) => {
    const TagName: typeof tag = tag;
    const sizeClasses: string = SIZE_CLASSES[size];
    return <TagName id={id} className={`text-white tracking-wider ${sizeClasses} ${className}`}>{children}</TagName>;
};