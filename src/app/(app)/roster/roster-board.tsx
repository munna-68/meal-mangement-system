"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { GripVerticalIcon, Wand2Icon } from "lucide-react";
import { cn } from "cn";

import { DutyEditor } from "@/components/duty-editor";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { autoAssignRoster, swapDutyDays } from "@/server/actions/bazar";

export interface RosterDay {
  date: string;
  label: string;
  isToday: boolean;
  roomIds: string[];
  roomNumbers: string[];
  khalaDidShopping: boolean;
  note: string | null;
}

export interface RosterRoom {
  id: string;
  number: string;
  typeLabel: string;
}

export function RosterBoard({
  month,
  days,
  rooms,
}: {
  month: string;
  days: RosterDay[];
  rooms: RosterRoom[];
}) {
  const [pending, startTransition] = useTransition();
  const [startDate, setStartDate] = useState(
    days.find((day) => day.isToday)?.date ?? days[0]?.date ?? "",
  );
  const [startRoomId, setStartRoomId] = useState(rooms[0]?.id ?? "");
  const [dragDate, setDragDate] = useState<string | null>(null);
  const [overDate, setOverDate] = useState<string | null>(null);

  function fillMonth() {
    if (!startRoomId) {
      toast.error("Pick the room whose turn it is first.");
      return;
    }
    startTransition(async () => {
      const result = await autoAssignRoster({ month, startDate, startRoomId });
      if (result.ok) toast.success(result.message ?? "Roster filled");
      else toast.error(result.error ?? "Could not fill the roster");
    });
  }

  function swap(from: string, to: string) {
    if (from === to) return;
    startTransition(async () => {
      const result = await swapDutyDays({ dateA: from, dateB: to });
      if (result.ok) toast.success("Duty swapped");
      else toast.error(result.error ?? "Could not swap the duty");
    });
  }

  return (
    <>
      <section className="mb-3 rounded-xl border bg-card p-3 shadow-sm">
        <div className="flex items-start gap-2">
          <Wand2Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h2 className="font-heading text-sm font-semibold">
              Fill the month in sequence
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Pick the date and the room whose turn it is. Every following day
              takes the next room in order; single rooms are paired with the next
              single room, so each day has someone who can shop.
            </p>

            <div className="mt-3 flex flex-wrap items-end gap-3">
              <div className="flex w-40 flex-col gap-2">
                <Label htmlFor="roster-start-date">Start date</Label>
                <Input
                  id="roster-start-date"
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </div>
              <div className="flex w-52 flex-col gap-2">
                <Label htmlFor="roster-start-room">Starts with</Label>
                <Select value={startRoomId} onValueChange={setStartRoomId}>
                  <SelectTrigger id="roster-start-room" className="w-full">
                    <SelectValue placeholder="Pick a room" />
                  </SelectTrigger>
                  <SelectContent>
                    {rooms.map((room) => (
                      <SelectItem key={room.id} value={room.id}>
                        Room {room.number} ({room.typeLabel})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={fillMonth} disabled={pending}>
                <Wand2Icon />
                {pending ? "Working…" : "Fill to month end"}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <Alert className="mb-3">
        <GripVerticalIcon />
        <AlertDescription className="text-xs">
          To move a turn, drag one day&rsquo;s row onto another — the two days swap
          rooms. Use <strong>Change duty</strong> for anything finer, like marking
          a Khala shopping day.
        </AlertDescription>
      </Alert>

      <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <div className="divide-y">
          {days.map((day) => {
            const isDragSource = dragDate === day.date;
            const isDropTarget = overDate === day.date && dragDate !== day.date;

            return (
              <div
                key={day.date}
                draggable
                onDragStart={(event) => {
                  setDragDate(day.date);
                  event.dataTransfer.effectAllowed = "move";
                  // Firefox needs data set for a drag to start at all.
                  event.dataTransfer.setData("text/plain", day.date);
                }}
                onDragEnd={() => {
                  setDragDate(null);
                  setOverDate(null);
                }}
                onDragOver={(event) => {
                  if (!dragDate || dragDate === day.date) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = "move";
                  setOverDate(day.date);
                }}
                onDragLeave={() => {
                  setOverDate((current) => (current === day.date ? null : current));
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const from =
                    dragDate ?? event.dataTransfer.getData("text/plain");
                  setOverDate(null);
                  setDragDate(null);
                  if (from) swap(from, day.date);
                }}
                className={cn(
                  "flex flex-wrap items-center justify-between gap-2 px-3 py-2.5",
                  "cursor-grab active:cursor-grabbing",
                  day.isToday && "bg-primary/5",
                  isDragSource && "opacity-40",
                  isDropTarget && "bg-amber-100/70 ring-2 ring-inset ring-amber-400",
                )}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <GripVerticalIcon className="size-4 shrink-0 text-muted-foreground/60" />
                  <span
                    className={cn(
                      "w-24 shrink-0 text-sm tabular-nums",
                      day.isToday ? "font-semibold" : "text-muted-foreground",
                    )}
                  >
                    {day.label}
                  </span>
                  <span className="text-sm">
                    {day.khalaDidShopping ? (
                      <span className="font-medium">Khala did the shopping</span>
                    ) : day.roomNumbers.length > 0 ? (
                      <span className="font-medium">
                        {day.roomNumbers.map((room) => `Room ${room}`).join(" + ")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Not assigned</span>
                    )}
                  </span>
                  {day.note ? (
                    <span className="text-xs text-muted-foreground">
                      — {day.note}
                    </span>
                  ) : null}
                </div>
                <DutyEditor
                  date={day.date}
                  rooms={rooms.map((room) => ({
                    id: room.id,
                    number: room.number,
                  }))}
                  selectedRoomIds={day.roomIds}
                  khalaDidShopping={day.khalaDidShopping}
                  note={day.note}
                />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
