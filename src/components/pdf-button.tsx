"use client";

import { useState } from "react";
import { toast } from "sonner";
import { DownloadIcon, Loader2Icon, Share2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";

type Mode = "download" | "share";

type Format = "a5" | "a4";

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

  const imageData = canvas.toDataURL("image/png");
  const pdf = new jsPDF({ unit: "pt", format, orientation });

  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 18;
  const usableWidth = pageWidth - margin * 2;
  const usableHeight = pageHeight - margin * 2;

  // Contain: scale the sheet so it fits inside the page in BOTH directions and
  // stays centred. Fitting to width alone left the slip hugging the top of the
  // page with dead space beneath it.
  const scale = Math.min(usableWidth / canvas.width, usableHeight / canvas.height);
  const imageWidth = canvas.width * scale;
  const imageHeight = canvas.height * scale;
  const x = margin + (usableWidth - imageWidth) / 2;
  const y = margin + (usableHeight - imageHeight) / 2;

  pdf.addImage(imageData, "PNG", x, y, imageWidth, imageHeight);

  return pdf.output("blob");
}

export function PdfButton({
  targetId,
  fileName,
  label = "PDF slip",
  mode = "download",
  format = "a5",
  orientation = "portrait",
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
  variant?: "default" | "outline" | "secondary" | "ghost";
  size?: "sm" | "default" | "lg";
  className?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
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
