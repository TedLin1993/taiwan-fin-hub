import type { ConnectorId } from "@taiwan-fin-hub/core";
import type { Context, Hono } from "hono";
import { z } from "zod";
import type { AppBindings } from "../env";
import {
  encodePageCursor,
  jsonError,
  parseKeysetPagination,
  setKeysetPaginationHeaders
} from "../http";

const invoicePageCursorSchema = z.object({
  invoiceDate: z.string(),
  updatedAt: z.string(),
  id: z.string()
});

type InvoiceItemRow = {
  id: string;
  invoiceId: string;
  sourceId: string;
  lineNumber: number;
  description: string;
  quantity: number | null;
  unitPrice: number | null;
  amount: number;
};

export function registerInvoiceRoutes(api: Hono<AppBindings>) {
  api.get("/invoices", async (c) => {
    const { limit, cursor } = parseKeysetPagination(c.req.query(), invoicePageCursorSchema, 50);
    const cursorClause = cursor
      ? "WHERE (invoice_date, updated_at, id) < (?, ?, ?)"
      : "";
    const statement = c.env.DB.prepare(
      `SELECT
        id,
        connector_id AS connectorId,
        source_id AS sourceId,
        invoice_number AS invoiceNumber,
        invoice_date AS invoiceDate,
        seller_name AS sellerName,
        amount,
        updated_at AS updatedAt
      FROM invoices
      ${cursorClause}
      ORDER BY invoice_date DESC, updated_at DESC, id DESC
      LIMIT ?`
    );
    const invoices = await (cursor
      ? statement.bind(cursor.invoiceDate, cursor.updatedAt, cursor.id, limit + 1)
      : statement.bind(limit + 1)
    ).all<{
      id: string;
      connectorId: ConnectorId;
      sourceId: string;
      invoiceNumber: string | null;
      invoiceDate: string;
      sellerName: string | null;
      amount: number;
      updatedAt: string;
    }>();

    const hasMore = invoices.results.length > limit;
    const page = invoices.results.slice(0, limit);
    const invoiceIds = page.map((invoice) => invoice.id);
    let itemRows: InvoiceItemRow[] = [];
    if (invoiceIds.length > 0) {
      const placeholders = invoiceIds.map(() => "?").join(", ");
      const items = await c.env.DB.prepare(
        `SELECT
          id,
          invoice_id AS invoiceId,
          source_id AS sourceId,
          line_number AS lineNumber,
          description,
          quantity,
          unit_price AS unitPrice,
          amount
        FROM invoice_line_items
        WHERE invoice_id IN (${placeholders})
        ORDER BY invoice_id ASC, line_number ASC, source_id ASC`
      ).bind(...invoiceIds).all<InvoiceItemRow>();
      itemRows = items.results;
    }

    const itemsByInvoiceId = new Map<string, InvoiceItemRow[]>();
    for (const item of itemRows) {
      const current = itemsByInvoiceId.get(item.invoiceId) ?? [];
      current.push(item);
      itemsByInvoiceId.set(item.invoiceId, current);
    }

    const last = page.at(-1);
    setKeysetPaginationHeaders((name, value) => c.header(name, value), {
      hasMore,
      nextCursor: hasMore && last
        ? encodePageCursor({ invoiceDate: last.invoiceDate, updatedAt: last.updatedAt, id: last.id })
        : undefined
    });
    return c.json(page.map(({ updatedAt: _updatedAt, ...invoice }) => ({
      ...invoice,
      invoiceNumber: invoice.invoiceNumber ?? undefined,
      sellerName: invoice.sellerName ?? undefined,
      items: itemsByInvoiceId.get(invoice.id) ?? []
    })));
  });

  api.get("/invoice-detail", async (c) => {
    const invoiceId = c.req.query("invoiceId");
    if (!invoiceId) return jsonError("INVALID_REQUEST", "invoiceId query parameter is required.");
    return invoiceDetailResponse(c, invoiceId);
  });

  api.get("/invoices/:invoiceId", async (c) => invoiceDetailResponse(c, c.req.param("invoiceId")));
}

async function invoiceDetailResponse(c: Context<AppBindings>, invoiceId: string) {
  const invoice = await c.env.DB.prepare(
    `SELECT
      id,
      connector_id AS connectorId,
      source_id AS sourceId,
      invoice_number AS invoiceNumber,
      invoice_date AS invoiceDate,
      seller_name AS sellerName,
      amount
    FROM invoices
    WHERE id = ?`
  ).bind(invoiceId).first<{
    id: string;
    connectorId: string;
    sourceId: string;
    invoiceNumber: string | null;
    invoiceDate: string;
    sellerName: string | null;
    amount: number;
  }>();

  if (!invoice) return jsonError("INVOICE_NOT_FOUND", "Invoice was not found.", 404);

  const items = await c.env.DB.prepare(
    `SELECT
      id,
      source_id AS sourceId,
      line_number AS lineNumber,
      description,
      quantity,
      unit_price AS unitPrice,
      amount
    FROM invoice_line_items
    WHERE invoice_id = ?
    ORDER BY line_number ASC, source_id ASC`
  ).bind(invoiceId).all();

  return c.json({
    ...invoice,
    invoiceNumber: invoice.invoiceNumber ?? undefined,
    sellerName: invoice.sellerName ?? undefined,
    items: items.results
  });
}
