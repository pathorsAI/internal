import { TableCard } from "@/components/table-card";
import { EmptyRow } from "@/components/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AGING_BUCKETS, AGING_LABELS, type AgingBucket, type AgingRow } from "@/db/queries";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";

/** 逾期越久顏色越重，一眼看得出哪一格該先處理。 */
const bucketTone: Record<AgingBucket, string> = {
  current: "text-muted-foreground",
  d1_30: "",
  d31_60: "text-expense/70",
  d61_90: "text-expense/85",
  d90p: "text-expense font-medium",
};

/**
 * 應收帳齡：誰欠我錢、欠多久了。
 *
 * 只列已請款而未收齊的金額 —— 還沒請款的不叫應收帳款。逾期天數以「應該收到錢
 * 的那天」起算（有月結條件就是請款日 + 天數），與看板的逾期判斷同一個基準。
 */
export function ReceivableAging({ rows }: Readonly<{ rows: AgingRow[] }>) {
  // 依幣別各自加總（本系統不做匯率換算，不同幣別分列）。
  const totals: Record<string, Record<AgingBucket, number>> = {};
  for (const r of rows) {
    const t = (totals[r.currency] ??= { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90p: 0 });
    for (const b of AGING_BUCKETS) t[b] += r.buckets[b];
  }
  const currencies = Object.keys(totals);

  return (
    <TableCard
      title="應收帳齡"
      action={
        currencies.length === 0
          ? "沒有未收的款項"
          : currencies
              .map((c) =>
                formatCurrency(
                  AGING_BUCKETS.reduce((s, b) => s + totals[c][b], 0),
                  c,
                ),
              )
              .join("　·　") + " 未收"
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>客戶</TableHead>
            {AGING_BUCKETS.map((b) => (
              <TableHead key={b} className="text-right">
                {AGING_LABELS[b]}
              </TableHead>
            ))}
            <TableHead className="text-right">合計</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={AGING_BUCKETS.length + 2} message="沒有未收的款項">
              已請款的項目都收齊了
            </EmptyRow>
          ) : (
            <>
              {rows.map((r) => (
                <TableRow key={`${r.customerPartyId ?? 0}-${r.currency}`}>
                  <TableCell className="font-medium">
                    {r.customerName}
                    {currencies.length > 1 && (
                      <span className="ml-1.5 text-xs text-muted-foreground">{r.currency}</span>
                    )}
                  </TableCell>
                  {AGING_BUCKETS.map((b) => (
                    <TableCell
                      key={b}
                      className={cn("text-right text-sm tabular-nums", bucketTone[b])}
                    >
                      {r.buckets[b] === 0 ? "—" : formatCurrency(r.buckets[b], r.currency)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCurrency(r.total, r.currency)}
                  </TableCell>
                </TableRow>
              ))}
              {currencies.map((c) => (
                <TableRow key={`total-${c}`} className="bg-muted/40">
                  <TableCell className="font-medium">合計（{c}）</TableCell>
                  {AGING_BUCKETS.map((b) => (
                    <TableCell key={b} className="text-right text-sm tabular-nums">
                      {totals[c][b] === 0 ? "—" : formatCurrency(totals[c][b], c)}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCurrency(
                      AGING_BUCKETS.reduce((s, b) => s + totals[c][b], 0),
                      c,
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </>
          )}
        </TableBody>
      </Table>
    </TableCard>
  );
}
