import { type RefObject, useLayoutEffect, useState } from "react";

/**
 * Height from the element's top to the bottom of the viewport (less
 * `bottomGap`), when the page is scrolled to the top, so the element can
 * fill the rest of the first screen and scroll inside. Never less than
 * `minFraction` of the viewport, so on small screens it stays usable.
 * Re-measured when the window resizes or the containers around it do (so
 * content above it changing size moves it).
 */
export function useRemainingHeight(
  ref: RefObject<HTMLElement | null>,
  bottomGap: number,
  minFraction = 0.6,
): number | undefined {
  const [height, setHeight] = useState<number>();

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const viewport = window.innerHeight;
      setHeight(Math.round(Math.max(viewport - top - bottomGap, viewport * minFraction)));
    };
    update();
    const observer = new ResizeObserver(update);
    for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
      observer.observe(node);
    }
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [ref, bottomGap, minFraction]);

  return height;
}
