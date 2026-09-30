"use client";

import { useRef } from "react";

/**
 * A key that is created once per submission and only replaced after the save
 * has succeeded.
 *
 * Sending it with a write lets the server reject a duplicate: a double-click, a
 * retry after a timeout, or the same paste submitted twice all carry the same
 * key, so the money is recorded once no matter how many times the button is
 * hit. The button's own disabled state cannot do this — React has not processed
 * the first click yet when the second one arrives.
 */
export function useIdempotencyKey() {
  const key = useRef<string | null>(null);

  function current(): string {
    key.current ??= crypto.randomUUID();
    return key.current;
  }

  /** Call after a write has definitely landed, so the next one is a new write. */
  function reset() {
    key.current = null;
  }

  return { current, reset };
}