import type { ConnectorId } from "@taiwan-fin-hub/core";

export interface InvoiceLineItemRow {
  id: string;
  invoiceId?: string;
  sourceId: string;
  lineNumber: number;
  description: string;
  quantity?: number;
  unitPrice?: number;
  amount: number;
}

export interface InvoiceRow {
  id: string;
  connectorId: ConnectorId;
  sourceId: string;
  invoiceDate: string;
  invoiceNumber?: string;
  sellerName?: string;
  amount: number;
  items: InvoiceLineItemRow[];
}

export interface InvoiceTransactionPreference {
  invoiceId: string;
  transactionId: string | null;
  decision: "linked" | "separate";
  updatedAt: string;
}
