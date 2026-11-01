import { useEffect, useRef } from "react";

/**
 * Whether the component is still on screen, for an AI answer landing after it
 * has gone: the async call outlives the component, and nothing errors when its
 * parent's setters still work. Set in the effect, not as the ref's start value,
 * because Strict Mode runs the cleanup once on the way in.
 */
export const useMountedRef = () => {
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  return mounted;
};
