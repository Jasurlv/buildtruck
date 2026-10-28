import type { Request, RequestHandler } from "express";
import jwt, { type JwtPayload } from "jsonwebtoken";
import { getJwtSecret } from "../config.js";

export type AuthClaims = JwtPayload & {
  role: "admin" | "worker";
  workerId?: number;
};

declare global {
  namespace Express {
    interface Request {
      auth?: AuthClaims;
    }
  }
}

export function requireRole(role: AuthClaims["role"]): RequestHandler {
  return (req, res, next) => {
    const authorization = req.header("authorization");
    const [scheme, token] = authorization?.split(" ") ?? [];
    if (scheme !== "Bearer" || !token) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    try {
      const claims = jwt.verify(token, getJwtSecret());
      if (
        typeof claims === "string" ||
        claims.role !== role ||
        (role === "worker" &&
          (!Number.isInteger(Number(claims.workerId)) ||
            Number(claims.workerId) <= 0))
      ) {
        res.status(403).json({ error: "You are not allowed to access this resource" });
        return;
      }

      req.auth = claims as AuthClaims;
      next();
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        res.status(401).json({ error: "Invalid or expired token" });
        return;
      }
      next(error);
    }
  };
}

export function getAuthenticatedWorkerId(req: Request): number {
  if (req.auth?.role !== "worker" || !req.auth.workerId) {
    throw new Error("Authenticated worker identity is missing");
  }
  return req.auth.workerId;
}
