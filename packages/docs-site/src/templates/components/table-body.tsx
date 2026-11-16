import { MdxContentProps, TsxComponent } from 'zibri';

export const TableBody: TsxComponent<MdxContentProps> = ({ children }) => {
    return <tbody className="divide-y divide-dark-gray max-sm:block">{children}</tbody>;
};