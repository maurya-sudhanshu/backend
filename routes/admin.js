import express from "express";
import { pool } from "../config/db.js";
import { verifyToken, COOKIE_NAME } from "../utils/auth.js";
import { checkUserSubscription } from "../utils/subscription.js";

const router = express.Router();

const requireAdmin = async (req, res, next) => {
  const token = req.cookies[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  const session = verifyToken(token);
  if (!session || !session.userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    const [userRows] = await pool.query("SELECT role FROM users WHERE id = ? LIMIT 1", [session.userId]);
    if (userRows.length === 0 || userRows[0].role !== "admin") {
      return res.status(403).json({ error: "Forbidden" });
    }
    req.userId = session.userId;
    next();
  } catch (err) {
    res.status(500).json({ error: "Server Error" });
  }
};

router.use(requireAdmin);

router.get("/overview", async (req, res) => {
  try {
    const [usersRes] = await pool.query("SELECT COUNT(*) as count FROM users");
    const [businessesRes] = await pool.query("SELECT COUNT(*) as count FROM businesses");
    
    res.json({
      totalUsers: usersRes[0].count,
      totalBusinesses: businessesRes[0].count
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch admin overview" });
  }
});

router.get("/users", async (req, res) => {
  try {
    const [users] = await pool.query(`
      SELECT u.id, u.email, u.full_name as fullName, u.role, u.created_at as createdAt, u.created_by_agent_id,
             s.plan, s.ai_tokens_used as aiTokensUsed, s.ai_tokens_limit as aiTokensLimit,
             s.max_branches as maxBranches, s.max_store_owners as maxStoreOwners,
             s.created_at as subCreatedAt, s.expires_at as expiresAt,
             (SELECT COUNT(*) FROM businesses b WHERE b.user_id = u.id) as businessesCount
      FROM users u
      LEFT JOIN subscriptions s ON u.id = s.user_id
      ORDER BY u.created_at DESC
    `);
    
    // Format response with full subscription details & calculated expiration status
    const formattedUsers = await Promise.all(users.map(async u => {
      let subData = null;
      if (u.plan) {
        const subCheck = await checkUserSubscription(u.id);
        subData = {
          plan: u.plan,
          aiTokensUsed: u.aiTokensUsed || 0,
          aiTokensLimit: u.aiTokensLimit || 0,
          maxBranches: u.maxBranches || 0,
          maxStoreOwners: u.maxStoreOwners || 0,
          createdAt: u.subCreatedAt || u.createdAt,
          expiresAt: subCheck.expiresAt ? subCheck.expiresAt.toISOString() : null,
          isExpired: subCheck.isExpired,
          trialStatus: subCheck.trialStatus,
          reason: subCheck.reason || null,
        };
      }
      return {
        id: u.id,
        email: u.email,
        fullName: u.fullName,
        role: u.role,
        createdAt: u.createdAt,
        createdByAgentId: u.created_by_agent_id,
        businessesCount: u.businessesCount,
        subscription: subData,
      };
    }));

    res.json({ users: formattedUsers });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

router.put("/users/:id", async (req, res) => {
  try {
    const { role, plan, expiresAt } = req.body;
    const userId = req.params.id;

    if (role) {
      await pool.query("UPDATE users SET role = ? WHERE id = ?", [role, userId]);
    }

    if (plan || expiresAt !== undefined) {
      const [subRows] = await pool.query("SELECT id FROM subscriptions WHERE user_id = ?", [userId]);
      const [planRows] = await pool.query("SELECT * FROM plans WHERE plan_key = ? LIMIT 1", [plan]);
      
      let aiTokensLimit = 0;
      let maxBranches = 0;
      let maxStoreOwners = 0;

      if (planRows.length > 0) {
        aiTokensLimit = planRows[0].ai_tokens_limit;
        maxBranches = planRows[0].max_branches;
        maxStoreOwners = planRows[0].max_store_owners;
      }

      if (plan === "none") {
        aiTokensLimit = 0;
        maxBranches = 0;
        maxStoreOwners = 0;
      }

      // Format custom expiresAt date
      let parsedExpiresAt = null;
      if (expiresAt && expiresAt !== "never" && expiresAt !== "none") {
        parsedExpiresAt = new Date(expiresAt);
        if (isNaN(parsedExpiresAt.getTime())) {
          parsedExpiresAt = null;
        }
      }

      if (subRows.length > 0) {
        if (expiresAt !== undefined) {
          await pool.query(
            "UPDATE subscriptions SET plan = ?, ai_tokens_limit = ?, max_branches = ?, max_store_owners = ?, expires_at = ? WHERE user_id = ?",
            [plan, aiTokensLimit, maxBranches, maxStoreOwners, parsedExpiresAt, userId]
          );
        } else {
          await pool.query(
            "UPDATE subscriptions SET plan = ?, ai_tokens_limit = ?, max_branches = ?, max_store_owners = ? WHERE user_id = ?",
            [plan, aiTokensLimit, maxBranches, maxStoreOwners, userId]
          );
        }
      } else {
        const crypto = await import("crypto");
        await pool.query(
          "INSERT INTO subscriptions (id, user_id, plan, ai_tokens_used, ai_tokens_limit, max_branches, max_store_owners, expires_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?)",
          [crypto.randomUUID(), userId, plan, aiTokensLimit, maxBranches, maxStoreOwners, parsedExpiresAt]
        );
      }
    }

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update user" });
  }
});

// AI Models Management
router.get("/ai-models", async (req, res) => {
  try {
    const [models] = await pool.query("SELECT id, provider, model_name as modelName, api_key as apiKey, is_active as isActive, status_error as statusError, created_at as createdAt FROM ai_models ORDER BY created_at DESC");
    res.json({ models });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch AI models" });
  }
});

router.post("/ai-models", async (req, res) => {
  try {
    const { provider, modelName, apiKey } = req.body;
    import("crypto").then(async crypto => {
      const id = crypto.randomUUID();
      // If this is the first model, make it active
      const [existing] = await pool.query("SELECT COUNT(*) as count FROM ai_models");
      const isActive = existing[0].count === 0 ? 1 : 0;
      
      await pool.query(
        "INSERT INTO ai_models (id, provider, model_name, api_key, is_active) VALUES (?, ?, ?, ?, ?)",
        [id, provider, modelName, apiKey, isActive]
      );
      res.json({ success: true, id });
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to add AI model" });
  }
});

router.put("/ai-models/:id/activate", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("UPDATE ai_models SET is_active = 0");
    await pool.query("UPDATE ai_models SET is_active = 1 WHERE id = ?", [id]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to activate AI model" });
  }
});

router.delete("/ai-models/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM ai_models WHERE id = ?", [id]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete AI model" });
  }
});

// Payment QR code & UPI ID settings
router.get("/payment-settings", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM payment_settings LIMIT 1");
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

router.post("/payment-settings", async (req, res) => {
  try {
    const { upi_id, qr_code } = req.body;
    const [rows] = await pool.query("SELECT id FROM payment_settings LIMIT 1");
    if (rows.length > 0) {
      await pool.query("UPDATE payment_settings SET upi_id = ?, qr_code = ? WHERE id = ?", [upi_id, qr_code, rows[0].id]);
    } else {
      const crypto = await import("crypto");
      await pool.query("INSERT INTO payment_settings (id, upi_id, qr_code) VALUES (?, ?, ?)", [crypto.randomUUID(), upi_id, qr_code]);
    }
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to save payment settings" });
  }
});

// Manage UTR verifications
router.get("/payment-verifications", async (req, res) => {
  try {
    const [verifications] = await pool.query(`
      SELECT pv.*, u.full_name as fullName, u.email
      FROM payment_verifications pv
      JOIN users u ON pv.user_id = u.id
      ORDER BY pv.created_at DESC
    `);
    res.json({ verifications });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch payment verifications" });
  }
});

router.put("/payment-verifications/:id", async (req, res) => {
  try {
    const { status } = req.body; // 'approved' or 'rejected'
    const { id } = req.params;

    if (!["approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    // Get the verification details
    const [verRows] = await pool.query("SELECT * FROM payment_verifications WHERE id = ? LIMIT 1", [id]);
    if (verRows.length === 0) {
      return res.status(404).json({ error: "Verification request not found" });
    }
    
    const ver = verRows[0];

    // Start database transaction
    await pool.query("START TRANSACTION");

    // Update verification status
    await pool.query("UPDATE payment_verifications SET status = ? WHERE id = ?", [status, id]);

    if (status === "approved") {
      // Approve plan: update user subscription
      const userId = ver.user_id;
      const plan = ver.plan;

      const [planRows] = await pool.query("SELECT * FROM plans WHERE plan_key = ? LIMIT 1", [plan]);
      
      let aiTokensLimit = 0;
      let maxBranches = 0;
      let maxStoreOwners = 0;

      if (planRows.length > 0) {
        aiTokensLimit = planRows[0].ai_tokens_limit;
        maxBranches = planRows[0].max_branches;
        maxStoreOwners = planRows[0].max_store_owners;
      }

      const [subRows] = await pool.query("SELECT id FROM subscriptions WHERE user_id = ?", [userId]);
      if (subRows.length > 0) {
        await pool.query(
          "UPDATE subscriptions SET plan = ?, ai_tokens_limit = ?, max_branches = ?, max_store_owners = ? WHERE user_id = ?",
          [plan, aiTokensLimit, maxBranches, maxStoreOwners, userId]
        );
      } else {
        const crypto = await import("crypto");
        await pool.query(
          "INSERT INTO subscriptions (id, user_id, plan, ai_tokens_used, ai_tokens_limit, max_branches, max_store_owners) VALUES (?, ?, ?, 0, ?, ?, ?)",
          [crypto.randomUUID(), userId, plan, aiTokensLimit, maxBranches, maxStoreOwners]
        );
      }
    }

    await pool.query("COMMIT");
    res.json({ success: true });
  } catch (error) {
    await pool.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: "Failed to update verification status" });
  }
});

// Support Contact Messages
router.get("/contact-messages", async (req, res) => {
  try {
    const [messages] = await pool.query("SELECT * FROM contact_messages ORDER BY created_at DESC");
    
    // Fetch replies for each message
    for (const m of messages) {
      const [replies] = await pool.query(
        "SELECT * FROM support_replies WHERE ticket_id = ? ORDER BY created_at ASC",
        [m.id]
      );
      m.replies = replies;
    }

    res.json({ messages });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch contact messages" });
  }
});

router.post("/contact-messages/:id/reply", async (req, res) => {
  try {
    const { id } = req.params;
    const { reply, image } = req.body;

    if (!reply || !reply.trim()) {
      return res.status(400).json({ error: "Reply text is required" });
    }

    const crypto = await import("crypto");
    const replyId = crypto.randomUUID();

    await pool.query(
      "INSERT INTO support_replies (id, ticket_id, sender_role, sender_name, message, image) VALUES (?, ?, 'admin', 'Administrator', ?, ?)",
      [replyId, id, reply.trim(), image || null]
    );

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to submit reply" });
  }
});

router.post("/contact-messages/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // 'open' or 'closed'

    if (!status || (status !== "open" && status !== "closed")) {
      return res.status(400).json({ error: "Invalid status" });
    }

    await pool.query("UPDATE contact_messages SET status = ? WHERE id = ?", [status, id]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update ticket status" });
  }
});

// Plan CRUD management
router.get("/plans", async (req, res) => {
  try {
    const [plans] = await pool.query("SELECT * FROM plans ORDER BY type DESC, price ASC");
    res.json({ plans });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch plans" });
  }
});

router.post("/plans", async (req, res) => {
  try {
    const { name, plan_key, price, ai_tokens_limit, max_branches, max_store_owners, type, features } = req.body;

    if (!name || !plan_key) {
      return res.status(400).json({ error: "Missing required fields (name, plan_key)" });
    }

    const crypto = await import("crypto");
    const id = crypto.randomUUID();

    await pool.query(
      "INSERT INTO plans (id, name, plan_key, price, ai_tokens_limit, max_branches, max_store_owners, type, features) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, name, plan_key, price || 0, ai_tokens_limit || 0, max_branches || 0, max_store_owners || 0, type || "user", features || ""]
    );

    res.status(201).json({ success: true, id });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to create plan" });
  }
});

router.put("/plans/:id", async (req, res) => {
  try {
    const { name, plan_key, price, ai_tokens_limit, max_branches, max_store_owners, type, features } = req.body;
    const { id } = req.params;

    await pool.query(
      "UPDATE plans SET name = ?, plan_key = ?, price = ?, ai_tokens_limit = ?, max_branches = ?, max_store_owners = ?, type = ?, features = ? WHERE id = ?",
      [name, plan_key, price, ai_tokens_limit, max_branches, max_store_owners, type, features, id]
    );

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update plan" });
  }
});

router.delete("/plans/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM plans WHERE id = ?", [id]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete plan" });
  }
});

export default router;
