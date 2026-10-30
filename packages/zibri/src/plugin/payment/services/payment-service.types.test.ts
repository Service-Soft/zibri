import { describe, expect, it } from '@jest/globals';

import { PaymentServiceInterface } from './payment-service.interface';
import { AllowedCancellationMethods, AllowedRefundMethods, AllowedReservationMethods, PaymentDataForMethod, PaymentForMethod, ValidatedPaymentDataForMethod } from './payment-service.types';
import { NumberUtilities } from '../../../utilities/number.utilities';
import { KnownPaymentMethod } from '../models/payment-method.model';
import { PaymentPluginOptionsInput } from '../models/payment-plugin-options-input.model';
import { PayPalPaymentProvider } from '../providers/pay-pal/pay-pal.payment-provider';
import { PaymentProviderInterface } from '../providers/payment-provider.interface';

/**
 * What a card payment of the test's card provider is made with.
 */
type CardPaymentData = {
    /**
     * The token the card was tokenized to in the browser.
     */
    cardToken: string,
    /**
     * Used to prevent duplicate payments.
     */
    transactionId: string
};

/**
 * What the test's card provider keeps on a payment.
 */
type CardProviderData = {
    /**
     * The id of the charge.
     */
    chargeId?: string
};

/**
 * A provider of the application's own taking card payments, which can cancel a payment and neither
 * refund nor reserve one.
 */
type CardPaymentProvider = PaymentProviderInterface<
    [KnownPaymentMethod.CREDIT_CARD],
    { CREDIT_CARD: CardPaymentData },
    { CREDIT_CARD: CardPaymentData },
    { CREDIT_CARD: CardProviderData },
    { CREDIT_CARD: CardProviderData },
    { CREDIT_CARD: true },
    { CREDIT_CARD: false },
    { CREDIT_CARD: false }
> & { readonly name: 'card' };

/**
 * PayPal for PayPal payments, and a provider of the application's own for card payments.
 */
type Methods = [KnownPaymentMethod.PAY_PAL, KnownPaymentMethod.CREDIT_CARD];

/**
 * The providers of the methods.
 */
type Providers = [PayPalPaymentProvider, CardPaymentProvider];

// 06 §Q6: what keeps the payment plugin worth its generics is that each method is typed by the
// provider that takes it, so a payment through one vendor cannot be made with another's data
describe('the types of a payment, by the provider of its method', () => {
    it('take the options of several providers, each for its own methods', () => {
        const options: PaymentPluginOptionsInput<Methods, Providers> | undefined = undefined;
        // @ts-expect-error -- no provider takes SEPA transfers
        const uncovered: PaymentServiceInterface<[...Methods, KnownPaymentMethod.SEPA_BANK_TRANSFER], Providers> | undefined = undefined;

        expect([options, uncovered]).toEqual([undefined, undefined]);
    });

    it('take the data of each method in the shape its provider asks for', () => {
        const payPal: PaymentDataForMethod<Methods, KnownPaymentMethod.PAY_PAL, Providers> = {
            transactionId: 'a',
            amount: NumberUtilities.new(10),
            currencyCode: 'EUR'
        };
        const card: PaymentDataForMethod<Methods, KnownPaymentMethod.CREDIT_CARD, Providers> = { transactionId: 'b', cardToken: 'tok_1' };
        // @ts-expect-error -- a PayPal payment is not made with a card token
        const payPalWithCard: PaymentDataForMethod<Methods, KnownPaymentMethod.PAY_PAL, Providers> = { transactionId: 'c', cardToken: 'tok_2' };
        // @ts-expect-error -- a card payment is not made with what PayPal asks for
        const cardWithPayPal: PaymentDataForMethod<Methods, KnownPaymentMethod.CREDIT_CARD, Providers> = { transactionId: 'd', currencyCode: 'EUR' };
        const validatedCard: ValidatedPaymentDataForMethod<Methods, KnownPaymentMethod.CREDIT_CARD, Providers> = card;

        expect([payPal, card, payPalWithCard, cardWithPayPal, validatedCard]).toHaveLength(5);
    });

    it('hand back the payment of each method with what its provider keeps on it', () => {
        const payPal: PaymentForMethod<Methods, KnownPaymentMethod.PAY_PAL, Providers>['data'] = { orderId: 'o_1' };
        const card: PaymentForMethod<Methods, KnownPaymentMethod.CREDIT_CARD, Providers>['data'] = { chargeId: 'ch_1' };
        // @ts-expect-error -- PayPal keeps no charge
        const payPalWithCharge: PaymentForMethod<Methods, KnownPaymentMethod.PAY_PAL, Providers>['data'] = { chargeId: 'ch_2' };
        // @ts-expect-error -- the card provider keeps no order
        const cardWithOrder: PaymentForMethod<Methods, KnownPaymentMethod.CREDIT_CARD, Providers>['data'] = { orderId: 'o_2' };

        expect([payPal, card, payPalWithCharge, cardWithOrder]).toHaveLength(4);
    });

    it('allow a refund, a reservation and a cancellation only for a method whose provider can', () => {
        const refundable: AllowedRefundMethods<Methods, Providers> = KnownPaymentMethod.PAY_PAL;
        // @ts-expect-error -- the card provider cannot refund
        const notRefundable: AllowedRefundMethods<Methods, Providers> = KnownPaymentMethod.CREDIT_CARD;
        const reservable: AllowedReservationMethods<Methods, Providers> = KnownPaymentMethod.PAY_PAL;
        // @ts-expect-error -- the card provider cannot reserve
        const notReservable: AllowedReservationMethods<Methods, Providers> = KnownPaymentMethod.CREDIT_CARD;
        const cancellable: AllowedCancellationMethods<Methods, Providers>[] = [KnownPaymentMethod.PAY_PAL, KnownPaymentMethod.CREDIT_CARD];

        expect([refundable, notRefundable, reservable, notReservable, ...cancellable]).toHaveLength(6);
    });
});