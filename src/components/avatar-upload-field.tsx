"use client";

import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { ImageUp, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AVATAR_SOURCE_TYPES, validateAvatarSource } from "@/lib/party-avatar";
import { firstImageFile, resizeToSquare } from "@/lib/avatar-resize";
import { cn } from "@/lib/utils";

export type AvatarMode = "keep" | "replace" | "remove";

export type AvatarFieldLabels = {
  choose: string;
  replace: string;
  remove: string;
  undo: string;
  hint: string;
  processing: string;
  pendingReplace: string;
  pendingRemove: string;
  errors: { empty: string; type: string; tooLarge: string; processFailed: string };
};

/**
 * 頭像欄位（交易對象、組織 logo、個人頭像共用）：點擊選檔／拖曳／貼上，預覽、更換、移除。
 *
 * 不會自己送出 —— 跟其他欄位一樣，按表單的「儲存」才生效。它在表單裡放兩個欄位：
 *   avatarAction = keep | replace | remove
 *   avatar       = 已在瀏覽器裁成正方形、縮到 256×256 的檔案（replace 時）
 * server 端用 src/lib/avatar-form.ts（或 mutations.ts 的 readAvatarChange）讀。
 *
 * `renderAvatar(src)`：src 是新選的 blob 預覽；null 時畫目前的頭像（mode=keep）或空白的 fallback（mode=remove）。
 * 存檔成功後換一個 `key` 重掛，欄位就回到 keep。
 */
export function AvatarUploadField({
  hasCurrent,
  renderAvatar,
  labels,
  disabled = false,
  onModeChange,
  className,
}: Readonly<{
  hasCurrent: boolean;
  renderAvatar: (preview: { mode: AvatarMode; src: string | null }) => ReactNode;
  labels: AvatarFieldLabels;
  disabled?: boolean;
  onModeChange?: (mode: AvatarMode) => void;
  className?: string;
}>) {
  const [mode, setModeState] = useState<AvatarMode>("keep");
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);
  const payloadRef = useRef<HTMLInputElement>(null);

  const setMode = useCallback(
    (m: AvatarMode) => {
      setModeState(m);
      onModeChange?.(m);
    },
    [onModeChange],
  );

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
        toast.error(labels.errors[check.reason]);
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
        toast.error(labels.errors.processFailed);
      } finally {
        setBusy(false);
      }
    },
    [labels, setMode],
  );

  // 貼上：只攔「剪貼簿裡有圖片」的貼上，貼文字到其他欄位照常
  useEffect(() => {
    if (disabled) return;
    const onPaste = (e: ClipboardEvent) => {
      const file = firstImageFile(e.clipboardData?.items);
      if (!file) return;
      e.preventDefault();
      accept(file);
    };
    globalThis.addEventListener("paste", onPaste);
    return () => globalThis.removeEventListener("paste", onPaste);
  }, [accept, disabled]);

  const onDrop = (e: DragEvent<HTMLButtonElement>) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = firstImageFile(e.dataTransfer.items) ?? e.dataTransfer.files[0] ?? null;
    if (file) accept(file);
  };

  const undo = () => {
    setMode("keep");
    setPreview(null);
    setPayload(null);
  };
  const remove = () => {
    // 原本就沒有頭像：「移除」剛選的圖等於回到原狀
    if (!hasCurrent) {
      undo();
      return;
    }
    setMode("remove");
    setPreview(null);
    setPayload(null);
  };

  const showsImage = mode === "replace" || (mode === "keep" && hasCurrent);
  const off = busy || disabled;

  let status = labels.hint;
  if (busy) status = labels.processing;
  else if (mode === "replace") status = labels.pendingReplace;
  else if (mode === "remove") status = labels.pendingRemove;

  return (
    <div className={cn("flex items-center gap-4", className)}>
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
          if (file) accept(file);
        }}
      />
      <button
        type="button"
        onClick={() => pickerRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        disabled={off}
        aria-label={labels.choose}
        className={cn(
          "rounded-lg border border-dashed p-1.5 transition-colors outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:hover:bg-transparent",
          dragging ? "border-primary bg-primary/5" : "border-border",
          busy && "opacity-60",
        )}
      >
        {renderAvatar({ mode, src: mode === "replace" ? preview : null })}
      </button>
      {disabled ? null : (
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" disabled={off} onClick={() => pickerRef.current?.click()}>
              <ImageUp />
              {showsImage ? labels.replace : labels.choose}
            </Button>
            {showsImage ? (
              <Button type="button" size="sm" variant="ghost" disabled={off} onClick={remove}>
                <Trash2 />
                {labels.remove}
              </Button>
            ) : null}
            {mode === "keep" ? null : (
              <Button type="button" size="sm" variant="ghost" disabled={off} onClick={undo}>
                <Undo2 />
                {labels.undo}
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {status}
          </p>
        </div>
      )}
    </div>
  );
}

/** 依 next-intl 的 t（指向 *.avatar 命名空間）組出 labels。 */
export function avatarFieldLabels(t: (key: string) => string): AvatarFieldLabels {
  return {
    choose: t("choose"),
    replace: t("replace"),
    remove: t("remove"),
    undo: t("undo"),
    hint: t("hint"),
    processing: t("processing"),
    pendingReplace: t("pendingReplace"),
    pendingRemove: t("pendingRemove"),
    errors: {
      empty: t("errors.empty"),
      type: t("errors.type"),
      tooLarge: t("errors.tooLarge"),
      processFailed: t("errors.processFailed"),
    },
  };
}
