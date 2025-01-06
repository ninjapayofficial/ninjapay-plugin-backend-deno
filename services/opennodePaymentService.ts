// services/opennodePaymentService.ts

// Define interfaces for type safety
interface OpenNodeProvider {
  provider: "opennode";
  invoiceKey: string;
  readApiKey: string;
  providerInvoiceKey: string;
  providerAdminKey: string;
}

interface CreatePayLinkResponse {
  id: string;
  status: string;
  charge_id: string;
  amount: number;
  currency: string;
  invoice: string;
  description: string;
  redirect_url: string;
}

interface BalanceResponse {
  balance: number;
}

interface PayInvoiceResponse {
  id: string;
  status: string;
}

interface Transaction {
  id: string;
  status: string;
  amount: number;
  timestamp: string;
}

// OpenNode Payment Service
export class OpenNodePaymentService {
  private provider: OpenNodeProvider;

  constructor(provider: OpenNodeProvider) {
    this.provider = provider;
  }

  // Create a payment link
  async createPayLink(
    amount: number,
    memo: string,
  ): Promise<CreatePayLinkResponse> {
    const url = "https://api.opennode.com/v1/charges";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.provider.invoiceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount,
        currency: "USD", // or your desired currency
        description: memo,
        webhook: "https://yourdomain.com/webhook", // Replace with your webhook URL
        redirect_url: "https://yourdomain.com", // Replace with your redirect URL
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenNode createPayLink failed: ${error}`);
    }

    const data = await response.json();
    return data.data as CreatePayLinkResponse;
  }

  // Get balance
  async getBalance(): Promise<BalanceResponse> {
    const url = "https://api.opennode.com/v1/account/balance";
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.provider.readApiKey}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenNode getBalance failed: ${error}`);
    }

    const data = await response.json();
    return { balance: parseFloat(data.data.balance.BTC) };
  }

  // Pay an invoice
  async payInvoice(invoice: string): Promise<PayInvoiceResponse> {
    const url = "https://api.opennode.com/v1/charges";
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.provider.invoiceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reference: "Payment for Order #1234", // Customize as needed
        amount: 1000, // Amount in cents
        currency: "USD",
        description: "Payment description",
        invoice,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenNode payInvoice failed: ${error}`);
    }

    const data = await response.json();
    return { id: data.data.id, status: data.data.status };
  }

  // Get transactions
  async getTransactions(): Promise<Transaction[]> {
    const url = "https://api.opennode.com/v1/charges";
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.provider.readApiKey}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenNode getTransactions failed: ${error}`);
    }

    const data = await response.json();
    return data.data.map((charge: any) => ({
      id: charge.id,
      status: charge.status,
      amount: charge.amount,
      timestamp: charge.created_at,
    }));
  }

  // Check status of a payment
  async checkStatus(chargeId: string): Promise<string> {
    const url = `https://api.opennode.com/v1/charges/${chargeId}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${this.provider.readApiKey}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenNode checkStatus failed: ${error}`);
    }

    const data = await response.json();
    return data.data.status;
  }
}
