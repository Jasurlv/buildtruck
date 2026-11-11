import { Router, type Request, type Response } from "express";
import pool from "../db/pool.js";
import { getAppTimezone } from "../config.js";
import { closeOverdueShifts } from "../shiftStore.js";
import { parseId } from "../validation.js";

const router = Router();
const DAY_MS = 24 * 60 * 60 * 1000;

const PAGE_SIZES = [10, 25, 50, 100];
const DEFAULT_PAGE_SIZE = 10;
const SEARCH_MAX_LENGTH = 100;
// Response without pagination params (kept for older clients).
const LEGACY_ROW_LIMIT = 5000;
const EXPORT_MAX_ROWS = 50_000;

type ReportFilters = {
  startDate: string;
  endDate: string;
  search: string | null;
};

function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** start_date, end_date (inclusive) and search; returns an error message for a 400. */
function parseFilters(query: Request["query"]): ReportFilters | { error: string } {
  // en-CA formats as YYYY-MM-DD; dates follow the building sites' calendar.
  const siteDate = new Intl.DateTimeFormat("en-CA", { timeZone: getAppTimezone() });
  const startDate = query.start_date ?? siteDate.format(new Date(Date.now() - 29 * DAY_MS));
  const endDate = query.end_date ?? siteDate.format(new Date());
  if (!isDate(startDate) || !isDate(endDate) || startDate > endDate) {
    return { error: "Provide valid start_date and end_date values (YYYY-MM-DD)" };
  }

  let search: string | null = null;
  if (query.search !== undefined) {
    if (typeof query.search !== "string") {
      return { error: "search must be a single text value" };
    }
    search = query.search.trim() || null;
    if (search && search.length > SEARCH_MAX_LENGTH) {
      return { error: `search must be at most ${SEARCH_MAX_LENGTH} characters` };
    }
  }
  return { startDate, endDate, search };
}

function parsePagination(
  query: Request["query"],
): { page: number; pageSize: number } | { error: string } {
  const page = query.page === undefined ? 1 : parseId(query.page);
  if (page === null) {
    return { error: "page must be a positive whole number" };
  }
  const pageSize =
    query.page_size === undefined
      ? DEFAULT_PAGE_SIZE
      : typeof query.page_size === "string" && /^\d+$/.test(query.page_size)
        ? Number(query.page_size)
        : NaN;
  if (!PAGE_SIZES.includes(pageSize)) {
    return { error: `page_size must be one of ${PAGE_SIZES.join(", ")}` };
  }
  return { page, pageSize };
}

const FROM_REPORT = `
  FROM attendance_logs a
  JOIN workers w ON w.id = a.worker_id
  LEFT JOIN buildings b ON b.id = a.building_id`;

const ROW_COLUMNS = `
  a.id, w.full_name, w.username, b.name AS building_name, a.work_date,
  a.punch_in_time, a.lunch_start_time, a.lunch_end_time, a.end_work_time,
  a.total_worked_hours, a.daily_earned,
  a.punch_in_time AS arrival_at, a.paid_start_at, a.scheduled_start_at,
  ROUND(EXTRACT(EPOCH FROM (a.paid_start_at - a.punch_in_time)) / 60)::int AS waiting_minutes,
  CASE WHEN a.scheduled_start_at IS NOT NULL
    THEN GREATEST(0, ROUND(EXTRACT(EPOCH FROM (a.paid_start_at - a.scheduled_start_at)) / 60))::int
  END AS lateness_minutes,
  a.lunch_minutes, a.lunch_deducted_minutes,
  a.break_minutes, a.auto_closed`;

// Stable across pages: ids break ties within a day.
const ORDER_BY = "ORDER BY a.work_date DESC, a.id DESC";

/** WHERE clause and its parameters ($1, $2, ...); user input is never put in the SQL. */
function whereClause(filters: ReportFilters): { where: string; params: unknown[] } {
  const params: unknown[] = [filters.startDate, filters.endDate];
  let where = "a.work_date BETWEEN $1::date AND $2::date";
  if (filters.search) {
    // Match the text literally: escape LIKE's wildcards (% and _) and the escape
    // character itself, then search anywhere in the value.
    params.push(`%${filters.search.replace(/[\\%_]/g, "\\$&")}%`);
    // Match the (few) workers and sites first, then their shifts by id: same
    // result as filtering the joined rows, but ILIKE runs per worker/site, not
    // per shift (~3x faster over a year of data).
    where += `
      AND (a.worker_id IN (SELECT id FROM workers
                           WHERE full_name ILIKE $3 ESCAPE '\\' OR username ILIKE $3 ESCAPE '\\')
        OR a.building_id IN (SELECT id FROM buildings WHERE name ILIKE $3 ESCAPE '\\'))`;
  }
  return { where, params };
}

/** Totals over ALL rows matching the filters, not just one page. */
async function queryTotals(where: string, params: unknown[]) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS periods,
            COALESCE(SUM(a.total_worked_hours), 0) AS hours,
            COALESCE(SUM(a.daily_earned), 0) AS earnings
     ${FROM_REPORT}
     WHERE ${where}`,
    params,
  );
  const row = result.rows[0];
  // NUMERIC sums arrive as exact decimal strings.
  return { periods: row.periods, hours: Number(row.hours), earnings: Number(row.earnings) };
}

function filterEcho(filters: ReportFilters) {
  return { start_date: filters.startDate, end_date: filters.endDate, search: filters.search };
}

// GET /api/reports
// With page and/or page_size: one page of rows plus totals for all matches.
// Without them: the original response shape ({ shifts, totals, truncated }).
router.get("/", async (req: Request, res: Response): Promise<any> => {
  const filters = parseFilters(req.query);
  if ("error" in filters) return res.status(400).json({ error: filters.error });
  const { where, params } = whereClause(filters);

  const paginated = req.query.page !== undefined || req.query.page_size !== undefined;
  try {
    // Lazy check: shifts past the limit show as closed even if the timer has not run yet.
    await closeOverdueShifts(new Date());
    if (!paginated) {
      const result = await pool.query(
        `SELECT ${ROW_COLUMNS} ${FROM_REPORT} WHERE ${where} ${ORDER_BY} LIMIT ${LEGACY_ROW_LIMIT}`,
        params,
      );
      const shifts = result.rows;
      return res.json({
        ...filterEcho(filters),
        shifts,
        totals: {
          worked_hours: shifts.reduce(
            (sum: number, row: { total_worked_hours: string | number | null }) =>
              sum + Number(row.total_worked_hours || 0),
            0,
          ),
          earned: shifts.reduce(
            (sum: number, row: { daily_earned: string | number | null }) =>
              sum + Number(row.daily_earned || 0),
            0,
          ),
          shift_count: shifts.length,
        },
        truncated: shifts.length === LEGACY_ROW_LIMIT,
      });
    }

    const pagination = parsePagination(req.query);
    if ("error" in pagination) return res.status(400).json({ error: pagination.error });
    const { page, pageSize } = pagination;
    const limitParam = params.length + 1;
    const [rowsResult, totals] = await Promise.all([
      pool.query(
        `SELECT ${ROW_COLUMNS} ${FROM_REPORT} WHERE ${where} ${ORDER_BY}
         LIMIT $${limitParam} OFFSET $${limitParam + 1}`,
        [...params, pageSize, (page - 1) * pageSize],
      ),
      queryTotals(where, params),
    ]);
    return res.json({
      ...filterEcho(filters),
      rows: rowsResult.rows,
      page,
      page_size: pageSize,
      total_rows: totals.periods,
      total_pages: Math.max(1, Math.ceil(totals.periods / pageSize)),
      totals,
    });
  } catch (error) {
    console.error("Attendance report query failed:", error);
    return res.status(500).json({ error: "Unable to load attendance report" });
  }
});

// GET /api/reports/export: every row matching the filters (no pagination), for CSV.
router.get("/export", async (req: Request, res: Response): Promise<any> => {
  const filters = parseFilters(req.query);
  if ("error" in filters) return res.status(400).json({ error: filters.error });
  const { where, params } = whereClause(filters);

  try {
    await closeOverdueShifts(new Date());
    const totals = await queryTotals(where, params);
    if (totals.periods > EXPORT_MAX_ROWS) {
      return res.status(400).json({
        error: `Too many rows to export: ${totals.periods} match these filters (limit ${EXPORT_MAX_ROWS}). Narrow the date range or search.`,
      });
    }
    const result = await pool.query(
      `SELECT ${ROW_COLUMNS} ${FROM_REPORT} WHERE ${where} ${ORDER_BY} LIMIT ${EXPORT_MAX_ROWS}`,
      params,
    );
    return res.json({
      ...filterEcho(filters),
      rows: result.rows,
      total_rows: result.rows.length,
      totals,
    });
  } catch (error) {
    console.error("Attendance report export failed:", error);
    return res.status(500).json({ error: "Unable to export attendance report" });
  }
});

export default router;
