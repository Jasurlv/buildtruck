"use client";

import { useState, useEffect, useRef } from "react";
import { X, Globe } from "lucide-react";
import "leaflet/dist/leaflet.css";
import type { LeafletMouseEvent } from "leaflet";
import { adminFetch } from "@/utils/api";
import { geocodeAddress } from "@/utils/geocode";

// Wait this long after the last keystroke before searching (no search-as-you-type).
const ADDRESS_SEARCH_DEBOUNCE_MS = 800;
const ADDRESS_SEARCH_MIN_LENGTH = 4;

// Same limits as the API. GPS can jump tens of meters indoors, so a smaller zone
// would flag workers who are on site. Sites saved earlier with less must be raised.
const MIN_RADIUS_METERS = 50;
const MAX_RADIUS_METERS = 500;
const RADIUS_HINT = `Allowed ${MIN_RADIUS_METERS}-${MAX_RADIUS_METERS} m (GPS can jump indoors)`;

function radiusError(radius: number): string | null {
  if (Number.isInteger(radius) && radius >= MIN_RADIUS_METERS && radius <= MAX_RADIUS_METERS) {
    return null;
  }
  return Number.isInteger(radius) && radius > 0 && radius < MIN_RADIUS_METERS
    ? `${radius} m is below the minimum. Raise it to at least ${MIN_RADIUS_METERS} m to save.`
    : `Enter a whole number of meters from ${MIN_RADIUS_METERS} to ${MAX_RADIUS_METERS}.`;
}

interface BuildingModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  showNotification: (msg: string, type: "success" | "error") => void;
  token: string;
  buildingToEdit?: any | null;
}

export default function BuildingModal({
  isOpen,
  onClose,
  onSuccess,
  showNotification,
  token,
  buildingToEdit,
}: BuildingModalProps) {
  const [buildingForm, setBuildingForm] = useState({
    name: "",
    address: "",
    latitude: 56.9496,
    longitude: 24.1052,
    radius_meters: MIN_RADIUS_METERS,
  });

  const mapRef = useRef<any>(null);
  const mapInstanceRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const circleRef = useRef<any>(null);

  const [addressSearchUnavailable, setAddressSearchUnavailable] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchControllerRef = useRef<AbortController | null>(null);

  // Drops a scheduled search and cancels one in flight, so its result is ignored.
  const cancelAddressSearch = () => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = null;
    searchControllerRef.current?.abort();
    searchControllerRef.current = null;
  };

  // Stop searching when the modal closes or unmounts.
  useEffect(() => {
    if (!isOpen) cancelAddressSearch();
    return cancelAddressSearch;
  }, [isOpen]);

  const handleClose = () => {
    cancelAddressSearch();
    setAddressSearchUnavailable(false);
    onClose();
  };

  useEffect(() => {
    if (isOpen) {
      if (buildingToEdit) {
        setBuildingForm({
          name: buildingToEdit.name,
          address: buildingToEdit.address,
          latitude: buildingToEdit.latitude,
          longitude: buildingToEdit.longitude,
          radius_meters: buildingToEdit.radius_meters,
        });
      } else {
        setBuildingForm({
          name: "",
          address: "",
          latitude: 56.9496,
          longitude: 24.1052,
          radius_meters: MIN_RADIUS_METERS,
        });
      }

      const timer = setTimeout(async () => {
        const lat = buildingToEdit ? buildingToEdit.latitude : 56.9496;
        const lon = buildingToEdit ? buildingToEdit.longitude : 24.1052;
        const rad = buildingToEdit ? buildingToEdit.radius_meters : MIN_RADIUS_METERS;

        if (mapRef.current && !mapInstanceRef.current) {
          const L = (await import("leaflet")).default;

          delete (L.Icon.Default.prototype as any)._getIconUrl;
          L.Icon.Default.mergeOptions({
            iconRetinaUrl:
              "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
            iconUrl:
              "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
            shadowUrl:
              "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
          });

          const map = L.map(mapRef.current).setView([lat, lon], 17);
          L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            attribution: "&copy; OpenStreetMap contributors",
          }).addTo(map);

          const marker = L.marker([lat, lon], { draggable: true }).addTo(map);
          const circle = L.circle([lat, lon], {
            radius: rad,
            color: "#4f46e5",
            fillColor: "#4f46e5",
            fillOpacity: 0.25,
          }).addTo(map);

          marker.on("dragend", (e: any) => {
            cancelAddressSearch();
            const pos = e.target.getLatLng();
            setBuildingForm((prev) => ({
              ...prev,
              latitude: pos.lat,
              longitude: pos.lng,
            }));
          });

          // Clicking the map places the pin there (the fallback when address
          // search is unavailable).
          map.on("click", (e: LeafletMouseEvent) => {
            cancelAddressSearch();
            setBuildingForm((prev) => ({
              ...prev,
              latitude: e.latlng.lat,
              longitude: e.latlng.lng,
            }));
          });

          mapInstanceRef.current = map;
          markerRef.current = marker;
          circleRef.current = circle;
        } else if (mapInstanceRef.current) {
          mapInstanceRef.current.setView([lat, lon], 17);
          mapInstanceRef.current.invalidateSize();
        }
      }, 200);

      return () => clearTimeout(timer);
    } else {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    }
  }, [isOpen, buildingToEdit]);

  useEffect(() => {
    if (mapInstanceRef.current && markerRef.current && circleRef.current) {
      const newLatLng = [buildingForm.latitude, buildingForm.longitude];
      markerRef.current.setLatLng(newLatLng);
      circleRef.current.setLatLng(newLatLng);
      mapInstanceRef.current.panTo(newLatLng);
    }
  }, [buildingForm.latitude, buildingForm.longitude]);

  useEffect(() => {
    if (circleRef.current && Number.isFinite(buildingForm.radius_meters)) {
      circleRef.current.setRadius(buildingForm.radius_meters);
    }
  }, [buildingForm.radius_meters]);

  const searchAddress = async (query: string) => {
    const controller = new AbortController();
    searchControllerRef.current = controller;
    try {
      const result = await geocodeAddress(query, controller.signal);
      if (searchControllerRef.current !== controller) return; // superseded
      searchControllerRef.current = null;
      setAddressSearchUnavailable(false);
      if (result) {
        setBuildingForm((prev) => ({
          ...prev,
          latitude: result.latitude,
          longitude: result.longitude,
        }));
      }
    } catch {
      // Cancelled searches are expected; real failures only show the inline
      // message (no console.error, which would open the Next.js error overlay).
      if (controller.signal.aborted || searchControllerRef.current !== controller) {
        return;
      }
      searchControllerRef.current = null;
      setAddressSearchUnavailable(true);
    }
  };

  const handleAddressChange = (address: string) => {
    setBuildingForm((prev) => ({ ...prev, address }));
    cancelAddressSearch();
    const query = address.trim();
    if (query.length < ADDRESS_SEARCH_MIN_LENGTH) return;
    searchTimerRef.current = setTimeout(() => {
      searchTimerRef.current = null;
      void searchAddress(query);
    }, ADDRESS_SEARCH_DEBOUNCE_MS);
  };

  const currentRadiusError = radiusError(buildingForm.radius_meters);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (currentRadiusError) {
      showNotification(currentRadiusError, "error");
      return;
    }
    try {
      const path = buildingToEdit
        ? `/buildings/${buildingToEdit.id}`
        : "/buildings";
      const method = buildingToEdit ? "PUT" : "POST";

      const res = await adminFetch(path, token, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildingForm),
      });
      if (!res.ok) {
        // The API explains what is wrong (e.g. the radius limits); show that.
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Error saving building site");
      }

      showNotification(
        buildingToEdit
          ? "Building updated successfully!"
          : "Building site added successfully!",
        "success",
      );
      onSuccess();
      handleClose();
    } catch (err) {
      showNotification(
        err instanceof Error && err.message ? err.message : "Error saving building site",
        "error",
      );
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full p-8 border border-gray-100 relative overflow-hidden">
        <button
          onClick={handleClose}
          className="absolute top-6 right-6 text-gray-400 hover:text-gray-700 p-1.5 rounded-full bg-gray-50 transition-colors z-10"
        >
          <X size={20} />
        </button>
        <h2 className="text-xl font-bold mb-1">
          {buildingToEdit
            ? "Edit Building Site"
            : "Add Building Site & Geofence"}
        </h2>
        <p className="text-xs text-gray-500 mb-6">
          Enter site details and adjust radius.
        </p>

        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
                Site Name
              </label>
              <input
                type="text"
                required
                value={buildingForm.name}
                onChange={(e) =>
                  setBuildingForm({ ...buildingForm, name: e.target.value })
                }
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
                Address
              </label>
              <div className="relative">
                <Globe
                  size={16}
                  className="absolute left-3.5 top-3 text-gray-400"
                />
                <input
                  type="text"
                  required
                  value={buildingForm.address}
                  onChange={(e) => handleAddressChange(e.target.value)}
                  aria-describedby={
                    addressSearchUnavailable ? "address-search-status" : undefined
                  }
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm"
                />
              </div>
              {addressSearchUnavailable && (
                <p
                  id="address-search-status"
                  role="status"
                  className="mt-1 text-xs text-amber-700"
                >
                  Address search is unavailable right now. Click the map to place
                  the pin.
                </p>
              )}
            </div>
            <div>
              <label
                htmlFor="building-radius"
                className="block text-xs font-semibold text-gray-600 uppercase mb-1"
              >
                Geofence Radius (meters)
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  aria-label="Geofence radius"
                  min={MIN_RADIUS_METERS}
                  max={MAX_RADIUS_METERS}
                  step="5"
                  value={
                    Number.isFinite(buildingForm.radius_meters)
                      ? buildingForm.radius_meters
                      : MIN_RADIUS_METERS
                  }
                  onChange={(e) =>
                    setBuildingForm({
                      ...buildingForm,
                      radius_meters: Number(e.target.value),
                    })
                  }
                  className="w-full accent-indigo-600 cursor-pointer"
                />
                <input
                  id="building-radius"
                  type="number"
                  min={MIN_RADIUS_METERS}
                  max={MAX_RADIUS_METERS}
                  step="1"
                  required
                  value={
                    Number.isFinite(buildingForm.radius_meters)
                      ? buildingForm.radius_meters
                      : ""
                  }
                  onChange={(e) =>
                    setBuildingForm({
                      ...buildingForm,
                      // Empty while typing: NaN until a number is entered.
                      radius_meters: e.target.value === "" ? NaN : Number(e.target.value),
                    })
                  }
                  aria-invalid={currentRadiusError !== null}
                  aria-describedby="building-radius-hint"
                  className={`w-24 px-3 py-2 rounded-xl border text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                    currentRadiusError ? "border-rose-400" : "border-gray-200"
                  }`}
                />
              </div>
              <p id="building-radius-hint" className="mt-1 text-xs text-gray-500">
                {RADIUS_HINT}
              </p>
              {currentRadiusError && (
                <p role="alert" className="mt-1 text-xs text-rose-600">
                  {currentRadiusError}
                </p>
              )}
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <button
                type="button"
                onClick={handleClose}
                className="px-5 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-6 py-2.5 rounded-xl text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
              >
                {buildingToEdit ? "Update Building" : "Save Building Site"}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-gray-600 uppercase">
              Live Geofence Boundary Preview
            </label>
            <div className="w-full h-[360px] rounded-2xl border border-gray-200 overflow-hidden shadow-inner relative z-0">
              <div ref={mapRef} className="w-full h-full" />
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
