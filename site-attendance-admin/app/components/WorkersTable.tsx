"use client";

import { useState, useEffect } from "react";
import { Users, Plus, Trash2, Edit, MapPin } from "lucide-react";
import { adminFetch } from "@/utils/api";

interface WorkersTableProps {
  token: string;
  showNotification: (msg: string, type: "success" | "error") => void;
  onOpenAddModal: () => void;
  onOpenEditModal: (worker: any) => void;
  refreshTrigger: number;
}

export default function WorkersTable({
  token,
  showNotification,
  onOpenAddModal,
  onOpenEditModal,
  refreshTrigger,
}: WorkersTableProps) {
  const [workers, setWorkers] = useState<any[]>([]);

  const fetchWorkers = async () => {
    try {
      const res = await adminFetch("/workers", token);
      if (!res.ok) throw new Error("Failed to fetch workers");
      const data = await res.json();
      setWorkers(data);
    } catch (err) {
      showNotification("Failed to fetch workers", "error");
    }
  };

  useEffect(() => {
    fetchWorkers();
  }, [refreshTrigger, token]);

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to remove this worker?")) return;
    try {
      const response = await adminFetch(`/workers/${id}`, token, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to remove worker");
      showNotification("Worker removed successfully", "success");
      fetchWorkers();
    } catch (err) {
      showNotification("Failed to remove worker", "error");
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-6 border-b border-gray-100 flex justify-between items-center">
        <div>
          <h3 className="font-bold text-gray-900 flex items-center gap-2 text-lg">
            <Users size={20} className="text-indigo-600" /> Workers Directory
            Management ({workers.length})
          </h3>
          <p className="text-xs text-gray-500">
            Register and assign personnel to construction zones
          </p>
        </div>
        <button
          onClick={onOpenAddModal}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-medium shadow-sm transition-all"
        >
          <Plus size={16} /> Register Worker
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50/70 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <th className="py-3.5 px-6">Full Name</th>
              <th className="py-3.5 px-6">Username</th>
              <th className="py-3.5 px-6">Hourly Rate</th>
              <th className="py-3.5 px-6">Start Time</th>
              <th className="py-3.5 px-6">Assigned Site</th>
              <th className="py-3.5 px-6 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-sm">
            {workers.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-400">
                  No workers registered yet. Click &quot;Register Worker&quot;
                  above.
                </td>
              </tr>
            ) : (
              workers.map((w) => (
                <tr
                  key={w.id}
                  className="hover:bg-gray-50/50 transition-colors"
                >
                  <td className="py-4 px-6 font-semibold text-gray-900">
                    {w.full_name}
                  </td>
                  <td className="py-4 px-6 font-mono text-xs text-indigo-600 bg-indigo-50/50 px-2 py-1 rounded w-fit">
                    {w.username}
                  </td>
                  <td className="py-4 px-6 font-medium text-emerald-700">
                    €{w.hourly_rate}/hr
                  </td>
                  <td className="py-4 px-6 tabular-nums text-gray-700">
                    {w.work_start_time}
                  </td>
                  <td className="py-4 px-6">
                    {w.building_name ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <MapPin size={12} /> {w.building_name}
                      </span>
                    ) : (
                      <span className="text-gray-400 italic text-xs">
                        Unassigned
                      </span>
                    )}
                  </td>
                  <td className="py-4 px-6 text-right space-x-1">
                    <button
                      onClick={() => onOpenEditModal(w)}
                      className="text-gray-400 hover:text-indigo-600 p-2 rounded-lg transition-colors"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(w.id)}
                      className="text-gray-400 hover:text-rose-600 p-2 rounded-lg transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
