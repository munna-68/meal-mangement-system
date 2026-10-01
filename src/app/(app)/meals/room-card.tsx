import { CheckIcon, UsersIcon } from "lucide-react";

import { cn } from "cn";

import { Button } from "@/components/ui/button";
import { GuestBadge, MEAL_STATUS_META } from "@/components/meal-status";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { MealStatus } from "@/lib/calc";
import type { BoardMember, BoardRoom } from "./meal-board";

export const STATUS_ORDER: MealStatus[] = ["FULL", "HALF_DAY", "HALF_NIGHT", "OFF"];

/**
 * One note per room covering both the declared type and how the room is
 * actually billed, so the two never appear as two competing badges. A special
 * room is only solo-billed while it actually holds one person, which is the
 * part worth flagging.
 */
function roomTypeNote(room: BoardRoom): string | null {
  const special = !!room.solo && room.capacity >= 2;
  const alone = room.members.length === 1 && room.capacity >= 2;
  if (special && alone) return "Special room — solo Khala rate";
  if (special) return "Special room — shared";
  if (alone) return "Solo — solo Khala rate";
  return null;
}

/**
 * One room and its members, with every control. It takes its handlers as props
 * rather than owning them so the board and the room search can render the very
 * same card against the very same state.
 */
export function RoomCard({
  room,
  ramadanMode,
  onStatus,
  onSehri,
  onRoomStatus,
  onGuestEdit,
  controlIdPrefix = "sehri",
}: {
  room: BoardRoom;
  ramadanMode: boolean;
  onStatus: (member: BoardMember, status: MealStatus) => void;
  onSehri: (member: BoardMember, sehri: boolean) => void;
  onRoomStatus: (room: BoardRoom, status: MealStatus) => void;
  onGuestEdit: (member: BoardMember) => void;
  /** Keeps the Sehri switch ids unique when the same room is on screen twice. */
  controlIdPrefix?: string;
}) {
  return (
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="font-heading text-sm font-semibold">
            Room {room.number}
          </span>
          <span className="text-xs text-muted-foreground">
            {room.members.length}/{room.capacity}
          </span>
          {roomTypeNote(room) ? (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">
              {roomTypeNote(room)}
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
                  id={`${controlIdPrefix}-${member.id}`}
                  checked={member.sehri}
                  onCheckedChange={(checked) => onSehri(member, checked)}
                />
                <Label
                  htmlFor={`${controlIdPrefix}-${member.id}`}
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
                onClick={() => onGuestEdit(member)}
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
  );
}
