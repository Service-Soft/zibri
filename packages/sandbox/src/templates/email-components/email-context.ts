import { Context, createContext } from 'preact';
import { useContext } from 'preact/hooks';

export type EmailContextValue = {
    width: string,
    dir: 'rtl' | 'ltr',
    textAlign: 'left' | 'center' | 'right' | 'justify',
    color: string,
    fontFamily: string,
    lineHeight: number
};

export const EmailContext: Context<EmailContextValue> = createContext<EmailContextValue>({
    width: '600px',
    dir: 'ltr',
    textAlign: 'center',
    color: '#000000',
    fontFamily: 'Ubuntu, Helvetica, Arial, sans-serif',
    lineHeight: 1
});

export function useEmailContext(): EmailContextValue {
    return useContext(EmailContext);
}