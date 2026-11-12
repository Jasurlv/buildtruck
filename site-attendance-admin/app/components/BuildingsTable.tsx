"use client";

import { useState, useEffect } from "react";
import { Building2, Plus, Trash2, Edit, Users } from "lucide-react";
import { adminFetch } from "@/utils/api";
import { useTranslation } from "@/i18n";
import { errorTextOf, throwApiError } from "@/i18n/apiErrors";

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
  const { t } = useTranslation();

  const fetchBuildings = async () => {
    try {
      const res = await adminFetch("/buildings", token);
      if (!res.ok) await throwApiError(res);
      const data = await res.json();
      setBuildings(data);
    } catch {
      showNotification(t("buildings.loadFailed"), "error");
    }
  };

  useEffect(() => {
    fetchBuildings();
  }, [refreshTrigger, token]);

  const handleDelete = async (id: number) => {
    if (!confirm(t("buildings.confirmDelete"))) return;
    try {
      const response = await adminFetch(`/buildings/${id}`, token, { method: "DELETE" });
      if (!response.ok) await throwApiError(response);
      showNotification(t("buildings.deleted"), "success");
      fetchBuildings();
    } catch (err) {
      const text = errorTextOf(err, "buildings.deleteFailed");
      showNotification(
        text.key === "errors.generic" ? t("buildings.deleteFailed") : t(text.key, text.values),
        "error",
      );
    }
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="p-6 border-b border-gray-100 flex justify-between items-center">
        <div>
          <h3 className="font-bold text-gray-900 flex items-center gap-2 text-lg">
            <Building2 size={20} className="text-indigo-600" />{" "}
            {t("buildings.title", { count: buildings.length })}
          </h3>
          <p className="text-xs text-gray-500">{t("buildings.subtitle")}</p>
        </div>
        <button
          onClick={onOpenAddModal}
          className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-medium shadow-sm transition-all"
        >
          <Plus size={16} /> {t("buildings.add")}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50/70 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider">
              <th className="py-3.5 px-6">{t("buildings.colName")}</th>
              <th className="py-3.5 px-6">{t("buildings.colAddress")}</th>
              <th className="py-3.5 px-6">{t("buildings.colWorkers")}</th>
              <th className="py-3.5 px-6">{t("buildings.colRadius")}</th>
              <th className="py-3.5 px-6 text-right">{t("buildings.colActions")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 text-sm">
            {buildings.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-12 text-center text-gray-400">
                  {t("buildings.empty")}
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
                      <Users size={12} />{" "}
                      {t("buildings.workers", { count: Number(b.total_workers) || 0 })}
                    </span>
                  </td>
                  <td className="py-4 px-6">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
                      {t("buildings.meters", { count: b.radius_meters })}
                    </span>
                  </td>
                  <td className="py-4 px-6 text-right space-x-1">
                    <button
                      onClick={() => onOpenEditModal(b)}
                      aria-label={t("common.edit")}
                      title={t("common.edit")}
                      className="text-gray-400 hover:text-indigo-600 p-2 rounded-lg transition-colors"
                    >
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={() => handleDelete(b.id)}
                      aria-label={t("common.delete")}
                      title={t("common.delete")}
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
