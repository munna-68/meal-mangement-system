"use client";

import { useState } from "react";
import { toast } from "sonner";
import { DownloadIcon, Loader2Icon, Share2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";

type Mode = "download" | "share";

type Format = "a5" | "a4";

/**
 * Below this scale the Bengali type prints at about 2pt and is unreadable, so
 * instead of shrinking a long sheet onto one page we run it down the page over
 * as many pages as it needs at a legible size.
 */
const LEGIBILITY_FLOOR = 0.5;

/** A horizontal band of the rasterised sheet, on its own white canvas. */
function sliceCanvas(
  source: HTMLCanvasElement,
  top: number,
  height: number,
): HTMLCanvasElement | null {
  const slice = document.createElement("canvas");
  slice.width = source.width;
  slice.height = height;
  const context = slice.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, slice.width, slice.height);
  context.drawImage(
    source,
    0,
    top,
    source.width,
    height,
    0,
    0,
    source.width,
    height,
  );
  return slice;
}

async function buildPdfBlob(
  targetId: string,
  format: Format,
  orientation: "portrait" | "landscape",
): Promise<Blob> {
  const node = document.getElementById(targetId);
  if (!node) throw new Error("The slip is not on the page yet.");

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import("html2canvas-pro"),
    import("jspdf"),
  ]);

  const canvas = await html2canvas(node, {
    scale: 2,
    backgroundColor: "#ffffff",
    logging: false,
  });

  const pdf = new jsPDF({ unit: "pt", format, orientation });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2;

  // Contain: scale the sheet so it fits inside the page in BOTH directions and
  // stays centred. Fitting to width alone left the slip hugging the top of the
  // page with dead space beneath it.
  const containScale = Math.min(
    usableWidth / canvas.width,
    usableHeight / canvas.height,
  );

  if (containScale >= LEGIBILITY_FLOOR) {
    const imageWidth = canvas.width * containScale;
    const imageHeight = canvas.height * containScale;
    const x = margin + (usableWidth - imageWidth) / 2;
    const y = margin + (usableHeight - imageHeight) / 2;
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", x, y, imageWidth, imageHeight);
    return pdf.output("blob");
  }

  // Too many rows to read on one page: keep the width scale (which stays
  // legible) and run the sheet down over several pages instead.
  const scale = usableWidth / canvas.width;
  const bandHeight = Math.max(1, Math.floor(usableHeight / scale));
  const pageCount = Math.max(1, Math.ceil(canvas.height / bandHeight));

  for (let page = 0; page < pageCount; page += 1) {
    const top = page * bandHeight;
    const height = Math.min(bandHeight, canvas.height - top);
    const slice = sliceCanvas(canvas, top, height);
    if (!slice) break;
    if (page > 0) pdf.addPage();
    pdf.addImage(
      slice.toDataURL("image/png"),
      "PNG",
      margin,
      margin,
      usableWidth,
      height * scale,
    );
  }

  return pdf.output("blob");
}

export function PdfButton({
  targetId,
  fileName,
  label = "PDF slip",
  mode = "download",
  format = "a5",
  orientation = "portrait",
  beforeExport,
  variant = "default",
  size = "sm",
  className,
}: {
  targetId: string;
  fileName: string;
  label?: string;
  mode?: Mode;
  format?: Format;
  orientation?: "portrait" | "landscape";
  /**
   * Runs before the sheet is rasterised. Returning false aborts the export, so
   * a caller can insist that the day is saved before a PDF can be produced.
   */
  beforeExport?: () => Promise<boolean>;
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      if (beforeExport && !(await beforeExport())) return;
      const blob = await buildPdfBlob(targetId, format, orientation);

      if (mode === "share") {
        const file = new File([blob], fileName, { type: "application/pdf" });
        const canShare =
          typeof navigator !== "undefined" &&
          typeof navigator.canShare === "function" &&
          navigator.canShare({ files: [file] });

        if (canShare) {
          await navigator.share({ files: [file], title: fileName });
          return;
        }
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast.success("PDF ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not build the PDF";
      if (message.toLowerCase().includes("abort")) return;
      toast.error(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      onClick={run}
      disabled={busy}
    >
      {busy ? (
        <Loader2Icon className="animate-spin" />
      ) : mode === "share" ? (
        <Share2Icon />
      ) : (
        <DownloadIcon />
      )}
      {label}
    </Button>
  );
}
