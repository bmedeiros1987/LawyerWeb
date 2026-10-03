"use client";

import { useRef } from "react";

// Keep the same key after a lost response. Changed content starts a new operation.
export function useDraftOperation() {
  const previous = useRef<{ payload: string; id: string } | null>(null);
  return {
    idFor(payload: unknown) {
      const serialized = JSON.stringify(payload);
      if (previous.current?.payload !== serialized) previous.current = { payload: serialized, id: crypto.randomUUID() };
      return previous.current.id;
    },
    completed() { previous.current = null; },
  };
}
