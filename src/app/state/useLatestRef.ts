import { useRef } from "react";

export function useLatestRef<T>(val: T) {
  const ref = useRef(val);
  ref.current = val;
  return ref;
}
