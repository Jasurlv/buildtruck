"use client";

import { useState, useEffect, useRef } from "react";
import { X } from "lucide-react";
import { adminFetch } from "@/utils/api";

const DEFAULT_START_TIME = "08:00";

interface WorkerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  showNotification: (msg: string, type: "success" | "error") => void;
  token: string;
  workerToEdit?: any | null;
}

export default function WorkerModal({
  isOpen,
  onClose,
  onSuccess,
  showNotification,
  token,
  workerToEdit,
}: WorkerModalProps) {
  const [workerForm, setWorkerForm] = useState({
    full_name: "",
    username: "",
    password: "",
    hourly_rate: "6.25",
    assigned_building_id: "",
    work_start_time: DEFAULT_START_TIME,
  });

  const [buildings, setBuildings] = useState<any[]>([]);
  const [hourlyRateError, setHourlyRateError] = useState<string | null>(null);
  const [startTimeError, setStartTimeError] = useState<string | null>(null);
  const startTimeInputRef = useRef<HTMLInputElement>(null);
  const hourlyRateInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      adminFetch("/buildings", token)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to fetch buildings");
          return res;
        })
        .then((res) => res.json())
        .then((data) => setBuildings(data))
        .catch(() => showNotification("Failed to fetch buildings", "error"));

      if (workerToEdit) {
        setWorkerForm({
          full_name: workerToEdit.full_name,
          username: workerToEdit.username,
          password: "",
          hourly_rate: String(workerToEdit.hourly_rate ?? ""),
          assigned_building_id: workerToEdit.assigned_building_id || "",
          work_start_time: workerToEdit.work_start_time || DEFAULT_START_TIME,
        });
      } else {
        setWorkerForm({
          full_name: "",
          username: "",
          password: "",
          hourly_rate: "6.25",
          assigned_building_id: "",
          work_start_time: DEFAULT_START_TIME,
        });
      }
      setHourlyRateError(null);
      setStartTimeError(null);
    }
  }, [isOpen, workerToEdit, token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // A number input reports unparseable text (e.g. "abc") as an empty value, so
    // check badInput to tell "nothing entered" apart from "not a number".
    const rateText = workerForm.hourly_rate.trim();
    const hourlyRate = Number(rateText);
    if (rateText === "" && !hourlyRateInputRef.current?.validity.badInput) {
      setHourlyRateError("Hourly rate is required");
      hourlyRateInputRef.current?.focus();
      return;
    }
    if (rateText === "" || !Number.isFinite(hourlyRate) || hourlyRate <= 0) {
      setHourlyRateError("Hourly rate must be a positive number");
      hourlyRateInputRef.current?.focus();
      return;
    }

    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(workerForm.work_start_time)) {
      setStartTimeError("Enter a start time as HH:MM, for example 08:00");
      startTimeInputRef.current?.focus();
      return;
    }

    try {
      const path = workerToEdit
        ? `/workers/${workerToEdit.id}`
        : "/workers";
      const method = workerToEdit ? "PUT" : "POST";

      const res = await adminFetch(path, token, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...workerForm,
          assigned_building_id: workerForm.assigned_building_id
            ? Number(workerForm.assigned_building_id)
            : null,
          hourly_rate: hourlyRate,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save worker");

      showNotification(
        workerToEdit
          ? "Worker updated successfully!"
          : "Worker registered successfully!",
        "success",
      );
      onSuccess();
      onClose();
    } catch (err: any) {
      showNotification(err.message || "Error saving worker", "error");
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="bg-white rounded-3xl shadow-xl max-w-md w-full p-8 border border-gray-100 relative">
        <button
          onClick={onClose}
          className="absolute top-6 right-6 text-gray-400 hover:text-gray-700 p-1.5 rounded-full bg-gray-50"
        >
          <X size={20} />
        </button>
        <h2 className="text-xl font-bold mb-2">
          {workerToEdit ? "Edit Worker" : "Register New Worker"}
        </h2>
        <p className="text-xs text-gray-500 mb-6">
          Update credentials and site assignment.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
              Full Name
            </label>
            <input
              type="text"
              required
              value={workerForm.full_name}
              onChange={(e) =>
                setWorkerForm({ ...workerForm, full_name: e.target.value })
              }
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
              Username
            </label>
            <input
              type="text"
              required
              value={workerForm.username}
              onChange={(e) =>
                setWorkerForm({ ...workerForm, username: e.target.value })
              }
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
              Password {workerToEdit && "(Leave blank to keep)"}
            </label>
            <input
              type="password"
              {...(!workerToEdit && { required: true })}
              placeholder="••••••••"
              value={workerForm.password}
              onChange={(e) =>
                setWorkerForm({ ...workerForm, password: e.target.value })
              }
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
              Hourly Rate (€ / hr)
            </label>
            {/* No `required`: the browser's native check would block submit before
                handleSubmit can show the field error below. */}
            <input
              ref={hourlyRateInputRef}
              type="number"
              step="0.01"
              inputMode="decimal"
              value={workerForm.hourly_rate}
              onChange={(e) => {
                setWorkerForm({ ...workerForm, hourly_rate: e.target.value });
                setHourlyRateError(null);
              }}
              aria-invalid={hourlyRateError ? true : undefined}
              aria-describedby={hourlyRateError ? "hourly-rate-error" : undefined}
              className={`w-full px-4 py-2.5 rounded-xl border text-sm ${
                hourlyRateError ? "border-red-400" : "border-gray-200"
              }`}
            />
            {hourlyRateError && (
              <p id="hourly-rate-error" className="mt-1 text-xs text-red-600">
                {hourlyRateError}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
              Work Start Time (HH:MM)
            </label>
            <input
              ref={startTimeInputRef}
              type="time"
              value={workerForm.work_start_time}
              onChange={(e) => {
                setWorkerForm({ ...workerForm, work_start_time: e.target.value });
                setStartTimeError(null);
              }}
              aria-invalid={startTimeError ? true : undefined}
              aria-describedby={startTimeError ? "start-time-error" : undefined}
              className={`w-full px-4 py-2.5 rounded-xl border text-sm ${
                startTimeError ? "border-red-400" : "border-gray-200"
              }`}
            />
            {startTimeError && (
              <p id="start-time-error" className="mt-1 text-xs text-red-600">
                {startTimeError}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase mb-1">
              Assigned Building Site
            </label>
            <select
              value={workerForm.assigned_building_id}
              onChange={(e) =>
                setWorkerForm({
                  ...workerForm,
                  assigned_building_id: e.target.value,
                })
              }
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 text-sm bg-white"
            >
              <option value="">Select a construction site...</option>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-6 py-2.5 rounded-xl text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {workerToEdit ? "Update Worker" : "Create Worker"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
