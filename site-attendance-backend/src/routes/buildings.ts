import { Router, Request, Response } from "express";
import pool from "../db/pool.js";
import { parseId, parseNumber, parseText } from "../validation.js";

const router = Router();

// GPS can jump tens of metres indoors, so a smaller zone would flag workers who are on
// site. Enforced here, not by a DB constraint: older rows below 50 m stay as they are
// and must be raised when next edited.
export const MIN_RADIUS_METERS = 50;
export const MAX_RADIUS_METERS = 500;
const RADIUS_ERROR = `The radius must be a whole number of meters from ${MIN_RADIUS_METERS} to ${MAX_RADIUS_METERS} (GPS can jump indoors).`;

type BuildingInput = {
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
};

function parseBuilding(body: any): BuildingInput | { error: string; code: string } {
  const name = parseText(body?.name, 255);
  const address = parseText(body?.address, 2000);
  const latitude = parseNumber(body?.latitude);
  const longitude = parseNumber(body?.longitude);
  const radius_meters =
    body?.radius_meters === undefined || body?.radius_meters === null
      ? MIN_RADIUS_METERS
      : parseNumber(body.radius_meters);
  if (
    !name ||
    !address ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    return { error: "Name, address and valid coordinates are required.", code: "INVALID_BUILDING" };
  }
  if (
    !Number.isInteger(radius_meters) ||
    radius_meters < MIN_RADIUS_METERS ||
    radius_meters > MAX_RADIUS_METERS
  ) {
    return { error: RADIUS_ERROR, code: "INVALID_RADIUS" };
  }
  return { name, address, latitude, longitude, radius_meters };
}

// GET all buildings with total workers count
router.get("/", async (req: Request, res: Response): Promise<any> => {
  try {
    const result = await pool.query(`
      SELECT b.*, COUNT(w.id) AS total_workers
      FROM buildings b
      LEFT JOIN workers w ON w.assigned_building_id = b.id
      GROUP BY b.id
      ORDER BY b.id DESC
    `);
    return res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error fetching buildings" });
  }
});

// POST create building with uniqueness check
router.post("/", async (req: Request, res: Response): Promise<any> => {
  const building = parseBuilding(req.body);
  if ("error" in building) return res.status(400).json(building);
  const { name, address, latitude, longitude, radius_meters } = building;
  try {
    const existing = await pool.query(
      `SELECT id FROM buildings WHERE LOWER(name) = LOWER($1)`,
      [name],
    );
    if (existing.rows.length > 0) {
      return res
        .status(400)
        .json({ error: "A building site with this name already exists." });
    }

    const result = await pool.query(
      `INSERT INTO buildings (name, address, latitude, longitude, radius_meters) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, address, latitude, longitude, radius_meters],
    );
    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error creating building" });
  }
});

// PUT update building with uniqueness check
router.put("/:id", async (req: Request, res: Response): Promise<any> => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(404).json({ error: "Building not found" });
  }
  const building = parseBuilding(req.body);
  if ("error" in building) return res.status(400).json(building);
  const { name, address, latitude, longitude, radius_meters } = building;
  try {
    const existing = await pool.query(
      `SELECT id FROM buildings WHERE LOWER(name) = LOWER($1) AND id != $2`,
      [name, id],
    );
    if (existing.rows.length > 0) {
      return res
        .status(400)
        .json({
          error: "Another building site with this name already exists.",
        });
    }

    const result = await pool.query(
      `UPDATE buildings SET name = $1, address = $2, latitude = $3, longitude = $4, radius_meters = $5 WHERE id = $6 RETURNING *`,
      [name, address, latitude, longitude, radius_meters, id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Building not found" });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error updating building" });
  }
});

// DELETE building
router.delete("/:id", async (req: Request, res: Response): Promise<any> => {
  const id = parseId(req.params.id);
  if (!id) {
    return res.status(404).json({ error: "Building not found" });
  }
  try {
    const result = await pool.query(`DELETE FROM buildings WHERE id = $1`, [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Building not found" });
    }
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error deleting building" });
  }
});

export default router;
