// services/lnbitsPaymentService.ts

import { decode } from "https://deno.land/std@0.185.0/encoding/base64.ts";

// Define interfaces for type safety
interface LNbitsProvider {
  provider: "lnbits";
  instanceUrl: string;
  invoiceKey: string;
  adminKey: string;
  providerInvoiceKey: string;
  providerAdminKey: string;
}

interface CreatePayLinkResponse {
  payment_request: string;
  payment_hash: string;
  payment_request_details: object;
}

interface BalanceResponse {
  balance: number;
}

interface PayInvoiceResponse {
  payment_hash: string;
  status: string;
}

interface Transaction {
  payment_hash: string;
  status: string;
  amount: number;
  timestamp: string;
}

// LNbits Payment Service
export class LNbitsPaymentService {
  private provider: LNbitsProvider;

  constructor(provider: LNbitsProvider) {
    this.provider = provider;
  }

  // Create a payment link
  async createPayLink(amount: number, memo: string): Promise<CreatePayLinkResponse> {
    const url = `${this.provider.instanceUrl}/api/v1/payments`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-Api-Key": this.provider.adminKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        out: false,
        amount,
        memo,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LNbits createPayLink failed: ${error}`);
    }

    const data = await response.json();
    return data as CreatePayLinkResponse;
  }

  // Get balance
  async getBalance(): Promise<BalanceResponse> {
    const url = `${this.provider.instanceUrl}/api/v1/wallet`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Api-Key": this.provider.invoiceKey,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LNbits getBalance failed: ${error}`);
    }

    const data = await response.json();
    return { balance: data.balance };
  }

  // Pay an invoice
  async payInvoice(paymentRequest: string): Promise<PayInvoiceResponse> {
    if (!paymentRequest) {
      throw new Error("Payment request is required");
    }
  
    const url = `${this.provider.instanceUrl}/api/v1/payments`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "X-Api-Key": this.provider.adminKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        out: true,
        bolt11: paymentRequest,
      }),
    });
  
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LNbits payInvoice failed: ${error}`);
    }
  
    const data = await response.json();
    return { payment_hash: data.payment_hash, status: data.status };
  }
  

  // Get transactions
  async getTransactions(): Promise<Transaction[]> {
    const url = `${this.provider.instanceUrl}/api/v1/payments`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Api-Key": this.provider.adminKey,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LNbits getTransactions failed: ${error}`);
    }

    const data = await response.json();
    return data as Transaction[];
  }

  // Check status of a payment
  async checkStatus(paymentHash: string): Promise<string> {
    const url = `${this.provider.instanceUrl}/api/v1/payments/${paymentHash}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "X-Api-Key": this.provider.adminKey,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LNbits checkStatus failed: ${error}`);
    }

    const data = await response.json();
    return data;
  }
}
