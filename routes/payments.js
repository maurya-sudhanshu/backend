import express from "express";
import { pool } from "../config/db.js";
import { verifyToken, COOKIE_NAME } from "../utils/auth.js";

const router = express.Router();

// Middleware to check authentication
const requireAuth = (req, res, next) => {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const session = verifyToken(token);
  if (!session || !session.userId) return res.status(401).json({ error: "Unauthorized" });

  req.userId = session.userId;
  next();
};

// GET active payment settings (UPI ID & QR Code)
router.get("/settings", requireAuth, async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT upi_id, qr_code FROM payment_settings LIMIT 1");
    if (rows.length > 0) {
      res.json(rows[0]);
    } else {
      res.json({ upi_id: "", qr_code: "" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch payment settings" });
  }
});

// POST submit a payment verification request (with UTR number)
router.post("/verify", requireAuth, async (req, res) => {
  try {
    const { plan, utr_number, amount } = req.body;

    if (!plan || !utr_number || !amount) {
      return res.status(400).json({ error: "Missing required fields (plan, utr_number, amount)" });
    }

    // Check if there's already a pending verification for this user
    const [existing] = await pool.query(
      "SELECT id FROM payment_verifications WHERE user_id = ? AND status = 'pending' LIMIT 1",
      [req.userId]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: "You already have a pending verification request." });
    }

    const crypto = await import("crypto");
    const id = crypto.randomUUID();

    await pool.query(
      "INSERT INTO payment_verifications (id, user_id, plan, utr_number, amount, status) VALUES (?, ?, ?, ?, ?, 'pending')",
      [id, req.userId, plan, utr_number, amount]
    );

    res.status(201).json({ success: true, message: "Verification request submitted successfully." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to submit verification request" });
  }
});

// POST start-trial - Activate 14-day free trial (NOT_STARTED -> ACTIVE)
router.post("/start-trial", requireAuth, async (req, res) => {
  try {
    const userId = req.userId;
    const [subRows] = await pool.query(
      "SELECT id, plan, trial_status, expires_at FROM subscriptions WHERE user_id = ? LIMIT 1",
      [userId]
    );

    if (subRows.length > 0) {
      const sub = subRows[0];
      const status = sub.trial_status || "NOT_STARTED";
      
      // Rule 3 & 4: Permanent Expiration Lock - Reject if already EXPIRED or plan === 'expired'
      if (status === "EXPIRED" || sub.plan === "expired") {
        return res.status(403).json({
          error: "Your trial period has expired and cannot be reactivated. Please select a paid plan to continue.",
          trialStatus: "EXPIRED"
        });
      }

      // If trial is already active, return active status
      if (status === "ACTIVE") {
        return res.json({
          message: "Your free trial is currently active.",
          trialStatus: "ACTIVE",
          expiresAt: sub.expires_at
        });
      }

      // Transition NOT_STARTED -> ACTIVE
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

      await pool.query(
        "UPDATE subscriptions SET trial_status = 'ACTIVE', trial_started_at = ?, expires_at = ?, ai_tokens_limit = 5000, max_branches = 1, max_store_owners = 1 WHERE user_id = ?",
        [now, expiresAt, userId]
      );

      return res.json({
        success: true,
        message: "14-Day Free Trial activated successfully!",
        trialStatus: "ACTIVE",
        startedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString()
      });
    } else {
      // Insert new ACTIVE trial subscription
      const crypto = await import("crypto");
      const id = crypto.randomUUID();
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

      await pool.query(
        "INSERT INTO subscriptions (id, user_id, plan, ai_tokens_used, ai_tokens_limit, max_branches, max_store_owners, trial_status, trial_started_at, expires_at) VALUES (?, ?, 'free', 0, 5000, 1, 1, 'ACTIVE', ?, ?)",
        [id, userId, now, expiresAt]
      );

      return res.json({
        success: true,
        message: "14-Day Free Trial activated successfully!",
        trialStatus: "ACTIVE",
        startedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString()
      });
    }
  } catch (error) {
    console.error("Start trial error:", error);
    res.status(500).json({ error: "Failed to activate free trial" });
  }
});

// GET all active plans for users dynamically based on role
router.get("/plans", async (req, res) => {
  try {
    let type = "user";
    const token = req.cookies[COOKIE_NAME];
    if (token) {
      const session = verifyToken(token);
      if (session && session.userId) {
        const [userRows] = await pool.query("SELECT role FROM users WHERE id = ? LIMIT 1", [session.userId]);
        if (userRows.length > 0 && userRows[0].role === "agent") {
          type = "agent";
        }
      }
    }

    const [plans] = await pool.query("SELECT * FROM plans WHERE type = ? ORDER BY price ASC", [type]);
    
    // Ensure 14-Day Free Trial plan is included for store owner user plans
    if (type === "user") {
      const hasFree = plans.some(p => p.plan_key === "free");
      if (!hasFree) {
        plans.unshift({
          id: "free",
          name: "14-Day Free Trial",
          plan_key: "free",
          price: 0.00,
          ai_tokens_limit: 5000,
          max_branches: 1,
          max_store_owners: 1,
          type: "user",
          features: "1 Branch,5,000 AI Tokens/mo,14-Day Free Trial Access,1 Store Owner"
        });
      }
    }

    res.json({ plans });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch plans" });
  }
});

export default router;
