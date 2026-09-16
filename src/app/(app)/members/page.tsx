import type { Metadata } from "next";

import { PageHeader } from "@/components/page-header";
import { requireSession } from "@/server/auth";
import { getMembersWithRooms, getRooms } from "@/server/queries";
import { MembersClient, type MemberRecord, type RoomRecord } from "./members-client";

export const metadata: Metadata = { title: "Members & Rooms" };

export default async function MembersPage() {
  await requireSession();

  const [rooms, members] = await Promise.all([getRooms(), getMembersWithRooms()]);

  const roomRecords: RoomRecord[] = rooms.map((room) => ({
    id: room.id,
    number: room.number,
    capacity: room.capacity,
    notes: room.notes,
    occupants: members.filter((member) => member.roomId === room.id && member.active)
      .length,
  }));

  const memberRecords: MemberRecord[] = members.map((member) => ({
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
  }));

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
