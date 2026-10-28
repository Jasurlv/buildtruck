import bcrypt from "bcrypt";
import { readFile } from "node:fs/promises";
import pool from "../db/pool.js";

async function createAdmin(): Promise<void> {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password || password.length < 12) {
    throw new Error(
      "Set ADMIN_USERNAME and an ADMIN_PASSWORD of at least 12 characters in the environment",
    );
  }

  const migration = await readFile(
    new URL("../db/migrations/001_create_admins.sql", import.meta.url),
    "utf8",
  );
  await pool.query(migration);

  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query(
    "INSERT INTO admins (username, password_hash) VALUES ($1, $2)",
    [username, passwordHash],
  );
  console.log(`Created admin account "${username}".`);
}

createAdmin()
  .catch((error: unknown) => {
    console.error("Unable to create admin account:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
