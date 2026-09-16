"use client";

import { useMemo, useState } from "react";
import { CheckIcon, SearchIcon } from "lucide-react";

import { cn } from "cn";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface PickerMember {
  id: string;
  name: string;
  roomNumber: string;
}

/**
 * Type-to-find member picker. A plain <Select> gets unusable once the mess has
 * a few dozen members, so this filters on name or room as you type instead of
 * making you scroll a list.
 */
export function MemberPicker({
  members,
  value,
  onChange,
  id,
  placeholder = "Search by name or room",
}: {
  members: PickerMember[];
  value: string;
  onChange: (memberId: string) => void;
  id?: string;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = members.find((member) => member.id === value);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return members;
    return members.filter(
      (member) =>
        member.name.toLowerCase().includes(needle) ||
        member.roomNumber.toLowerCase().includes(needle),
    );
  }, [members, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          className="w-full justify-start font-normal"
          aria-expanded={open}
        >
          {selected ? (
            <span className="truncate">
              {selected.name}
              <span className="text-muted-foreground"> — Room {selected.roomNumber}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">{placeholder}</span>
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-72 p-0">
        <div className="flex items-center gap-2 border-b px-2.5 py-2">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type a name…"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="max-h-64 overflow-y-auto py-1">
          {matches.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              No member matches &ldquo;{query}&rdquo;
            </p>
          ) : (
            matches.map((member) => {
              const isSelected = member.id === value;
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => {
                    onChange(member.id);
                    setOpen(false);
                    setQuery("");
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted",
                    isSelected && "font-medium",
                  )}
                >
                  <CheckIcon
                    className={cn(
                      "size-4 shrink-0",
                      isSelected ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{member.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    Room {member.roomNumber}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
