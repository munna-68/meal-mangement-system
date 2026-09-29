import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/server/auth";
import {
  getMemberHistoryLosses,
  getMembersWithRooms,
  getRooms,
} from "@/server/queries";
import { MembersClient, type MemberRecord, type RoomRecord } from "./members-client";

export const metadata: Metadata = { title: "Members & Rooms" };

export default async function MembersPage() {
  await requireSession();

  const [rooms, members, losses] = await Promise.all([
    getRooms(),
    getMembersWithRooms(),
    getMemberHistoryLosses(),
  ]);

  const roomRecords: RoomRecord[] = rooms.map((room) => ({
    id: room.id,
    number: room.number,
    capacity: room.capacity,
    solo: room.solo,
    notes: room.notes,
    occupants: members.filter((member) => member.roomId === room.id && member.active)
      .length,
  }));

  const memberRecords: MemberRecord[] = members.map((member) => {
    const loss = losses.get(member.id);
    return {
      id: member.id,
      name: member.name,
      roomId: member.roomId,
      roomNumber: member.roomNumber,
      phone: member.phone,
      bloodGroup: member.bloodGroup,
      active: member.active,
      joinDate: member.joinDate,
      leaveDate: member.leaveDate,
      notes: member.notes,
      // Deleting a member cascades to these records. Anything in a month that
      // has not been closed would silently rewrite that month, so the dialog
      // has to say exactly what is at stake.
      unclosed: {
        total: loss?.unclosedItems ?? 0,
        months: loss?.unclosedMonths ?? [],
        statusChanges: loss?.statusChanges.unclosed ?? 0,
        guestMeals: loss?.guestMeals.unclosed ?? 0,
        deposits: loss?.deposits.unclosed ?? 0,
      },
    };
  });

  return (
    <>
      <PageHeader
        title="Members & Rooms"
        description="Rooms and the people living in them. Occupancy drives the shared-bill split."
      />
      <MembersClient rooms={roomRecords} members={memberRecords} />
    </>
  );
}
