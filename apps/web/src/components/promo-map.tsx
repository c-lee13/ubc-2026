"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import type { Map as MlMap, Marker as MlMarker } from "maplibre-gl";
import { useEffect, useMemo, useRef, useState } from "react";
import { AUSTIN, shopPlace, type Place } from "@/lib/places";
import { price } from "@/lib/promo-view";
import { IconClose } from "./icons";
import { Note, Sheet, Spinner } from "./kit";
import { PromoCard, type Promo } from "./promo-card";

/**
 * Nearby shops running promos, on a real map: MapLibre GL with OpenFreeMap's free dark style (no
 * key), tinted to the app's purple-black. One price-tag pin per shop; tapping it opens that shop's
 * live promos in a sheet (the same cards, Buy on them). Centered on Austin; the browser's location
 * is used only when the person taps "Near me" and allows it. Shop coordinates: lib/places.ts.
 */
const STYLE = "https://tiles.openfreemap.org/styles/dark";

/** Recolor the dark style toward the app palette once it has loaded. */
const TINT: [string, string, string][] = [
  ["background", "background-color", "#0b0710"],
  ["landcover_ice_shelf", "fill-color", "#0b0710"],
  ["road_area_pier", "fill-color", "#0b0710"],
  ["water", "fill-color", "#17111f"],
  ["waterway", "line-color", "#17111f"],
  ["landuse_residential", "fill-color", "#0e0a14"],
  ["landcover_wood", "fill-color", "#130e1b"],
  ["landuse_park", "fill-color", "#130e1b"],
  ["building", "fill-color", "#0f0b16"],
  ["building", "fill-outline-color", "#1e1828"],
  ["highway_minor", "line-color", "#1f1829"],
  ["highway_path", "line-color", "#1a1423"],
  ["highway_major_inner", "line-color", "#271e33"],
  ["highway_major_subtle", "line-color", "#2d2439"],
  ["highway_major_casing", "line-color", "rgba(90,72,112,0.55)"],
  ["highway_motorway_subtle", "line-color", "#2d2439"],
  ["highway_name_other", "text-color", "#6f6481"],
  ["highway_name_other", "text-halo-color", "#0b0710"],
];
const LABELS = ["place_other", "place_suburb", "place_village", "place_town", "place_city"];

interface ShopPin {
  merchant: string;
  name: string;
  location: string;
  place: Place;
  promos: Promo[];
  cheapest: string;
}

function pinsOf(promos: Promo[]): { pins: ShopPin[]; unplaced: number } {
  const byShop = new Map<string, Promo[]>();
  for (const p of promos) byShop.set(p.shop.merchant, [...(byShop.get(p.shop.merchant) ?? []), p]);
  const pins: ShopPin[] = [];
  let unplaced = 0;
  for (const [merchant, list] of byShop) {
    const place = shopPlace(list[0]!.shop);
    if (!place) {
      unplaced += 1;
      continue;
    }
    const cheapest = list.reduce((a, b) =>
      BigInt(a.offerAmount) <= BigInt(b.offerAmount) ? a : b,
    );
    pins.push({
      merchant,
      name: list[0]!.shop.name,
      location: list[0]!.shop.location,
      place,
      promos: list,
      cheapest: price(cheapest.offerAmount),
    });
  }
  return { pins, unplaced };
}

/** The pin: a small price tag in the logo's ribbon, the cheapest promo's price inside. */
function pinElement(pin: ShopPin, onTap: () => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "wc-pin";
  el.setAttribute(
    "aria-label",
    `${pin.name}: ${pin.promos.length} promo${pin.promos.length === 1 ? "" : "s"}`,
  );
  el.innerHTML = `<span class="wc-pin-tag"><span class="wc-pin-hole"></span>${pin.cheapest}${
    pin.promos.length > 1 ? `<span class="wc-pin-count">${pin.promos.length}</span>` : ""
  }</span><span class="wc-pin-tip"></span>`;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    onTap();
  });
  return el;
}

export function PromoMap({ promos, now }: { promos: Promo[]; now: number | null }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<MlMap | null>(null);
  const markers = useRef<MlMarker[]>([]);
  const me = useRef<MlMarker | null>(null);
  const framed = useRef(false);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locNote, setLocNote] = useState<string | null>(null);
  const { pins, unplaced } = useMemo(() => pinsOf(promos), [promos]);

  // Create the map once.
  useEffect(() => {
    let alive = true;
    let m: MlMap | null = null;
    void import("maplibre-gl").then(({ default: maplibregl }) => {
      if (!alive || !box.current) return;
      m = new maplibregl.Map({
        container: box.current,
        style: STYLE,
        center: [AUSTIN.lng, AUSTIN.lat],
        zoom: 12.6,
        attributionControl: { compact: true },
        dragRotate: false,
        pitchWithRotate: false,
      });
      m.touchZoomRotate.disableRotation();
      m.on("load", () => {
        if (!alive || !m) return;
        for (const [layer, prop, value] of TINT) {
          if (m.getLayer(layer)) m.setPaintProperty(layer, prop as never, value as never);
        }
        for (const layer of LABELS) {
          if (!m.getLayer(layer)) continue;
          m.setPaintProperty(layer, "text-color", "#8a7f99");
          m.setPaintProperty(layer, "text-halo-color", "#0b0710");
        }
        setReady(true);
      });
      m.on("error", (e) => {
        // A failed tile now and then is fine; the style itself not loading is not.
        if (!m?.isStyleLoaded() && /style|fetch|Failed/i.test(String(e?.error?.message ?? "")))
          setFailed(true);
      });
      map.current = m;
    });
    return () => {
      alive = false;
      m?.remove();
      map.current = null;
    };
  }, []);

  // Pins follow the promos.
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    let alive = true;
    void import("maplibre-gl").then(({ default: maplibregl }) => {
      if (!alive) return;
      for (const mk of markers.current) mk.remove();
      markers.current = pins.map((pin) =>
        new maplibregl.Marker({
          element: pinElement(pin, () => {
            setOpen(pin.merchant);
            m.easeTo({ center: [pin.place.lng, pin.place.lat], offset: [0, -140], duration: 500 });
          }),
          anchor: "bottom",
        })
          .setLngLat([pin.place.lng, pin.place.lat])
          .addTo(m),
      );
      // First time there are pins: frame them all (never zoom in past street level).
      if (!framed.current && pins.length > 0) {
        framed.current = true;
        const b = new maplibregl.LngLatBounds();
        for (const pin of pins) b.extend([pin.place.lng, pin.place.lat]);
        m.fitBounds(b, {
          padding: { top: 90, bottom: 110, left: 60, right: 60 },
          maxZoom: 14,
          duration: 0,
        });
      }
    });
    return () => {
      alive = false;
    };
  }, [pins, ready]);

  function nearMe() {
    const m = map.current;
    if (!m) return;
    if (!("geolocation" in navigator) || !window.isSecureContext) {
      setLocNote("Location needs https. Showing Austin.");
      return;
    }
    setLocating(true);
    setLocNote(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const at: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        void import("maplibre-gl").then(({ default: maplibregl }) => {
          me.current?.remove();
          const dot = document.createElement("span");
          dot.className = "wc-me";
          me.current = new maplibregl.Marker({ element: dot }).setLngLat(at).addTo(m);
        });
        m.flyTo({ center: at, zoom: 13.5 });
      },
      () => {
        setLocating(false);
        setLocNote("Location is off. Showing Austin.");
      },
      { timeout: 8000, maximumAge: 60_000 },
    );
  }

  const shop = pins.find((p) => p.merchant === open) ?? null;

  if (failed) {
    return (
      <Note tone="warn" title="The map didn't load">
        The free map tiles didn&apos;t answer. The list has every promo.
      </Note>
    );
  }

  return (
    <div className="relative -mx-4 overflow-hidden">
      <div
        ref={box}
        className="wc-map h-[calc(100dvh-60px-52px-60px-env(safe-area-inset-bottom))] min-h-[420px] w-full bg-paper"
        aria-label="Map of shops running promos"
        role="region"
      />
      {!ready ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-ink-soft">
          <Spinner className="h-6 w-6" />
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
        <span className="rounded-full bg-paper/85 px-3.5 py-1.5 text-[12px] font-semibold ring-1 ring-rule backdrop-blur-md">
          {pins.length} {pins.length === 1 ? "shop" : "shops"} running promos
          {unplaced ? (
            <span className="font-normal text-ink-soft">, {unplaced} not on the map</span>
          ) : null}
        </span>
      </div>
      <button
        type="button"
        onClick={nearMe}
        className="absolute bottom-10 right-4 inline-flex h-11 items-center gap-2 rounded-full bg-ink px-4 text-[13px] font-semibold text-black shadow-lg"
      >
        {locating ? (
          <Spinner />
        ) : (
          <span className="h-2.5 w-2.5 rounded-full bg-note ring-2 ring-black/10" aria-hidden />
        )}
        Near me
      </button>
      {locNote ? (
        <div className="absolute inset-x-4 bottom-24 flex items-center justify-between gap-3 rounded-2xl bg-paper-raised px-4 py-3 text-[12.5px] ring-1 ring-rule">
          <span>{locNote}</span>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setLocNote(null)}
            className="text-ink-soft"
          >
            <IconClose size={18} />
          </button>
        </div>
      ) : null}

      <Sheet open={shop !== null} onClose={() => setOpen(null)} title={shop?.name}>
        {shop ? (
          <div className="space-y-3">
            {shop.location ? (
              <p className="-mt-1 text-[12.5px] text-ink-soft">{shop.location}</p>
            ) : null}
            {shop.promos.map((p) => (
              <PromoCard key={p.id} p={p} now={now} sub="kickoff" />
            ))}
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
