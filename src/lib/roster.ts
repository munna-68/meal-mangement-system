export interface RosterRoomInput {
  id: string;
  capacity: number;
}

/**
 * Splits the rooms into the units that take one day each.
 *
 * Rooms with two or more beds go alone. Single-bed rooms are paired up, because
 * one person on their own cannot cover a day's shopping. The pair takes the
 * slot where the *first* of the two appeared, so the running order still reads
 * like the room list rather than jumping to wherever the partner happened to
 * be. An odd single left over still takes its turn, alone, rather than being
 * dropped from the rotation.
 */
export function buildDutyUnits(rooms: RosterRoomInput[]): string[][] {
  const units: string[][] = [];
  let pending: { ids: string[]; at: number } | null = null;

  for (const room of rooms) {
    if (room.capacity <= 1) {
      if (!pending) {
        // Reserve this position; the partner fills it in wherever it appears.
        units.push([]);
        pending = { ids: [], at: units.length - 1 };
      }
      pending.ids.push(room.id);
      if (pending.ids.length === 2) {
        units[pending.at] = pending.ids;
        pending = null;
      }
    } else {
      units.push([room.id]);
    }
  }

  if (pending) units[pending.at] = pending.ids;

  return units.filter((unit) => unit.length > 0);
}

/**
 * Rotates the units so the one containing `startRoomId` comes first, which is
 * what makes "start from room 103" begin the month there and continue in order.
 */
export function orderUnitsFrom(
  units: string[][],
  startRoomId: string,
): string[][] | null {
  const index = units.findIndex((unit) => unit.includes(startRoomId));
  if (index < 0) return null;
  return [...units.slice(index), ...units.slice(0, index)];
}
