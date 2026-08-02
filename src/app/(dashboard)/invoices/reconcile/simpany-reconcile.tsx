"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableCard } from "@/components/table-card";
import { markInvoiceExternal } from "@/db/mutations";
import { formatCurrency, formatDate } from "@/lib/format";
import {
  parseSimpanyCsv,
  parseSimpanyTable,
  reconcileInvoices,
  VERDICT_LABELS,
  type LocalInvoice,
  type ReconcileRow,
  type ReconcileVerdict,
} from "@/lib/simpany-export";
import { readXlsxFirstSheet } from "@/lib/xlsx-lite";

const verdictVariant: Record<ReconcileVerdict, "default" | "secondary" | "outline" | "destructive"> =
  {
    matched: "secondary",
    amount_mismatch: "destructive",
    voided_in_simpany: "destructive",
    missing_in_simpany: "outline",
    missing_locally: "destructive",
  };

const FIELD_LABELS: Record<string, string> = {
  number: "發票號碼",
  date: "日期",
  amount: "金額",
  name: "買受人",
  taxId: "統編",
  status: "狀態",
};

/**
 * Simpany 匯出檔對帳。
 *
 * 檔案完全在瀏覽器裡解析與比對，不上傳 —— 對帳是一次性的檢查，沒有留存的價值，
 * 也省掉一份含客戶名稱的檔案躺在 R2 裡。要落地的只有「把某張發票標成已開立」
 * 那一步，那才是真的狀態變更。
 */
export function SimpanyReconcile({ local }: Readonly<{ local: LocalInvoice[] }>) {
  const [rows, setRows] = React.useState<ReconcileRow[] | null>(null);
  const [detected, setDetected] = React.useState<string[]>([]);
  const [error, setError] = React.useState<string | null>(null);
  const [fileName, setFileName] = React.useState<string | null>(null);
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<number | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);

    // Simpany 的匯出按鈕給 .xlsx；另存成 CSV 的也接受。
    let parsed;
    try {
      parsed = file.name.toLowerCase().endsWith(".xlsx")
        ? parseSimpanyTable(await readXlsxFirstSheet(await file.arrayBuffer()))
        : parseSimpanyCsv(await file.text());
    } catch (err) {
      setError(err instanceof Error ? err.message : "檔案讀不開");
      setRows(null);
      setDetected([]);
      return;
    }

    if (parsed.error) {
      setError(parsed.error);
      setRows(null);
      setDetected([]);
      return;
    }
    setError(null);
    setDetected(
      Object.entries(parsed.detected).map(
        ([field, header]) => `${FIELD_LABELS[field] ?? field} ← ${header}`,
      ),
    );
    setRows(reconcileInvoices(local, parsed.rows));
    if (parsed.skipped > 0) {
      toast.info(`略過 ${parsed.skipped} 列沒有發票號碼的資料`);
    }
  }

  async function markIssued(row: ReconcileRow) {
    if (row.localId == null) return;
    setPendingId(row.localId);
    const res = await markInvoiceExternal(row.localId, "issued", row.number);
    setPendingId(null);
    if (res.ok) {
      toast.success("已標記為 Simpany 已開立");
      router.refresh();
    } else {
      toast.error(res.error ?? "更新失敗");
    }
  }

  const counts = rows?.reduce<Record<string, number>>((acc, r) => {
    acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <TableCard
      title="Simpany 匯出檔比對"
      action={
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Button asChild size="sm" variant="outline">
            <span>
              <FileUp className="size-4" /> 選擇匯出檔
            </span>
          </Button>
          <Input
            type="file"
            accept=".xlsx,.csv,text/csv"
            className="hidden"
            onChange={(e) => {
              void onFile(e);
            }}
          />
        </label>
      }
    >
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted-foreground">
          到 Simpany 的收據 / 發票列表選好日期區間後按匯出，把 .xlsx（或另存的 CSV）丟進來。
          檔案只在瀏覽器裡比對，不會上傳。
        </p>

        {fileName && (
          <p className="text-xs text-muted-foreground">
            已讀取 <span className="font-medium">{fileName}</span>
            {detected.length > 0 && `　·　欄位對應：${detected.join("、")}`}
          </p>
        )}

        {error && <p className="text-sm text-expense">{error}</p>}

        {counts && (
          <div className="flex flex-wrap gap-2">
            {(Object.keys(VERDICT_LABELS) as ReconcileVerdict[]).map((v) =>
              counts[v] ? (
                <Badge key={v} variant={verdictVariant[v]}>
                  {VERDICT_LABELS[v]} {counts[v]}
                </Badge>
              ) : null,
            )}
          </div>
        )}
      </div>

      {rows && rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>結果</TableHead>
              <TableHead>發票號碼</TableHead>
              <TableHead>對象</TableHead>
              <TableHead>日期</TableHead>
              <TableHead className="text-right">本系統</TableHead>
              <TableHead className="text-right">Simpany</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={`${r.verdict}-${r.number}-${r.localId ?? "x"}`}>
                <TableCell>
                  <Badge variant={verdictVariant[r.verdict]}>{VERDICT_LABELS[r.verdict]}</Badge>
                </TableCell>
                <TableCell className="text-sm tabular-nums">{r.number || "—"}</TableCell>
                <TableCell className="max-w-[20ch] truncate text-sm">{r.name ?? "—"}</TableCell>
                <TableCell className="text-xs tabular-nums text-muted-foreground">
                  {r.date ? formatDate(r.date) : "—"}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {r.localAmount == null ? "—" : formatCurrency(r.localAmount, "TWD")}
                </TableCell>
                <TableCell className="text-right text-sm tabular-nums">
                  {r.simpanyAmount == null ? "—" : formatCurrency(r.simpanyAmount, "TWD")}
                </TableCell>
                <TableCell>
                  {r.verdict === "matched" && r.localId != null && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={pendingId === r.localId}
                      onClick={() => {
                        void markIssued(r);
                      }}
                    >
                      <CheckCircle2 className="size-4" /> 標記已開立
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}
