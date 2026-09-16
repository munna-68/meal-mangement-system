"use client";

import { useState } from "react";
import { PencilIcon, PlusIcon, TrashIcon } from "lucide-react";

import { useAction } from "@/components/use-action";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { todayKey } from "@/lib/dates";
import {
  createMember,
  createRoom,
  deleteMember,
  deleteRoom,
  updateMember,
  updateRoom,
} from "@/server/actions/people";

export interface RoomRecord {
  id: string;
  number: string;
  capacity: number;
  notes: string | null;
  occupants: number;
}

export interface MemberRecord {
  id: string;
  name: string;
  roomId: string;
  roomNumber: string;
  phone: string | null;
  bloodGroup: string | null;
  active: boolean;
  joinDate: string;
  leaveDate: string | null;
  notes: string | null;
}

export function MembersClient({
  rooms,
  members,
}: {
  rooms: RoomRecord[];
  members: MemberRecord[];
}) {
  const [roomDialog, setRoomDialog] = useState<{ open: boolean; room: RoomRecord | null }>(
    { open: false, room: null },
  );
  const [memberDialog, setMemberDialog] = useState<{
    open: boolean;
    member: MemberRecord | null;
  }>({ open: false, member: null });

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border bg-card shadow-sm">
        <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <h2 className="font-heading text-sm font-semibold">Rooms</h2>
            <p className="text-xs text-muted-foreground">
              Capacity drives the electricity and Khala split.
            </p>
          </div>
          <Button size="sm" onClick={() => setRoomDialog({ open: true, room: null })}>
            <PlusIcon />
            Add room
          </Button>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Room</th>
                <th className="px-4 py-2 text-left font-medium">Capacity</th>
                <th className="px-4 py-2 text-left font-medium">Occupants</th>
                <th className="px-4 py-2 text-left font-medium">Notes</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => (
                <tr key={room.id} className="border-t">
                  <td className="px-4 py-2 font-medium">{room.number}</td>
                  <td className="px-4 py-2">{room.capacity}</td>
                  <td className="px-4 py-2">
                    {room.occupants}
                    {room.capacity >= 2 && room.occupants === 1 ? (
                      <Badge variant="outline" className="ml-2 border-amber-400 text-amber-700">
                        solo
                      </Badge>
                    ) : null}
                    {room.occupants > room.capacity ? (
                      <Badge variant="destructive" className="ml-2">
                        over capacity
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">
                    {room.notes ?? "—"}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Edit room ${room.number}`}
                        onClick={() => setRoomDialog({ open: true, room })}
                      >
                        <PencilIcon />
                      </Button>
                      <DeleteButton
                        title={`Delete room ${room.number}?`}
                        description="Only empty rooms can be deleted."
                        onConfirm={() => deleteRoom(room.id)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {rooms.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted-foreground">
                    No rooms yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-xl border bg-card shadow-sm">
        <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div>
            <h2 className="font-heading text-sm font-semibold">Members</h2>
            <p className="text-xs text-muted-foreground">
              {members.filter((m) => m.active).length} active of {members.length}
            </p>
          </div>
          <Button size="sm" onClick={() => setMemberDialog({ open: true, member: null })}>
            <PlusIcon />
            Add member
          </Button>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Room</th>
                <th className="px-4 py-2 text-left font-medium">Name</th>
                <th className="px-4 py-2 text-left font-medium">Phone</th>
                <th className="px-4 py-2 text-left font-medium">Blood</th>
                <th className="px-4 py-2 text-left font-medium">Joined</th>
                <th className="px-4 py-2 text-left font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.id} className="border-t">
                  <td className="px-4 py-2 tabular-nums">{member.roomNumber}</td>
                  <td className="px-4 py-2 font-medium">{member.name}</td>
                  <td className="px-4 py-2 tabular-nums">{member.phone ?? "—"}</td>
                  <td className="px-4 py-2">{member.bloodGroup ?? "—"}</td>
                  <td className="px-4 py-2 tabular-nums text-muted-foreground">
                    {member.joinDate}
                  </td>
                  <td className="px-4 py-2">
                    {member.active ? (
                      <Badge variant="outline" className="border-emerald-400 text-emerald-700">
                        active
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-muted-foreground">
                        left {member.leaveDate ?? ""}
                      </Badge>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Edit ${member.name}`}
                        onClick={() => setMemberDialog({ open: true, member })}
                      >
                        <PencilIcon />
                      </Button>
                      <DeleteButton
                        title={`Delete ${member.name}?`}
                        description="Members with closed months on record cannot be deleted — mark them inactive instead."
                        onConfirm={() => deleteMember(member.id)}
                      />
                    </div>
                  </td>
                </tr>
              ))}
              {members.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">
                    No members yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <RoomDialog
        key={roomDialog.room?.id ?? "new-room"}
        open={roomDialog.open}
        room={roomDialog.room}
        onOpenChange={(open) => setRoomDialog({ open, room: open ? roomDialog.room : null })}
      />
      <MemberDialog
        key={memberDialog.member?.id ?? "new-member"}
        open={memberDialog.open}
        member={memberDialog.member}
        rooms={rooms}
        onOpenChange={(open) =>
          setMemberDialog({ open, member: open ? memberDialog.member : null })
        }
      />
    </div>
  );
}

function DeleteButton({
  title,
  description,
  onConfirm,
}: {
  title: string;
  description: string;
  onConfirm: () => Promise<{ ok: boolean; error?: string; message?: string }>;
}) {
  const { run } = useAction();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label={title}>
          <TrashIcon />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              run(onConfirm);
            }}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function RoomDialog({
  open,
  room,
  onOpenChange,
}: {
  open: boolean;
  room: RoomRecord | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { run, pending, error } = useAction();
  const [number, setNumber] = useState(room?.number ?? "");
  const [capacity, setCapacity] = useState(String(room?.capacity ?? 2));
  const [notes, setNotes] = useState(room?.notes ?? "");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{room ? "Edit room" : "Add room"}</DialogTitle>
          <DialogDescription>
            Capacity is 1 or 2. A member alone in a 2-capacity room pays double
            for electricity and the solo Khala rate.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="room-number">Room number</Label>
            <Input
              id="room-number"
              value={number}
              onChange={(event) => setNumber(event.target.value)}
              placeholder="e.g. 107"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="room-capacity">Capacity</Label>
            <Select value={capacity} onValueChange={setCapacity}>
              <SelectTrigger id="room-capacity" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 person</SelectItem>
                <SelectItem value="2">2 people</SelectItem>
                <SelectItem value="3">3 people</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="room-notes">Notes</Label>
            <Input
              id="room-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              run(
                () =>
                  room
                    ? updateRoom({
                        id: room.id,
                        number,
                        capacity: Number(capacity),
                        notes,
                      })
                    : createRoom({ number, capacity: Number(capacity), notes }),
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            {room ? "Save changes" : "Add room"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MemberDialog({
  open,
  member,
  rooms,
  onOpenChange,
}: {
  open: boolean;
  member: MemberRecord | null;
  rooms: RoomRecord[];
  onOpenChange: (open: boolean) => void;
}) {
  const { run, pending, error } = useAction();
  const [name, setName] = useState(member?.name ?? "");
  const [roomId, setRoomId] = useState(member?.roomId ?? rooms[0]?.id ?? "");
  const [phone, setPhone] = useState(member?.phone ?? "");
  const [bloodGroup, setBloodGroup] = useState(member?.bloodGroup ?? "");
  const [active, setActive] = useState(member?.active ?? true);
  const [joinDate, setJoinDate] = useState(member?.joinDate ?? todayKey());
  const [leaveDate, setLeaveDate] = useState(member?.leaveDate ?? "");
  const [notes, setNotes] = useState(member?.notes ?? "");

  const payload = {
    name,
    roomId,
    phone,
    bloodGroup,
    active,
    joinDate,
    leaveDate,
    notes,
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{member ? `Edit ${member.name}` : "Add member"}</DialogTitle>
          <DialogDescription>
            Inactive members stop accruing daily costs but keep their history and
            final balance.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[60vh] gap-3 overflow-y-auto py-2 sm:grid-cols-2">
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="member-name">Name</Label>
            <Input
              id="member-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Uzzal"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="member-room">Room</Label>
            <Select value={roomId} onValueChange={setRoomId}>
              <SelectTrigger id="member-room" className="w-full">
                <SelectValue placeholder="Pick a room" />
              </SelectTrigger>
              <SelectContent>
                {rooms.map((room) => (
                  <SelectItem key={room.id} value={room.id}>
                    Room {room.number} (cap {room.capacity})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="member-blood">Blood group</Label>
            <Input
              id="member-blood"
              value={bloodGroup}
              onChange={(event) => setBloodGroup(event.target.value)}
              placeholder="e.g. O+"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="member-phone">Phone</Label>
            <Input
              id="member-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="e.g. 01570210744"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="member-join">Join date</Label>
            <Input
              id="member-join"
              type="date"
              value={joinDate}
              onChange={(event) => setJoinDate(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="member-leave">Leave date (optional)</Label>
            <Input
              id="member-leave"
              type="date"
              value={leaveDate}
              onChange={(event) => setLeaveDate(event.target.value)}
            />
          </div>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2">
            <Label htmlFor="member-active" className="text-sm">
              Active member
            </Label>
            <Switch id="member-active" checked={active} onCheckedChange={setActive} />
          </div>
          <div className="flex flex-col gap-2 sm:col-span-2">
            <Label htmlFor="member-notes">Notes</Label>
            <Textarea
              id="member-notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
          {error ? (
            <p className="text-sm text-destructive sm:col-span-2">{error}</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending || !roomId}
            onClick={() =>
              run(
                () =>
                  member
                    ? updateMember({ id: member.id, ...payload })
                    : createMember(payload),
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            {member ? "Save changes" : "Add member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
