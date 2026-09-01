// React wrapper owning a MapRenderer lifecycle. Two modes:
//  - fixed square (sizePx): whole map fitted, e.g. the replay screen;
//  - fill: the canvas takes the host's full rectangle (any aspect ratio),
//    starts zoomed to COVER it, and the viewer drags to pan / wheels to zoom.
// Extras: click-to-select entities (onSelect) and a controller handle the
// minimap uses to read the camera and move it.

import { MutableRefObject, useEffect, useRef } from "react";
import type { GameState } from "../api/types";
import { MapRenderer } from "./MapRenderer";

export interface MapController {
  getViewFrac(): { x: number; y: number; w: number; h: number } | null;
  centerOnFrac(fx: number, fy: number): void;
  select(id: number | null): void;
}

export default function MapView({ state, perspective = null, sizePx = 640, fill = false,
                                  onSelect, controller }: {
  state: GameState | null;
  perspective?: number | null;
  sizePx?: number;
  fill?: boolean;
  onSelect?: (id: number | null) => void;
  controller?: MutableRefObject<MapController | null>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<MapRenderer | null>(null);
  const readyRef = useRef<Promise<void> | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    const renderer = new MapRenderer();
    renderer.onSelect = (id) => onSelectRef.current?.(id);
    rendererRef.current = renderer;
    if (controller) {
      controller.current = {
        getViewFrac: () => rendererRef.current?.getViewFrac() ?? null,
        centerOnFrac: (fx, fy) => rendererRef.current?.centerOnFrac(fx, fy),
        select: (id) => rendererRef.current?.select(id),
      };
    }
    const host = hostRef.current;
    let ro: ResizeObserver | null = null;
    if (host) {
      if (fill) {
        const w = Math.floor(host.clientWidth) || 800;
        const h = Math.floor(host.clientHeight) || 600;
        // Re-measure the moment init resolves: the first measurement can run
        // before layout and fall back to 800x600 - never let that size stick.
        readyRef.current = renderer.init(host, w, h, true).then(() => {
          const nw = Math.floor(host.clientWidth);
          const nh = Math.floor(host.clientHeight);
          if (nw > 0 && nh > 0) rendererRef.current?.resizeView(nw, nh);
        });
        ro = new ResizeObserver(() => {
          const nw = Math.floor(host.clientWidth);
          const nh = Math.floor(host.clientHeight);
          if (nw > 0 && nh > 0) {
            readyRef.current?.then(() => rendererRef.current?.resizeView(nw, nh));
          }
        });
        ro.observe(host);
      } else {
        readyRef.current = renderer.init(host, sizePx, sizePx, false);
      }
    }
    return () => {
      ro?.disconnect();
      if (controller) controller.current = null;
      renderer.destroy();
      rendererRef.current = null;
    };
  }, [sizePx, fill, controller]);

  useEffect(() => {
    if (!state) return;
    readyRef.current?.then(() => rendererRef.current?.render(state, perspective));
  }, [state, perspective]);

  return <div ref={hostRef} className={`map-host${fill ? " map-host-fill" : ""}`}
              style={fill ? undefined : { width: sizePx, height: sizePx }} />;
}
