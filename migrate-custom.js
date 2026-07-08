import { pool } from "./src/db/index.js";

async function run() {
  try {
    console.log("Adding role to users...");
    await pool.query("ALTER TABLE users ADD COLUMN role ENUM('admin', 'owner', 'agent') NOT NULL DEFAULT 'owner';");
  } catch (e) {
    console.log("role column might exist: ", e.message);
  }

  try {
    console.log("Adding users_role_idx...");
    await pool.query("CREATE INDEX users_role_idx ON users (role);");
  } catch (e) {
    console.log("index might exist: ", e.message);
  }

  try {
    console.log("Adding stripe fields to subscriptions...");
    await pool.query("ALTER TABLE subscriptions ADD COLUMN stripe_customer_id VARCHAR(255);");
    await pool.query("ALTER TABLE subscriptions ADD COLUMN stripe_subscription_id VARCHAR(255);");
    await pool.query("ALTER TABLE subscriptions ADD COLUMN stripe_price_id VARCHAR(255);");
  } catch (e) {
    console.log("stripe fields might exist: ", e.message);
  }

  try {
    console.log("Creating agent_branches table...");
    await pool.query(`
      CREATE TABLE IF NOT EXISTS agent_branches (
        id VARCHAR(36) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        branch_id VARCHAR(36) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        UNIQUE INDEX agent_branch_idx (user_id, branch_id)
      );
    `);
  } catch (e) {
    console.log("Failed to create agent_branches: ", e.message);
  }

  console.log("Done.");
  process.exit(0);
}

run();
