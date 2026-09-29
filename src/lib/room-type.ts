/**
 * Room types.
 *
 * A room's shape is two facts, not one: how many beds it has (`capacity`) and
 * whether it is let out whole to a single person (`solo`, a "special" room such
 * as a double that one person occupies). The Add/Edit room form offers them as
 * one list because that is how a manager thinks about the room — "a double" or
 * "a special double" — but the two facts are stored separately so each can be
 * read on its own.
 *
 * `solo` is only meaningful for multi-bed rooms, so this module never offers it
 * for a single.
 */

export interface RoomType {
  /** Beds in the room. */
  capacity: number;
  /** Let out whole to one person; pays the solo rate while alone in it. */
  solo: boolean;
}

export const ROOM_TYPES: readonly RoomType[] = [
  { capacity: 1, solo: false },
  { capacity: 2, solo: false },
  { capacity: 3, solo: false },
  { capacity: 2, solo: true },
  { capacity: 3, solo: true },
] as const;

export function roomTypeValue(room: { capacity: number; solo?: boolean }): string {
  return room.solo ? `${room.capacity}-solo` : String(room.capacity);
}

/** Parses a `<capacity>` / `<capacity>-solo` form value. */
export function parseRoomTypeValue(
  value: string,
): { capacity: number; solo: boolean } | null {
  const match = /^(\d{1,2})(-solo)?$/.exec(value.trim());
  if (!match) return null;
  const capacity = Number(match[1]);
  if (!Number.isInteger(capacity) || capacity < 1) return null;
  // A one-bed room has nobody to be "alone in a shared room", so the flag is
  // meaningless there and is dropped rather than stored misleadingly.
  return { capacity, solo: match[2] === "-solo" && capacity >= 2 };
}

export function roomTypeLabel(room: { capacity: number; solo?: boolean }): string {
  const { capacity, solo } = room;
  const base =
    capacity <= 1 ? "single" : capacity === 2 ? "double" : capacity === 3 ? "triple" : `${capacity} beds`;
  return solo ? `solo ${base}` : base;
}

/** Long form for the type dropdown, where the difference has to be obvious. */
export function roomTypeDescription(room: { capacity: number; solo?: boolean }): string {
  const { capacity, solo } = room;
  if (capacity <= 1) return "Single — 1 person";
  if (solo) {
    return capacity === 3
      ? "Special — 1 person in a triple room"
      : "Special — 1 person in a double room";
  }
  if (capacity === 2) return "Double — 2 people";
  if (capacity === 3) return "Triple — 3 people";
  return `${capacity} beds`;
}
