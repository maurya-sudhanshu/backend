import { pool } from "./src/db/index.js";

async function promote() {
  try {
    const email = 'sudhanshumauryaspn@gmail.com';
    const [result] = await pool.query("UPDATE users SET role = 'admin' WHERE email = ?", [email]);
    console.log(`Promoted user. Rows affected: ${result.affectedRows}`);
  } catch (error) {
    console.error(error);
  } finally {
    process.exit(0);
  }
}

promote();
