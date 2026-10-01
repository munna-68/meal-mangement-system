"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import type { MealStatus } from "@/lib/calc";
import type { BoardMember, BoardRoom } from "./meal-board";
import { RoomCard } from "./room-card";

const OPEN_EVENT = "meal-board:open-room-search";

/**
 * The trigger belongs in the page header next to the date navigation, but the
 * sheet has to live inside the board so it renders the board's own room cards
 * against the board's own state. One window event bridges the two without
 * lifting the board's state into a shared context.
 */
function openRoomSearch() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

export function RoomSearchTrigger() {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      className="size-11 sm:size-8"
      onClick={openRoomSearch}
      aria-label="Find member or room"
      title="Find member or room"
    >
      <SearchIcon className="size-4" />
    </Button>
  );
}

/**
 * Type-to-find on the Meal Status board. A hit on a member brings up that
 * member's whole room, because a room is only ever edited as a unit, and the
 * cards rendered here are the board's own card component — so a status changed
 * in here is a status changed on the board.
 */
export function RoomSearchSheet({
  rooms,
  ramadanMode,
  onStatus,
  onSehri,
  onRoomStatus,
  onGuestEdit,
}: {
  rooms: BoardRoom[];
  ramadanMode: boolean;
  onStatus: (member: BoardMember, status: MealStatus) => void;
  onSehri: (member: BoardMember, sehri: boolean) => void;
  onRoomStatus: (room: BoardRoom, status: MealStatus) => void;
  onGuestEdit: (member: BoardMember) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [viewportHeight, setViewportHeight] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const listener = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, listener);
    return () => {
      window.removeEventListener(OPEN_EVENT, listener);
    };
  }, []);

  // The sheet is anchored to the top, so it only has to be as tall as the part
  // of the screen that is still visible. On a phone the on-screen keyboard does
  // not shrink dvh, so the visible height has to be measured instead. Desktop
  // keeps the plain full-height sheet and lets the styles centre it.
  useEffect(() => {
    if (!open) return;
    const viewport = window.visualViewport;
    const wide = window.matchMedia("(min-width: 640px)");

    const update = () => {
      setViewportHeight(
        wide.matches || !viewport ? null : Math.round(viewport.height),
      );
    };

    update();
    viewport?.addEventListener("resize", update);
    wide.addEventListener("change", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      wide.removeEventListener("change", update);
    };
  }, [open]);

  // Radix already locks the page behind the modal; this keeps the lock
  // explicit and makes sure it is handed back on close.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const trimmed = query.trim();
  const matches = useMemo(() => {
    const needle = trimmed.toLowerCase();
    if (!needle) return [];
    return rooms.filter(
      (room) =>
        room.number.toLowerCase().includes(needle) ||
        room.members.some((member) => member.name.toLowerCase().includes(needle)),
    );
  }, [rooms, trimmed]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  if (!open) return null;

  return (
    <Sheet open onOpenChange={(next) => !next && close()}>
      <SheetContent
        side="top"
        showCloseButton={false}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          inputRef.current?.focus({ preventScroll: true });
        }}
        style={viewportHeight ? { height: viewportHeight } : undefined}
        className="data-[side=top]:h-dvh max-h-dvh gap-0 overflow-hidden p-0 data-[side=top]:sm:h-auto data-[side=top]:sm:left-1/2 data-[side=top]:sm:right-auto data-[side=top]:sm:top-1/2 data-[side=top]:sm:max-h-[85dvh] sm:mx-auto sm:w-full sm:max-w-lg sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-b-xl"
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-3">
            <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              type="text"
              inputMode="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name or room…"
              aria-label="Search by name or room"
              className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
            <SheetClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11 shrink-0 sm:size-7"
                aria-label="Close search"
              >
                <XIcon className="size-4" />
              </Button>
            </SheetClose>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
            {!trimmed ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                Type a name or a room number.
              </p>
            ) : matches.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                No room or member matches &ldquo;{trimmed}&rdquo;
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {matches.map((room) => (
                  <RoomCard
                    key={room.id}
                    room={room}
                    ramadanMode={ramadanMode}
                    controlIdPrefix="sehri-search"
                    onStatus={onStatus}
                    onSehri={onSehri}
                    onRoomStatus={onRoomStatus}
                    onGuestEdit={onGuestEdit}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <SheetTitle className="sr-only">Find member or room</SheetTitle>
        <SheetDescription className="sr-only">
          Search the board by member name or room number and edit the matching
          room.
        </SheetDescription>
      </SheetContent>
    </Sheet>
  );
}
