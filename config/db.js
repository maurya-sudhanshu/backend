import mysql from "mysql2/promise";
import { env } from "./env.js";

const databaseUrl = env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const globalForDb = globalThis;

export const pool =
  globalForDb.__arenaNextJsMysqlPool ??
  mysql.createPool({
    uri: databaseUrl,
  });

if (env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsMysqlPool = pool;
}
