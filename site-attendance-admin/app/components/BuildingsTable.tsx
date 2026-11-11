"use client";

import { useState, useEffect } from "react";
import { Building2, Plus, Trash2, Edit, Users } from "lucide-react";
import { adminFetch } from "@/utils/api";

interface BuildingsTableProps {
  token: string;
  showNotification: (msg: string, type: "success" | "error") => void;
  onOpenAddModal: () => void;
  onOpenEditModal: (building: any) => void;
  refreshTrigger: number;
}

export default function BuildingsTable({
  token,
  showNotification,
  onOpenAddModal,
  onOpenEditModal,
  refreshTrigger,
}: BuildingsTableProps) {
  const [buildings, setBuildings] = useState<any[]>([]);

  const fetchBuildings = async () => {
    try {
      const res = await adminFetch("/buildings", token);
      if (!res.ok) throw new Error("Failed to fetch buildings");
      const data = await res.json();
      setBuildings(data);
    } catch (err) {
      showNotification("Failed to fetch buildings", "error");
    }
  };

  useEffect(() => {
    fetchBuildings();
  }, [refreshTrigger, token]);

  const handleDelete = async (id: number) => {
    if (!confirm("Are you sure you want to delete this building?")) return;
    try {
      const response = await adminFetch(`/buildings/${id}`, token, { method: "DELETE" });
      if (!response.ok) throw new Error("Failed to delete building");
      showNotification("Building deleted successfully", "success");
      fetchBuildings();
    } catch (err) {
      showNotification("Failed to delete building", "error");
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-6 border-b border-gray-100 flex justify-between items-center">
        <div>
          <h3 className="font-bold text-gray-900 flex items-center gap-2 text-lg">
            <Building2 size={20} className="text-indigo-600" /> Building Sites
            Management ({buildings.length})
          </h3>
          <p className="text-xs text-gray-500">
            Configure construction zones and monitor personnel counts
          </p>
        </div>
        <button
          onClick={onOpenAddModal}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-medium shadow-sm transition-all"
        >
          <Plus size={16} /> Add Building Site
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50/70 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <th className="py-3.5 px-6">Site Name</th>
              <th className="py-3.5 px-6">Address</th>
              <th className="py-3.5 px-6">Total Workers</th>
              <th className="py-3.5 px-6">Radius</th>
              <th className="py-3.5 px-6 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-sm">
            {buildings.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-gray-400">
                  No building sites added yet. Click &quot;Add Building
                  Site&quot; above.
                </td>
              </tr>
            ) : (
              buildings.map((b) => (
                <tr
                  key={b.id}
                  className="hover:bg-gray-50/50 transition-colors"
                >
                  <td className="py-4 px-6 font-semibold text-gray-900">
                    {b.name}
                  </td>
                  <td className="py-4 px-6 text-gray-600">{b.address}</td>
                  <td className="py-4 px-6">
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <Users size={12} /> {b.total_workers || 0} Workers
                    </span>
                  </td>
                  <td className="py-4 px-6">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                      {b.radius_meters} meters
                    </span>
                  </td>
                  <td className="py-4 px-6 text-right space-x-1">
                    <button
                      onClick={() => onOpenEditModal(b)}
                      className="text-gray-400 hover:text-indigo-600 p-2 rounded-lg transition-colors"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(b.id)}
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
