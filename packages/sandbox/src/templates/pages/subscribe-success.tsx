import { $ts, MailingListSubscribeSuccessPageTemplate, MaskUtilities } from 'zibri';

import { Card } from '../components/card';
import { EmptyPage } from '../components/empty-page';
import { Heading } from '../components/heading';

export const SubscribeSuccessPage: MailingListSubscribeSuccessPageTemplate = ({
    mailingList,
    subscriber,
    managePreferencesLink
}) => {
    const email: string = MaskUtilities.mask(subscriber.email);

    return (
        <EmptyPage title={$ts`Subscribed successfully`}>
            <Card className='text-center flex flex-col gap-6'>
                <img className="block mx-auto" src="/assets/logo.jpg" width="200px" height="200px"/>
                <p>{email}</p>
                <Heading className="my-2">
                    {$ts`You've successfully subscribed to`}
                    <br/>
                    {mailingList.name}
                </Heading>
                <p className="mb-4">
                    {$ts`We are happy to have you with us 🙂`}
                </p>
                <div>
                    <hr/>
                </div>
                <p>
                    {$ts`You can manage your preferences`} <a href={managePreferencesLink}>{$ts`here`}</a>
                </p>
            </Card>
        </EmptyPage>
    );
};