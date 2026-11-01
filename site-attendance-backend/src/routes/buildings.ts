import { Router, Request, Response } from "express";
import pool from "../db/pool.js";
import { parseId, parseNumber, parseText } from "../validation.js";

const router = Router();

function parseBuilding(body: any) {
  const name = parseText(body?.name, 255);
  const address = parseText(body?.address, 2000);
  const latitude = parseNumber(body?.latitude);
  const longitude = parseNumber(body?.longitude);
  const radius_meters =
    body?.radius_meters === undefined || body?.radius_meters === null
      ? 30
      : parseNumber(body.radius_meters);
  if (
    !name ||
    !address ||
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180 ||
    !Number.isInteger(radius_meters) ||
    radius_meters < 1 ||
    radius_meters > 5000
  ) {
    return null;
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
  if (!building) {
    return res.status(400).json({
      error: "Name, address, valid coordinates and a radius of 1-5000 meters are required.",
    });
  }
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
  if (!building) {
    return res.status(400).json({
      error: "Name, address, valid coordinates and a radius of 1-5000 meters are required.",
    });
  }
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
