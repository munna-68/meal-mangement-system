"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarClockIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { saveBazarDuty } from "@/server/actions/bazar";

export interface DutyEditorRoom {
  id: string;
  number: string;
}

export function DutyEditor({
  date,
  rooms,
  selectedRoomIds,
  khalaDidShopping,
  note,
}: {
  date: string;
  rooms: DutyEditorRoom[];
  selectedRoomIds: string[];
  khalaDidShopping: boolean;
  note: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(selectedRoomIds);
  const [khala, setKhala] = useState(khalaDidShopping);
  const [dutyNote, setDutyNote] = useState(note ?? "");
  const [pending, startTransition] = useTransition();

  function toggleRoom(roomId: string) {
    setSelected((current) => {
      if (current.includes(roomId)) {
        return current.filter((id) => id !== roomId);
      }
      if (current.length >= 2) {
        toast.info("At most two rooms can share one day.");
        return current;
      }
      return [...current, roomId];
    });
  }

  function save() {
    startTransition(async () => {
      const result = await saveBazarDuty({
        date,
        roomIds: selected,
        khalaDidShopping: khala,
        note: dutyNote,
      });
      if (result.ok) {
        toast.success(result.message ?? "Duty saved");
        setOpen(false);
      } else {
        toast.error(result.error ?? "Could not save the duty");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarClockIcon />
          {selectedRoomIds.length > 0 || khalaDidShopping ? "Change duty" : "Assign duty"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Bazar duty</DialogTitle>
          <DialogDescription>
            Pick the room on shopping duty today. Up to two rooms can share a day,
            or mark that the Khala did the market run.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-72 flex-col gap-3 overflow-y-auto py-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {rooms.map((room) => {
              const checked = selected.includes(room.id);
              return (
                <label
                  key={room.id}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-2 text-sm"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleRoom(room.id)}
                  />
                  Room {room.number}
                </label>
              );
            })}
          </div>

          <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
            <div>
              <Label htmlFor="khala-shopping" className="text-sm font-medium">
                Khala did the shopping instead
              </Label>
              <p className="text-[11px] text-muted-foreground">
                No member is on duty for this day.
              </p>
            </div>
            <Switch
              id="khala-shopping"
              checked={khala}
              onCheckedChange={setKhala}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="duty-note">Note (optional)</Label>
            <Input
              id="duty-note"
              value={dutyNote}
              onChange={(event) => setDutyNote(event.target.value)}
              placeholder="e.g. combined because 103 is away"
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={save} disabled={pending}>
            Save duty
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
