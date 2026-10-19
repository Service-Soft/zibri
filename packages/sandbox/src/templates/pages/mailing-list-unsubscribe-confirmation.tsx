import { $ts, MailingListUnsubscribeConfirmationPageTemplate, MaskUtilities } from 'zibri';

import { Button } from '../components/button';
import { Card } from '../components/card';
import { EmptyPage } from '../components/empty-page';
import { Heading } from '../components/heading';

export const MailingListUnsubscribeConfirmationPage: MailingListUnsubscribeConfirmationPageTemplate = ({
    subscriber,
    mailingList,
    unsubscribed,
    unsubscribeUrl,
    managePreferencesLink
}) => {
    const email: string = MaskUtilities.mask(subscriber.email);

    if (!unsubscribed) {
        return (
            <EmptyPage title={$ts`Unsubscribe`}>
                <Card className='text-center flex flex-col gap-6'>
                    <img className="block mx-auto" src="/assets/logo.jpg" width="200px" height="200px"/>
                    <p>{email}</p>
                    <Heading className="my-2">
                        {$ts`Unsubscribe from ${mailingList.name}?`}
                    </Heading>
                    <form method="post" action={unsubscribeUrl}>
                        <Button type="submit" className="mx-auto">{$ts`Unsubscribe`}</Button>
                    </form>
                    <div>
                        <hr/>
                    </div>
                    <p>
                        {$ts`Only want to change what you receive?`}
                        <br/>
                        <a href={managePreferencesLink}>{$ts`Manage your preferences`}</a>
                    </p>
                </Card>
            </EmptyPage>
        );
    }

    return (
        <EmptyPage title={$ts`Unsubscribed successfully`}>
            <Card className='text-center flex flex-col gap-6'>
                <img className="block mx-auto" src="/assets/logo.jpg" width="200px" height="200px"/>
                <p>{email}</p>
                <Heading className="my-2">
                    {$ts`You've unsubscribed from ${mailingList.name}`}
                </Heading>
                <p className="mb-4">
                    {$ts`We are sad to see you go 😕`}
                </p>
                <div>
                    <hr/>
                </div>
                <p>
                    {$ts`Unsubscribed by accident?`}
                    <br/>
                    <a href={managePreferencesLink}>{$ts`Manage your preferences`}</a>
                </p>
            </Card>
        </EmptyPage>
    );
};