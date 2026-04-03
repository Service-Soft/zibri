import { PayPalPaymentProviderOptions } from './pay-pal.payment-provider';
import { ZIBRI_DI_TOKENS } from '../../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../../di/inject.function';
import { Property } from '../../../../entity/decorators/property.decorator';
import { KnownHeader } from '../../../../http/known-header.enum';
import { MimeType } from '../../../../http/mime-type.enum';
import { HttpClientInterface } from '../../../../http-client/http-client.interface';

/**
 * The intent of the new payment.
 *
 * Can either be 'CAPTURE' (pay now, eg. Online shop) or 'AUTHORIZE' (reserve funds, eg. For hotel booking).
 */
type PayPalPaymentIntent = 'CAPTURE' | 'AUTHORIZE';

/**
 * The access token received from the pay-pal api.
 */
type PayPalAccessToken = {
    /**
     * The actual token value.
     */
    accessToken: string,
    /**
     * The timestamp in ms at which the token expires.
     */
    expiresAt: number
};

/**
 * Response for authenticating with pay-pal.
 */
class AuthResp {
    /**
     * The actual access token value.
     */
    @Property.string()
    access_token!: string;
    /**
     * In how much seconds the access token becomes invalid.
     */
    @Property.number()
    expires_in!: number;
}

/**
 * A payment amount, consisting of the value and the currency.
 */
class PaymentAmount {
    /**
     * The value of the payment.
     */
    @Property.string()
    value!: string;
    /**
     * The currency of the payment.
     */
    @Property.string()
    currency_code!: string;
}

/**
 * A PayPal link.
 */
class PayPalLink {
    /**
     * The html href => the actual link.
     */
    @Property.string()
    href!: string;
    /**
     * The html rel.
     */
    @Property.string()
    rel!: string;
    /**
     * The method of the link.
     */
    @Property.string({ required: false })
    method?: string;
}

/**
 * Response for creating a order.
 */
class CreateOrderResp {
    /**
     * The id of the order.
     */
    @Property.string()
    id!: string;
    /**
     * The status of the order.
     */
    @Property.string({ required: false })
    status?: string;
    /**
     * The links of the order.
     */
    @Property.array({ required: false, items: { type: 'object', cls: () => PayPalLink } })
    links?: PayPalLink[];
}

/**
 * The body for creating a new order.
 */
type CreateOrderBody = {
    /**
     * The intent of the order to create.
     */
    intent: PayPalPaymentIntent,
    /**
     * The purchase units describe the amount to be paid.
     */
    purchase_units: {
        /**
         * The payment amount.
         */
        amount: PaymentAmount
    }[],
    /**
     * Additional context of the application.
     */
    application_context?: {
        /**
         * The url to return to after the payment has been confirmed.
         */
        return_url?: string,
        /**
         * The url to return to after the payment has been cancelled.
         */
        cancel_url?: string
    }
};

/**
 * Represents a capture returned inside purchase_units[].payments.captures.
 */
export class PayPalCapture {
    /**
     * The id of a captured payment.
     */
    @Property.string()
    id!: string;

    /**
     * The status of the capture.
     */
    @Property.string({ required: false })
    status?: string;
}

/**
 * Payments object inside a purchase_unit.
 */
class PayPalPayments {
    /**
     * The payment captures.
     */
    @Property.array({ required: false, items: { type: 'object', cls: () => PayPalCapture } })
    captures?: PayPalCapture[];
}

/**
 * Purchase_unit in capture response.
 */
class PayPalPurchaseUnit {
    /**
     * Any payments that belong to this purchase unit.
     */
    @Property.object({ required: false, cls: () => PayPalPayments })
    payments?: PayPalPayments;
}

/**
 * Typed response for captureOrder.
 */
export class CaptureOrderResp {
    /**
     * The id of the captured order.
     */
    @Property.string()
    id!: string;

    /**
     * The status of the capture.
     */
    @Property.string({ required: false })
    status?: string;

    /**
     * The purchase units of the capture.
     */
    @Property.array({ required: false, items: { type: 'object', cls: () => PayPalPurchaseUnit } })
    purchase_units?: PayPalPurchaseUnit[];
}

/**
 * Authorization (Reservation) of a payment.
 */
class PayPalAuthorization {
    /**
     * The id of the authorization.
     */
    @Property.string()
    id!: string;

    /**
     * The status of the authorization.
     */
    @Property.string({ required: false })
    status?: string;

    /**
     * The amount that has been authorized.
     */
    @Property.object({ required: false, cls: () => PaymentAmount })
    amount?: PaymentAmount;
}

/**
 * Payments with their authorizations.
 */
class PayPalPaymentsWithAuth {
    /**
     * The authorizations for the payments.
     */
    @Property.array({ required: false, items: { type: 'object', cls: () => PayPalAuthorization } })
    authorizations?: PayPalAuthorization[];
}

/**
 * Purchase units with their authorizations.
 */
class PayPalPurchaseUnitWithAuth {
    /**
     * The payments including the authorizations.
     */
    @Property.object({ required: false, cls: () => PayPalPaymentsWithAuth })
    payments?: PayPalPaymentsWithAuth;
}

/**
 * Response for getting a order.
 */
export class GetOrderResp {
    /**
     * The id of the order.
     */
    @Property.string()
    id!: string;

    /**
     * The status of the order.
     */
    @Property.string({ required: false })
    status?: string;

    /**
     * The purchase units of this order.
     */
    @Property.array({ required: false, items: { type: 'object', cls: () => PayPalPurchaseUnitWithAuth } })
    purchase_units?: PayPalPurchaseUnitWithAuth[];
}

/**
 * Response for capturing an authorization.
 */
export class AuthorizationCaptureResp {
    /**
     * The id of the authorization.
     */
    @Property.string()
    id!: string;

    /**
     * The status of the authorization.
     */
    @Property.string({ required: false })
    status?: string;

    /**
     * Any links that belong to this authorization.
     */
    @Property.array({ required: false, items: { type: 'object', cls: () => PayPalLink } })
    links?: PayPalLink[];
}

/**
 * Result for capturing a refund.
 */
export class RefundCaptureResp {
    /**
     * The id of the refund.
     */
    @Property.string()
    id!: string;

    /**
     * The status of the refund.
     */
    @Property.string({ required: false })
    status?: string;

    /**
     * Any links that belong to this refund.
     */
    @Property.array({ required: false, items: { type: 'object', cls: () => PayPalLink } })
    links?: PayPalLink[];
}

/**
 * Client for handling anything related with the PayPal API.
 */
export class PayPalClient {
    private readonly baseUrl: string;
    private token?: PayPalAccessToken;
    private readonly http: HttpClientInterface;

    constructor(private readonly options: PayPalPaymentProviderOptions) {
        this.baseUrl = options.env === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
        this.http = inject(ZIBRI_DI_TOKENS.HTTP_CLIENT);
    }

    private async getAccessToken(): Promise<string> {
        const nowInMs: number = Date.now();
        if (this.token && this.token.expiresAt > nowInMs + 5000) {
            return this.token.accessToken;
        }

        const url: string = `${this.baseUrl}/v1/oauth2/token`;
        const auth: string = Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString('base64');

        const body: string = 'grant_type=client_credentials';

        const resp: AuthResp = (await this.http.post(url, body, {
            headers: {
                [KnownHeader.AUTHORIZATION]: `Basic ${auth}`,
                [KnownHeader.CONTENT_TYPE]: MimeType.FORM_URL_ENCODED
            },
            responseBody: { type: MimeType.JSON, modelClass: AuthResp, allowAdditionalProperties: true }
        })).body;

        this.token = {
            accessToken: resp.access_token,
            expiresAt: Date.now() + (resp.expires_in * 1000)
        };
        return this.token.accessToken;
    }

    /**
     * Creates a new Order.
     * @param body - The create body as required by the api.
     * @returns The created order.
     */
    async createOrder(body: CreateOrderBody): Promise<CreateOrderResp> {
        const token: string = await this.getAccessToken();
        const url: string = `${this.baseUrl}/v2/checkout/orders`;

        return (await this.http.post(
            url,
            body,
            {
                responseBody: CreateOrderResp,
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        )).body;
    }

    /**
     * Captures a completed order with the given id.
     * @param orderId - The id of the order to capture.
     * @returns The captured order.
     */
    async captureOrder(orderId: string): Promise<CaptureOrderResp> {
        const token: string = await this.getAccessToken();
        const url: string = `${this.baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`;

        const resp: CaptureOrderResp = (await this.http.post(
            url,
            {},
            {
                responseBody: CaptureOrderResp,
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        )).body;

        return resp;
    }

    /**
     * Gets an order with the given id.
     * @param orderId - The id of the order to retrieve.
     * @returns The found order.
     */
    async getOrder(orderId: string): Promise<GetOrderResp> {
        const token: string = await this.getAccessToken();
        const url: string = `${this.baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}`;
        return (await this.http.get(url, {
            responseBody: GetOrderResp,
            headers: {
                Authorization: `Bearer ${token}`
            }
        })).body;
    }

    /**
     * Captures authorization with the given id.
     * @param authorizationId - The id of the (already confirmed) authorization.
     * @param amount - The amount to capture.
     * @returns The captured authorization.
     */
    async captureAuthorization(authorizationId: string, amount: PaymentAmount): Promise<AuthorizationCaptureResp> {
        const token: string = await this.getAccessToken();
        const url: string = `${this.baseUrl}/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`;

        return (await this.http.post(url, { amount }, {
            responseBody: AuthorizationCaptureResp,
            headers: {
                Authorization: `Bearer ${token}`
            }
        })).body;
    }

    /**
     * Authorizes an AUTHORIZE-intent order that the buyer has already approved.
     * Must be called before confirmPaymentReservation can read the authorization id.
     * @param orderId - The id of the approved order to authorize.
     * @returns The authorized order, including purchase_units[].payments.authorizations.
     */
    async authorizeOrder(orderId: string): Promise<GetOrderResp> {
        const token: string = await this.getAccessToken();
        const url: string = `${this.baseUrl}/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`;

        return (await this.http.post(url, {}, {
            responseBody: GetOrderResp,
            headers: {
                Authorization: `Bearer ${token}`
            }
        })).body;
    }

    /**
     * Cancels the existing authorization with the given id.
     * @param authorizationId - The id of the authorization to cancel.
     */
    async voidAuthorization(authorizationId: string): Promise<void> {
        const token: string = await this.getAccessToken();
        const url: string = `${this.baseUrl}/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`;

        await this.http.post(url, {}, {
            headers: {
                Authorization: `Bearer ${token}`
            }
        });
    }

    /**
     * Refunds the payment of the capture with the given id.
     * @param captureId - The id of the capture to refund.
     * @param amount - The amount to refund.
     * @returns The refund result.
     */
    async refundCapture(captureId: string, amount: PaymentAmount): Promise<RefundCaptureResp> {
        const token: string = await this.getAccessToken();
        const url: string = `${this.baseUrl}/v2/payments/captures/${encodeURIComponent(captureId)}/refund`;

        return (await this.http.post(url, { amount }, {
            responseBody: RefundCaptureResp,
            headers: {
                Authorization: `Bearer ${token}`
            }
        })).body;
    }
}