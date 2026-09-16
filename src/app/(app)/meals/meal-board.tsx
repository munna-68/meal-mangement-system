"use client";

import { useOptimistic, useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckIcon, MinusIcon, PlusIcon, UsersIcon } from "lucide-react";

import { cn } from "cn";

import { Button } from "@/components/ui/button";
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
import { GuestBadge, MEAL_STATUS_META } from "@/components/meal-status";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  setGuestMeal,
  setMealStatus,
  setMealStatusForMembers,
  setSehri,
} from "@/server/actions/meals";
import type { MealStatus } from "@/lib/calc";

export interface BoardMember {
  id: string;
  name: string;
  bloodGroup: string | null;
  phone: string | null;
  active: boolean;
  status: MealStatus;
  sehri: boolean;
  guestFull: number;
  guestHalf: number;
}

export interface BoardRoom {
  id: string;
  number: string;
  capacity: number;
  members: BoardMember[];
}

type Patch =
  | { kind: "status"; memberId: string; status: MealStatus }
  | { kind: "sehri"; memberId: string; sehri: boolean }
  | { kind: "guest"; memberId: string; guestFull: number; guestHalf: number }
  | { kind: "roomStatus"; roomId: string; status: MealStatus }
  | { kind: "allStatus"; status: MealStatus };

function applyPatch(rooms: BoardRoom[], patch: Patch): BoardRoom[] {
  switch (patch.kind) {
    case "status":
      return rooms.map((room) => ({
        ...room,
        members: room.members.map((member) =>
          member.id === patch.memberId ? { ...member, status: patch.status } : member,
        ),
      }));
    case "sehri":
      return rooms.map((room) => ({
        ...room,
        members: room.members.map((member) =>
          member.id === patch.memberId ? { ...member, sehri: patch.sehri } : member,
        ),
      }));
    case "guest":
      return rooms.map((room) => ({
        ...room,
        members: room.members.map((member) =>
          member.id === patch.memberId
            ? {
                ...member,
                guestFull: patch.guestFull,
                guestHalf: patch.guestHalf,
              }
            : member,
        ),
      }));
    case "roomStatus":
      return rooms.map((room) =>
        room.id === patch.roomId
          ? {
              ...room,
              members: room.members.map((member) => ({
                ...member,
                status: patch.status,
              })),
            }
          : room,
      );
    case "allStatus":
      return rooms.map((room) => ({
        ...room,
        members: room.members.map((member) => ({ ...member, status: patch.status })),
      }));
  }
}

const STATUS_ORDER: MealStatus[] = ["FULL", "HALF_DAY", "HALF_NIGHT", "OFF"];

export function MealBoard({
  date,
  rooms,
  ramadanMode,
}: {
  date: string;
  rooms: BoardRoom[];
  ramadanMode: boolean;
}) {
  const [optimisticRooms, applyOptimistic] = useOptimistic(rooms, applyPatch);
  const [, startTransition] = useTransition();
  const [guestTarget, setGuestTarget] = useState<BoardMember | null>(null);

  function run(patch: Patch, action: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    startTransition(async () => {
      applyOptimistic(patch);
      const result = await action();
      if (!result.ok) {
        toast.error(result.error ?? "Something went wrong");
      }
    });
  }

  function onStatus(member: BoardMember, status: MealStatus) {
    if (member.status === status) return;
    run({ kind: "status", memberId: member.id, status }, () =>
      setMealStatus({ memberId: member.id, date, status }),
    );
  }

  function onSehri(member: BoardMember, sehri: boolean) {
    run({ kind: "sehri", memberId: member.id, sehri }, () =>
      setSehri({ memberId: member.id, date, sehri }),
    );
  }

  function onRoomStatus(room: BoardRoom, status: MealStatus) {
    const memberIds = room.members.map((m) => m.id);
    if (memberIds.length === 0) return;
    run({ kind: "roomStatus", roomId: room.id, status }, () =>
      setMealStatusForMembers({ memberIds, date, status }),
    );
  }

  function onAllStatus(status: MealStatus) {
    const memberIds = optimisticRooms.flatMap((room) =>
      room.members.map((member) => member.id),
    );
    if (memberIds.length === 0) return;
    run({ kind: "allStatus", status }, () =>
      setMealStatusForMembers({ memberIds, date, status }),
    );
  }

  function onGuest(member: BoardMember, guestFull: number, guestHalf: number) {
    run({ kind: "guest", memberId: member.id, guestFull, guestHalf }, async () => {
      const results = await Promise.all([
        setGuestMeal({ memberId: member.id, date, type: "GUEST_FULL", count: guestFull }),
        setGuestMeal({ memberId: member.id, date, type: "GUEST_HALF", count: guestHalf }),
      ]);
      return results.find((r) => !r.ok) ?? { ok: true };
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Set everyone:
        </span>
        {STATUS_ORDER.map((status) => {
          const meta = MEAL_STATUS_META[status];
          const Icon = meta.Icon;
          return (
            <Button
              key={status}
              size="sm"
              variant="outline"
              onClick={() => onAllStatus(status)}
            >
              <Icon className={cn("size-3.5", meta.text)} />
              {meta.short}
            </Button>
          );
        })}
      </div>

      {optimisticRooms.map((room) => (
        <section
          key={room.id}
          className="overflow-hidden rounded-xl border bg-card shadow-sm"
        >
          <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
            <div className="flex items-center gap-2">
              <span className="font-heading text-sm font-semibold">
                Room {room.number}
              </span>
              <span className="text-xs text-muted-foreground">
                {room.members.length}/{room.capacity}
              </span>
              {room.members.length === 1 && room.capacity >= 2 ? (
                <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
                  Solo — solo Khala rate
                </span>
              ) : null}
            </div>
            <Button
              size="xs"
              variant="outline"
              onClick={() => onRoomStatus(room, "FULL")}
            >
              <CheckIcon className="size-3" />
              All full
            </Button>
          </header>

          <ul className="divide-y">
            {room.members.map((member) => (
              <li
                key={member.id}
                className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:flex-nowrap"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{member.name}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {[member.bloodGroup, member.phone].filter(Boolean).join(" · ") ||
                      "—"}
                  </p>
                </div>

                <div
                  role="group"
                  aria-label={`Meal status for ${member.name}`}
                  className="flex items-center gap-1"
                >
                  {STATUS_ORDER.map((status) => {
                    const meta = MEAL_STATUS_META[status];
                    const Icon = meta.Icon;
                    const selected = member.status === status;
                    return (
                      <button
                        key={status}
                        type="button"
                        onClick={() => onStatus(member, status)}
                        aria-pressed={selected}
                        title={`${meta.label} — ${meta.hint}`}
                        className={cn(
                          "flex size-9 items-center justify-center rounded-lg border transition-colors",
                          selected
                            ? cn(meta.solid, "border-transparent")
                            : "border-border bg-background text-muted-foreground hover:bg-muted",
                        )}
                      >
                        <Icon className="size-4" />
                        <span className="sr-only">{meta.label}</span>
                      </button>
                    );
                  })}
                </div>

                {ramadanMode ? (
                  <div className="flex items-center gap-1.5">
                    <Switch
                      id={`sehri-${member.id}`}
                      checked={member.sehri}
                      onCheckedChange={(checked) => onSehri(member, checked)}
                    />
                    <Label
                      htmlFor={`sehri-${member.id}`}
                      className="text-xs text-muted-foreground"
                    >
                      Sehri
                    </Label>
                  </div>
                ) : null}

                <div className="flex items-center gap-2">
                  <GuestBadge full={member.guestFull} half={member.guestHalf} />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setGuestTarget(member)}
                  >
                    <UsersIcon className="size-3.5" />
                    Guest
                  </Button>
                </div>
              </li>
            ))}
            {room.members.length === 0 ? (
              <li className="px-3 py-3 text-sm text-muted-foreground">
                No members in this room.
              </li>
            ) : null}
          </ul>
        </section>
      ))}

      {guestTarget ? (
        <GuestDialog
          key={guestTarget.id}
          member={guestTarget}
          onClose={() => setGuestTarget(null)}
          onSave={(member, full, half) => {
            onGuest(member, full, half);
            setGuestTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}

function GuestDialog({
  member,
  onClose,
  onSave,
}: {
  member: BoardMember;
  onClose: () => void;
  onSave: (member: BoardMember, guestFull: number, guestHalf: number) => void;
}) {
  const [full, setFull] = useState(member.guestFull);
  const [half, setHalf] = useState(member.guestHalf);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Guest meals — {member.name}</DialogTitle>
          <DialogDescription>
            Guest meals are charged on top of {member.name}&rsquo;s own status and never
            change it.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <Counter
            label="Guest Full meal"
            value={full}
            onChange={setFull}
            rateHint="priced at the guest full rate"
          />
          <Counter
            label="Guest Half meal"
            value={half}
            onChange={setHalf}
            rateHint="priced at the guest half rate"
          />
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={() => onSave(member, full, half)}>Save guest meals</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Counter({
  label,
  value,
  onChange,
  rateHint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  rateHint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
      <div>
        <p className="text-sm font-medium">{label}</p>
        {rateHint ? (
          <p className="text-[11px] text-muted-foreground">{rateHint}</p>
        ) : null}
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="icon"
          variant="outline"
          aria-label={`Decrease ${label}`}
          disabled={value <= 0}
          onClick={() => onChange(Math.max(0, value - 1))}
        >
          <MinusIcon />
        </Button>
        <span className="w-6 text-center text-base font-semibold tabular-nums">
          {value}
        </span>
        <Button
          size="icon"
          variant="outline"
          aria-label={`Increase ${label}`}
          onClick={() => onChange(Math.min(20, value + 1))}
        >
          <PlusIcon />
        </Button>
      </div>
    </div>
  );
}
