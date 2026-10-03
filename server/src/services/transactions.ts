import { desc, eq, getDb, schema } from "@agntpymt/db";

export type PaymentRow = {
  id: string;
  runId: string | null;
  agentId: string;
  agentName: string;
  vendorName: string;
  description: string;
  amountUsd: number;
  status: string;
  txHash: string | null;
  feedbackTxHash: string | null;
  policyTxHash: string | null;
  createdAt: string;
};

export async function listPaymentsForOrg(orgId: string): Promise<PaymentRow[]> {
  const db = getDb();
  const [rows, agents] = await Promise.all([
    db
      .select()
      .from(schema.transactions)
      .where(eq(schema.transactions.orgId, orgId))
      .orderBy(desc(schema.transactions.createdAt)),
    db.select().from(schema.agents).where(eq(schema.agents.orgId, orgId)),
  ]);

  const agentNames = new Map(agents.map((a) => [a.id, a.name]));

  return rows.map((row) => ({
    id: row.id,
    runId: row.runId,
    agentId: row.agentId,
    agentName: agentNames.get(row.agentId) ?? row.agentId,
    vendorName: row.vendorName,
    description: row.description,
    amountUsd: row.amountUsd,
    status: row.status,
    txHash: row.txHash,
    feedbackTxHash: row.feedbackTxHash,
    policyTxHash: row.policyTxHash,
    createdAt: row.createdAt,
  }));
}

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function paymentsToCsv(rows: PaymentRow[]): string {
  const header = [
    "Date (UTC)",
    "Agent",
    "Seller",
    "Description",
    "Amount (USDC)",
    "Status",
    "Payment tx",
    "Rating tx",
    "Policy tx",
    "Run ID",
    "Transaction ID",
  ];
  const lines = rows.map((row) =>
    [
      row.createdAt,
      row.agentName,
      row.vendorName,
      row.description,
      row.amountUsd.toFixed(4),
      row.status,
      row.txHash ?? "",
      row.feedbackTxHash ?? "",
      row.policyTxHash ?? "",
      row.runId ?? "",
      row.id,
    ]
      .map(csvCell)
      .join(",")
  );
  return [header.join(","), ...lines].join("\r\n");
}
