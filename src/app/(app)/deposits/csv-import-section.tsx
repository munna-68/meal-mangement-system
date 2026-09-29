"use client";

import { useMemo, useState, useTransition } from "react";
import { ClipboardIcon, DownloadIcon, UploadIcon } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Textarea,
} from "@/components/ui/textarea";
import { aiBookPrompt, parseCsvImport, resolveMember } from "@/lib/import-csv";
import { formatTaka } from "@/lib/money";
import { bulkImportRows } from "@/server/actions/import";
import type { ImportIssue } from "@/server/actions/import";

export interface ImportMemberOption {
  id: string;
  name: string;
  roomNumber: string;
}

type Kind = "deposit" | "opening";

/**
 * Bulk deposit / opening-balance entry from a pasted CSV.
 *
 * The manager photographs the paper book, has a multimodal model read it into
 * CSV (the "Copy prompt" button supplies the instructions), and pastes the
 * result here. The pasted rows are previewed with per-row match status before
 * anything is written, and the server re-resolves every name so a stray row can
 * never post against the wrong person.
 */
export function CsvImportSection({
  members,
  today,
  openMonth,
}: {
  members: ImportMemberOption[];
  today: string;
  openMonth: string;
}) {
  const [kind, setKind] = useState<Kind>("deposit");
  const [pasted, setPasted] = useState("");
  const [date, setDate] = useState(today);
  const [month, setMonth] = useState(openMonth);
  const [issues, setIssues] = useState<ImportIssue[]>([]);
  const [pending, startTransition] = useTransition();

  const parsed = useMemo(() => parseCsvImport(pasted), [pasted]);

  // Preview status per row, resolved client-side for instant feedback. The
  // server resolves independently on submit; this is only the dry run.
  const preview = useMemo(() => {
    return parsed.rows.map((row) => {
      if (row.problem) {
        return { row, match: null as ReturnType<typeof resolveMember> | null };
      }
      const match = resolveMember(row.name, row.room, members);
      return { row, match };
    });
  }, [parsed.rows, members]);

  const readyRows = preview.filter(
    (entry) => !entry.row.problem && entry.match?.ok,
  );
  const skippedRows = preview.filter(
    (entry) => entry.row.problem || !entry.match?.ok,
  );
  const readyTotal = readyRows.reduce((sum, entry) => sum + (entry.row.amount ?? 0), 0);

  function copyPrompt() {
    navigator.clipboard
      .writeText(aiBookPrompt())
      .then(() => toast.success("Prompt copied — paste it with your book photos"))
      .catch(() => toast.error("Could not copy. Select the text and copy manually."));
  }

  function downloadTemplate() {
    const lines = ["name,room,amount"];
    for (const member of members) {
      lines.push(`${member.name},${member.roomNumber},`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "opening-balances-template.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  function runImport() {
    setIssues([]);
    startTransition(async () => {
      const result = await bulkImportRows({
        kind,
        month: kind === "opening" ? month : undefined,
        date: kind === "deposit" ? date : undefined,
        rows: readyRows.map((entry) => ({
          line: entry.row.line,
          name: entry.row.name,
          room: entry.row.room,
          amount: entry.row.amount ?? 0,
          date: entry.row.date ?? "",
          notes: entry.row.notes,
        })),
      });
      if (result.ok) {
        toast.success(result.message ?? "Imported");
        setPasted("");
        setIssues(result.issues ?? []);
      } else {
        toast.error(result.error ?? "Import failed");
        setIssues(result.issues ?? []);
      }
    });
  }

  return (
    <section className="rounded-xl border bg-card shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <div>
          <h2 className="font-heading text-sm font-semibold">
            Import from CSV
          </h2>
          <p className="text-xs text-muted-foreground">
            Photograph the paper book, have a multimodal model read it into CSV,
            then paste it here. Each row is matched to a member by name (room
            breaks ties) and previewed before anything is saved.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={copyPrompt}>
            <ClipboardIcon className="size-4" />
            Copy AI prompt
          </Button>
          <Button variant="outline" size="sm" onClick={downloadTemplate}>
            <DownloadIcon className="size-4" />
            Blank CSV
          </Button>
        </div>
      </header>

      <div className="grid gap-3 border-b p-4 lg:grid-cols-[auto_1fr_1fr] lg:items-end">
        <div className="flex flex-col gap-2">
          <Label>Import as</Label>
          <div className="flex rounded-lg border p-0.5">
            <button
              type="button"
              onClick={() => setKind("deposit")}
              className={
                kind === "deposit"
                  ? "rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                  : "rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground"
              }
            >
              Deposits
            </button>
            <button
              type="button"
              onClick={() => setKind("opening")}
              className={
                kind === "opening"
                  ? "rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground"
                  : "rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground"
              }
            >
              Opening balances
            </button>
          </div>
        </div>
        {kind === "deposit" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="import-date">Default date</Label>
            <Input
              id="import-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Used for any row without its own date.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="import-month">Month</Label>
            <Input
              id="import-month"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Opening balances apply to the whole month for every row.
            </p>
          </div>
        )}
        <div />
      </div>

      <div className="grid gap-3 p-4 lg:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="import-csv">Paste CSV</Label>
          <Textarea
            id="import-csv"
            value={pasted}
            onChange={(event) => setPasted(event.target.value)}
            rows={12}
            placeholder={
              parsed.headerDetected
                ? "name,room,amount\nRahim,101,1500\nKarim,102,1200"
                : "Paste the CSV here — a name,room,amount header is detected automatically."
            }
            className="font-mono text-xs"
          />
        </div>

        <div className="flex flex-col gap-3">
          <div className="rounded-lg border">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <h3 className="text-xs font-semibold">
                Preview · {readyRows.length} ready
                {skippedRows.length > 0 ? `, ${skippedRows.length} skipped` : ""}
              </h3>
              <span className="text-xs font-semibold tabular-nums">
                {formatTaka(readyTotal)}
              </span>
            </div>
            <div className="max-h-72 overflow-y-auto">
              {preview.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  Paste some rows to preview them here.
                </p>
              ) : (
                <table className="w-full text-xs">
                  <tbody>
                    {preview.map((entry, index) => {
                      const problem = entry.row.problem;
                      const matchProblem = !problem && entry.match && !entry.match.ok
                        ? entry.match.reason === "ambiguous"
                          ? "ambiguous name"
                          : "no matching member"
                        : null;
                      const bad = Boolean(problem || matchProblem);
                      return (
                        <tr
                          key={`${entry.row.line}-${index}`}
                          className={bad ? "bg-red-50/70" : undefined}
                        >
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {entry.row.line}
                          </td>
                          <td className="px-3 py-1.5 font-medium">
                            {entry.row.name || "—"}
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {entry.row.room || "—"}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {entry.row.amount === null
                              ? "—"
                              : formatTaka(entry.row.amount)}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            {problem ? (
                              <span className="text-red-700">{problem}</span>
                            ) : matchProblem ? (
                              <span className="text-red-700">{matchProblem}</span>
                            ) : (
                              <span className="text-emerald-700">ready</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <Button
            onClick={runImport}
            disabled={pending || readyRows.length === 0}
            className="w-fit"
          >
            <UploadIcon className="size-4" />
            {kind === "deposit" ? "Import deposits" : "Import opening balances"} (
            {readyRows.length})
          </Button>

          {issues.length > 0 ? (
            <div className="rounded-lg border border-red-200 bg-red-50/70 p-3 text-xs text-red-800">
              <p className="mb-1 font-semibold">Skipped rows</p>
              <ul className="space-y-0.5">
                {issues.map((issue, index) => (
                  <li key={index}>
                    Line {issue.line}: {issue.name} — {issue.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
