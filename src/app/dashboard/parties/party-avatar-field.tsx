"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ImageUp, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PartyAvatar } from "@/components/party-avatar";
import {
  AVATAR_MAX_UPLOAD_BYTES,
  AVATAR_SIZE,
  AVATAR_SOURCE_TYPES,
  validateAvatarSource,
} from "@/lib/party-avatar";
import { cn } from "@/lib/utils";

type Mode = "keep" | "replace" | "remove";

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * 置中裁成正方形、縮到 256×256，優先輸出 WebP；瀏覽器不會編 WebP（toBlob 會默默退回 PNG）
 * 時改出 JPEG（墊白底，透明處才不會變黑）。品質由高往低試，直到 ≤ 200 KB。
 */
async function resizeToSquare(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE;
  canvas.height = AVATAR_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    bitmap,
    (bitmap.width - side) / 2,
    (bitmap.height - side) / 2,
    side,
    side,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE,
  );
  bitmap.close();

  const qualities = [0.9, 0.8, 0.65, 0.5];
  for (const q of qualities) {
    const blob = await canvasToBlob(canvas, "image/webp", q);
    if (blob?.type !== "image/webp") break; // 不支援 WebP 編碼
    if (blob.size <= AVATAR_MAX_UPLOAD_BYTES) return blob;
  }

  const flat = document.createElement("canvas");
  flat.width = AVATAR_SIZE;
  flat.height = AVATAR_SIZE;
  const fctx = flat.getContext("2d");
  if (!fctx) throw new Error("canvas unavailable");
  fctx.fillStyle = "#ffffff";
  fctx.fillRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
  fctx.drawImage(canvas, 0, 0);
  for (const q of qualities) {
    const blob = await canvasToBlob(flat, "image/jpeg", q);
    if (blob && blob.size <= AVATAR_MAX_UPLOAD_BYTES) return blob;
  }
  throw new Error("image too large after resize");
}

/** 剪貼簿 / 拖曳進來的第一個圖片檔。 */
function firstImageFile(list: DataTransferItemList | null | undefined): File | null {
  if (!list) return null;
  for (const item of Array.from(list)) {
    if (item.kind === "file" && item.type.startsWith("image/")) return item.getAsFile();
  }
  return null;
}

/**
 * 編輯交易對象表單最上面的頭像欄位：點擊選檔 / 拖曳 / 貼上，預覽、更換、移除。
 *
 * 不會自己送出任何東西 —— 跟其他欄位一樣，按「儲存變更」才生效（按「取消」就沒事）。
 * 它在表單裡放兩個欄位交給 updateParty：
 *   avatarAction = keep | replace | remove
 *   avatar       = 已在瀏覽器縮好的檔案（replace 時）
 */
export function PartyAvatarField({
  partyId,
  name,
  avatarVersion,
}: Readonly<{ partyId: number; name: string; avatarVersion: string | null }>) {
  const t = useTranslations("parties.avatar");
  const [mode, setMode] = useState<Mode>("keep");
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  const payloadRef = useRef<HTMLInputElement>(null);

  // blob: 預覽網址用完要收回
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const setPayload = (file: File | null) => {
    const input = payloadRef.current;
    if (!input) return;
    const dt = new DataTransfer();
    if (file) dt.items.add(file);
    input.files = dt.files;
  };

  const accept = useCallback(
    async (file: File) => {
      const check = validateAvatarSource(file);
      if (!check.ok) {
        toast.error(t(`errors.${check.reason}`));
        return;
      }
      setBusy(true);
      try {
        const blob = await resizeToSquare(file);
        const ext = blob.type === "image/webp" ? "webp" : "jpg";
        setPayload(new File([blob], `avatar.${ext}`, { type: blob.type }));
        setPreview(URL.createObjectURL(blob));
        setMode("replace");
      } catch {
        toast.error(t("errors.processFailed"));
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  // 貼上：只攔「剪貼簿裡有圖片」的貼上，貼文字到其他欄位照常
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const file = firstImageFile(e.clipboardData?.items);
      if (!file) return;
      e.preventDefault();
      void accept(file);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [accept]);

  const onDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = firstImageFile(e.dataTransfer.items) ?? e.dataTransfer.files[0] ?? null;
    if (file) void accept(file);
  };

  const undo = () => {
    setMode("keep");
    setPreview(null);
    setPayload(null);
  };
  const remove = () => {
    // 原本就沒有頭像：「移除」剛選的圖等於回到原狀
    if (!avatarVersion) {
      undo();
      return;
    }
    setMode("remove");
    setPreview(null);
    setPayload(null);
  };

  const hasCurrent = Boolean(avatarVersion);
  const showsImage = mode === "replace" || (mode === "keep" && hasCurrent);

  let status = t("hint");
  if (busy) status = t("processing");
  else if (mode === "replace") status = t("pendingReplace");
  else if (mode === "remove") status = t("pendingRemove");

  return (
    <div className="flex items-center gap-4 sm:col-span-2">
      <input type="hidden" name="avatarAction" value={mode} />
      <input ref={payloadRef} type="file" name="avatar" className="hidden" tabIndex={-1} aria-hidden />
      <input
        ref={pickerRef}
        type="file"
        accept={AVATAR_SOURCE_TYPES.join(",")}
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ""; // 同一個檔案再選一次也要觸發
          if (file) void accept(file);
        }}
      />
      <button
        type="button"
        onClick={() => pickerRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        disabled={busy}
        aria-label={t("choose")}
        className={cn(
          "rounded-lg border border-dashed p-1.5 transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring",
          dragging ? "border-primary bg-primary/5" : "border-border",
          busy && "opacity-60",
        )}
      >
        <PartyAvatar
          name={name}
          size="lg"
          partyId={mode === "keep" ? partyId : null}
          avatarVersion={mode === "keep" ? avatarVersion : null}
          src={mode === "replace" ? preview : null}
        />
      </button>
      <div className="min-w-0 space-y-1.5">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => pickerRef.current?.click()}
          >
            <ImageUp />
            {showsImage ? t("replace") : t("choose")}
          </Button>
          {showsImage ? (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={remove}>
              <Trash2 />
              {t("remove")}
            </Button>
          ) : null}
          {mode === "keep" ? null : (
            <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={undo}>
              <Undo2 />
              {t("undo")}
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {status}
        </p>
      </div>
    </div>
  );
}
