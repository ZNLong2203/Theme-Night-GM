"use client";

import { useEffect, useRef } from "react";
import type { Map as MapLibreMap, GeoJSONSource } from "maplibre-gl";
import type { EntityCard, HeatPoint, Venue } from "@/lib/types";

const STYLE = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

function circle(lat: number, lon: number, km: number, steps = 64) {
  const coords: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    coords.push([lon + (km / (111.32 * Math.cos((lat * Math.PI) / 180))) * Math.cos(a), lat + (km / 110.57) * Math.sin(a)]);
  }
  return { type: "Feature" as const, properties: {}, geometry: { type: "Polygon" as const, coordinates: [coords] } };
}

/** Qloo urn:heatmap cells around the venue, with the catchment ring the score uses. */
export function HeatMap({
  points,
  venue,
  catchmentKm = 16,
  places = [],
  className,
}: {
  points: HeatPoint[];
  venue: Venue;
  catchmentKm?: number;
  places?: EntityCard[];
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const data = useRef({ points, places });
  useEffect(() => {
    data.current = { points, places };
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { Map, Marker, setWorkerUrl } = await import("maplibre-gl");
      if (cancelled || !container.current) return;
      setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
      const map = new Map({
        container: container.current,
        style: STYLE,
        center: [venue.lon, venue.lat],
        zoom: 9.3,
        attributionControl: { compact: true },
        cooperativeGestures: true,
      });
      mapRef.current = map;
      map.on("load", () => {
        map.addSource("heat", { type: "geojson", data: heatGeoJson(data.current.points) });
        map.addSource("ring", { type: "geojson", data: circle(venue.lat, venue.lon, catchmentKm) });
        map.addSource("places", { type: "geojson", data: placesGeoJson(data.current.places) });
        map.addLayer({
          id: "heat",
          type: "heatmap",
          source: "heat",
          paint: {
            "heatmap-weight": ["get", "w"],
            "heatmap-intensity": 1.1,
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 8, 18, 12, 40],
            "heatmap-opacity": 0.85,
            "heatmap-color": [
              "interpolate",
              ["linear"],
              ["heatmap-density"],
              0,
              "rgba(0,0,0,0)",
              0.2,
              "rgba(108,155,255,0.35)",
              0.45,
              "rgba(61,220,151,0.55)",
              0.7,
              "rgba(255,181,71,0.75)",
              1,
              "rgba(255,107,139,0.9)",
            ],
          },
        });
        map.addLayer({ id: "ring-fill", type: "fill", source: "ring", paint: { "fill-color": "#ffb547", "fill-opacity": 0.04 } });
        map.addLayer({
          id: "ring-line",
          type: "line",
          source: "ring",
          paint: { "line-color": "#ffb547", "line-width": 1.2, "line-dasharray": [2, 2], "line-opacity": 0.7 },
        });
        map.addLayer({
          id: "places",
          type: "circle",
          source: "places",
          paint: { "circle-radius": 4, "circle-color": "#ff9b6b", "circle-stroke-color": "#080b12", "circle-stroke-width": 1.5 },
        });
        const el = document.createElement("div");
        el.innerHTML =
          '<div style="width:14px;height:14px;border-radius:9999px;background:#ffb547;box-shadow:0 0 0 4px rgba(255,181,71,.25),0 0 18px rgba(255,181,71,.8)"></div>';
        new Marker({ element: el }).setLngLat([venue.lon, venue.lat]).addTo(map);
      });
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [venue.lat, venue.lon, catchmentKm]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    (map.getSource("heat") as GeoJSONSource | undefined)?.setData(heatGeoJson(points));
    (map.getSource("places") as GeoJSONSource | undefined)?.setData(placesGeoJson(places));
  }, [points, places]);

  return <div ref={container} className={className} />;
}

function heatGeoJson(points: HeatPoint[]) {
  return {
    type: "FeatureCollection" as const,
    features: points.map((p) => ({
      type: "Feature" as const,
      properties: { w: p.affinity },
      geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] },
    })),
  };
}

function placesGeoJson(places: EntityCard[]) {
  return {
    type: "FeatureCollection" as const,
    features: places
      .filter((p) => typeof p.lat === "number" && typeof p.lon === "number")
      .map((p) => ({
        type: "Feature" as const,
        properties: { name: p.name },
        geometry: { type: "Point" as const, coordinates: [p.lon as number, p.lat as number] },
      })),
  };
}
