// Client-facing read models. Each response contains only data that belongs to the signed-in client,
// with internal fields (cancellation reasons, staff notes, reviewer identities) removed.

import { compareAmounts, formatMoney, sumAmounts } from '../../shared/money';
import { todayFor, type Deps } from '../deps';
import { getInvoiceForClient, listInvoices, listLineItems } from './invoices';
import { listClientReferences, paymentOptionsFor } from './payments';
import { clientVisibleNotifications } from './notifications';
import type { InvoiceSummary } from './common';
import { readPublished } from './settings';

export function clientInvoiceView(invoice: InvoiceSummary) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    description: invoice.description,
    currency: invoice.currency,
    total: invoice.totalAmount,
    totalFormatted: formatMoney(invoice.totalAmount, invoice.currency),
    paid: invoice.netPaid,
    outstanding: invoice.outstanding,
    outstandingFormatted: formatMoney(invoice.outstanding, invoice.currency),
    issueDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    partialPaymentsAllowed: invoice.partialPaymentsAllowed,
    status: invoice.status,
    statusLabel: invoice.statusLabel,
    tone: invoice.tone,
    overdue: invoice.overdue,
    notes: invoice.notes,
  };
}

export async function clientDashboard(deps: Deps, clientId: string) {
  const { db } = deps;
  const invoices = await listInvoices(deps, { clientId });
  const references = await listClientReferences(deps, clientId);
  const settings = await readPublished(db);
  const client = await db.query<{ full_name: string; client_code: string }>('SELECT full_name, client_code FROM clients WHERE id = $1', [clientId]);
  const open = invoices.filter(
    (invoice) => !['payment_verified', 'refunded', 'cancelled'].includes(invoice.status) && compareAmounts(invoice.outstanding, '0.00') > 0,
  );
  const byCurrency = new Map<string, string[]>();
  for (const invoice of open) {
    byCurrency.set(invoice.currency, [...(byCurrency.get(invoice.currency) ?? []), invoice.outstanding]);
  }
  const pendingConfirmations = references.flatMap((ref) =>
    ref.submissions
      .filter((sub) => ['submitted', 'under_review', 'info_requested'].includes(sub.status))
      .map((sub) => ({ reference: ref.reference, status: sub.status, statusLabel: sub.statusLabel, submittedAt: sub.submittedAt })),
  );
  return {
    client: { name: client.rows[0]?.full_name ?? '', code: client.rows[0]?.client_code ?? '' },
    welcome: settings.branding.clientWelcomeMessage,
    summary: {
      openInvoices: open.length,
      overdueInvoices: open.filter((invoice) => invoice.overdue).length,
      outstandingByCurrency: [...byCurrency.entries()].map(([currency, amounts]) => {
        const total = sumAmounts(amounts);
        return { currency, amount: total, amountFormatted: formatMoney(total, currency) };
      }),
      pendingConfirmations: pendingConfirmations.length,
    },
    invoices: invoices.map(clientInvoiceView),
    recentReferences: references.slice(0, 5),
    pendingConfirmations,
    notifications: await clientVisibleNotifications(db, clientId),
    today: todayFor(deps),
  };
}

export async function clientInvoiceDetail(deps: Deps, clientId: string, invoiceId: string) {
  const invoice = await getInvoiceForClient(deps, clientId, invoiceId);
  const lineItems = await listLineItems(deps.db, invoice.id);
  const references = await listClientReferences(deps, clientId, invoice.id);
  const options = await paymentOptionsFor(deps, invoice);
  return {
    invoice: clientInvoiceView(invoice),
    lineItems: lineItems.map((item) => ({
      description: item.description,
      kind: item.kind,
      amount: item.amount,
      amountFormatted: formatMoney(item.amount, invoice.currency),
    })),
    options,
    references,
  };
}
