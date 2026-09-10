import express from 'express';
import cors from 'cors';
import { env } from './config/env.js';

import cookieParser from "cookie-parser";
import authRoutes from "./routes/auth.js";
import businessesRoutes from "./routes/businesses.js";
import branchesRoutes from "./routes/branches.js";
import branchRoutes from "./routes/branch.js";
import analyticsRoutes from "./routes/analytics.js";
import reviewsRoutes from "./routes/reviews.js";
import agentsRoutes from "./routes/agents.js";
import adminRoutes from "./routes/admin.js";
import aiRoutes from "./routes/ai.js";
import paymentRoutes from "./routes/payments.js";

import { pool } from "./config/db.js";

const app = express();
const port = env.PORT;

async function initDB() {
  try {
    // Modify column type for plan in subscriptions if it is restricted (e.g. enum or short varchar)
    try {
      await pool.query("ALTER TABLE subscriptions MODIFY COLUMN plan VARCHAR(50) NOT NULL DEFAULT 'free'");
      console.log("Subscriptions table modified successfully.");
    } catch (alterErr) {
      console.error("Non-critical error altering subscriptions table:", alterErr.message);
    }

    try {
      await pool.query("ALTER TABLE subscriptions MODIFY COLUMN expires_at TIMESTAMP NULL DEFAULT NULL");
      console.log("Subscriptions expires_at column updated successfully.");
    } catch (alterErr) {
      console.error("Non-critical error altering subscriptions expires_at:", alterErr.message);
    }

    try {
      await pool.query("ALTER TABLE subscriptions ADD COLUMN trial_status VARCHAR(20) NOT NULL DEFAULT 'NOT_STARTED'");
      console.log("Subscriptions trial_status column added.");
    } catch (e) {}

    try {
      await pool.query("ALTER TABLE subscriptions ADD COLUMN trial_started_at TIMESTAMP NULL DEFAULT NULL");
      console.log("Subscriptions trial_started_at column added.");
    } catch (e) {}

    // Add status column to users table
    try {
      await pool.query("ALTER TABLE users ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active'");
      console.log("Users table modified with status column.");
    } catch (e) {
      // column already exists, ignore
    }

    // Add reply, keyword, updated_at columns to reviews table
    try {
      await pool.query("ALTER TABLE reviews ADD COLUMN reply TEXT DEFAULT NULL");
      console.log("Reviews table modified with reply column.");
    } catch (e) {}

    try {
      await pool.query("ALTER TABLE reviews ADD COLUMN keyword VARCHAR(255) DEFAULT NULL");
      console.log("Reviews table modified with keyword column.");
    } catch (e) {}

    try {
      await pool.query("ALTER TABLE reviews MODIFY COLUMN status VARCHAR(20) NOT NULL DEFAULT 'public'");
      console.log("Reviews table status column modified to VARCHAR(20).");
    } catch (e) {}

    try {
      await pool.query("ALTER TABLE reviews ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP");
      console.log("Reviews table modified with updated_at column.");
    } catch (e) {}

    // Add keywords column to branches table
    try {
      await pool.query("ALTER TABLE branches ADD COLUMN keywords TEXT DEFAULT NULL");
      console.log("Branches table modified with keywords column.");
    } catch (e) {
      // column already exists, ignore
    }

    // Add status_error column to ai_models table
    try {
      await pool.query("ALTER TABLE ai_models ADD COLUMN status_error TEXT DEFAULT NULL");
      console.log("AI models table modified with status_error column.");
    } catch (e) {
      // column already exists, ignore
    }

    // Create contact_messages table if it does not exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS contact_messages (
        id VARCHAR(36) NOT NULL,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        plan VARCHAR(50) DEFAULT NULL,
        reply TEXT DEFAULT NULL,
        image LONGTEXT DEFAULT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'open',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log("Contact messages table checked/created.");

    // Add image column to contact_messages if table already exists
    try {
      await pool.query("ALTER TABLE contact_messages ADD COLUMN image LONGTEXT DEFAULT NULL");
    } catch (e) {}

    // Add status column to contact_messages if table already exists
    try {
      await pool.query("ALTER TABLE contact_messages ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'open'");
    } catch (e) {}

    // Create support_replies table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS support_replies (
        id VARCHAR(36) NOT NULL,
        ticket_id VARCHAR(36) NOT NULL,
        sender_role VARCHAR(20) NOT NULL,
        sender_name VARCHAR(255) NOT NULL,
        message TEXT NOT NULL,
        image LONGTEXT DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log("Support replies table checked/created.");

    // Check if there are legacy replies in contact_messages to migrate
    try {
      const [legacyTickets] = await pool.query(
        "SELECT id, reply, name FROM contact_messages WHERE reply IS NOT NULL AND reply != ''"
      );
      if (legacyTickets.length > 0) {
        const crypto = await import("crypto");
        for (const t of legacyTickets) {
          const replyId = crypto.randomUUID();
          await pool.query(
            "INSERT INTO support_replies (id, ticket_id, sender_role, sender_name, message) VALUES (?, ?, 'admin', 'Administrator', ?)",
            [replyId, t.id, t.reply]
          );
        }
        // Clear legacy replies so we don't migrate them again next boot
        await pool.query("UPDATE contact_messages SET reply = NULL");
        console.log(`Migrated ${legacyTickets.length} legacy replies to support_replies.`);
      }
    } catch (e) {
      console.error("Failed to migrate legacy replies:", e);
    }

    await pool.query(`
      CREATE TABLE IF NOT EXISTS payment_settings (
        id VARCHAR(36) NOT NULL,
        upi_id VARCHAR(255) DEFAULT NULL,
        qr_code LONGTEXT DEFAULT NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS payment_verifications (
        id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        plan VARCHAR(50) NOT NULL,
        utr_number VARCHAR(100) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY fk_payment_verification_user (user_id),
        CONSTRAINT fk_payment_verification_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS plans (
        id VARCHAR(36) NOT NULL,
        name VARCHAR(100) NOT NULL,
        plan_key VARCHAR(50) NOT NULL UNIQUE,
        price DECIMAL(10,2) NOT NULL,
        ai_tokens_limit INT(11) NOT NULL,
        max_branches INT(11) NOT NULL,
        max_store_owners INT(11) NOT NULL,
        type ENUM('user','agent') NOT NULL DEFAULT 'user',
        features TEXT DEFAULT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    // Check if plans exist, if not seed them
    const [existingPlans] = await pool.query("SELECT COUNT(*) as count FROM plans");
    if (existingPlans[0].count === 0) {
      const crypto = await import("crypto");
      const defaultPlans = [
        // User plans
        [crypto.randomUUID(), "Silver Plan", "silver", 999.00, 10000, 2, 5, "user", "Up to 2 Branches,10,000 AI Tokens/mo,Basic Analytics,Up to 5 Store Owners"],
        [crypto.randomUUID(), "Gold Plan", "gold", 2499.00, 50000, 10, 20, "user", "Up to 10 Branches,50,000 AI Tokens/mo,Advanced Analytics,Agent Accounts,Up to 20 Store Owners"],
        [crypto.randomUUID(), "Platinum Plan", "platinum", 4999.00, 200000, 50, 100, "user", "Unlimited Branches,200,000 AI Tokens/mo,Custom Branding,Priority Support,Unlimited Store Owners"],
        // Agent plans
        [crypto.randomUUID(), "Agent Basic", "agent_basic", 0.00, 5000, 1, 0, "agent", "1 Branch,5,000 AI Tokens/mo"],
        [crypto.randomUUID(), "Agent Pro", "agent_pro", 1999.00, 25000, 5, 0, "agent", "5 Branches,25,000 AI Tokens/mo"],
        [crypto.randomUUID(), "Agent Enterprise", "agent_enterprise", 4999.00, 100000, 20, 0, "agent", "20 Branches,100,000 AI Tokens/mo"]
      ];

      for (const p of defaultPlans) {
        await pool.query(
          "INSERT INTO plans (id, name, plan_key, price, ai_tokens_limit, max_branches, max_store_owners, type, features) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
          p
        );
      }
      console.log("Database seeded with default plans in INR.");
    }

    // Update existing legacy plan prices to standard clean INR values if needed
    try {
      await pool.query("UPDATE plans SET price = 999.00 WHERE plan_key = 'silver' AND price < 500");
      await pool.query("UPDATE plans SET price = 2499.00 WHERE plan_key = 'gold' AND price < 500");
      await pool.query("UPDATE plans SET price = 4999.00 WHERE plan_key = 'platinum' AND price < 500");
      await pool.query("UPDATE plans SET price = 1999.00 WHERE plan_key = 'agent_pro' AND (price < 500 AND price > 0)");
      await pool.query("UPDATE plans SET price = 4999.00 WHERE plan_key = 'agent_enterprise' AND price < 500");
    } catch (e) {
      console.error("Non-critical error updating INR plan prices:", e.message);
    }

    // Ensure free plan exists in plans table
    try {
      const [freeRows] = await pool.query("SELECT id FROM plans WHERE plan_key = 'free' LIMIT 1");
      if (freeRows.length === 0) {
        const crypto = await import("crypto");
        await pool.query(
          "INSERT INTO plans (id, name, plan_key, price, ai_tokens_limit, max_branches, max_store_owners, type, features) VALUES (?, '14-Day Free Trial', 'free', 0.00, 5000, 1, 1, 'user', '1 Branch,5,000 AI Tokens/mo,14-Day Free Trial Access,1 Store Owner')",
          [crypto.randomUUID()]
        );
        console.log("Seeded 14-Day Free Trial plan in plans table.");
      }
    } catch (e) {
      console.error("Non-critical error seeding free plan:", e.message);
    }

    console.log("Database payment tables checked/created.");
  } catch (err) {
    console.error("Failed to initialize database tables:", err);
  }
}
initDB();

app.use(cors({
  origin: ["http://localhost:3000", "https://autorevio.com", "https://www.autorevio.com"],
  credentials: true,
}));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));
app.use(cookieParser());

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/businesses", businessesRoutes);
app.use("/api/branches", branchesRoutes);
app.use("/api/branch", branchRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/reviews", reviewsRoutes);
app.use("/api/agents", agentsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/ai", aiRoutes);
app.use("/api/payments", paymentRoutes);

app.listen(port, () => {
  console.log(`Backend server running on port ${port}`);
});
