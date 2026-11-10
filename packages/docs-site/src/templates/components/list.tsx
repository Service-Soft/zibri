import { MdxListProps, TsxComponent } from 'zibri';

export const List: TsxComponent<MdxListProps> = ({ ordered, start, children }) => {
    return ordered
        ? <ol start={start} className="my-4 pl-6 list-decimal marker:text-secondary text-white">{children}</ol>
        : <ul className="my-4 pl-6 list-disc marker:text-secondary text-white">{children}</ul>;
};