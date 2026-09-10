import express from "express";
import crypto from "crypto";
import { z } from "zod";
import { pool } from "../config/db.js";
import { hashPassword, comparePassword, signToken, COOKIE_NAME, verifyToken } from "../utils/auth.js";
import { env } from "../config/env.js";
import { checkUserSubscription } from "../utils/subscription.js";

const router = express.Router();

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  fullName: z.string().min(2),
  phone: z.string().min(1, "Phone number is required"),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

router.post("/signup", async (req, res) => {
  try {
    const data = signupSchema.parse(req.body);

    // Check if user exists
    const [existingRows] = await pool.query("SELECT id FROM users WHERE email = ? LIMIT 1", [data.email]);
    if (existingRows.length > 0) {
      return res.status(400).json({ error: "Email already registered" });
    }

    // Create user
    const password_hash = await hashPassword(data.password);
    const userId = crypto.randomUUID();
    
    await pool.query(
      "INSERT INTO users (id, email, password_hash, full_name, phone) VALUES (?, ?, ?, ?, ?)",
      [userId, data.email, password_hash, data.fullName, data.phone || null]
    );

    // Create free subscription with trial_status = 'NOT_STARTED' (inactive on first login)
    const subId = crypto.randomUUID();
    await pool.query(
      "INSERT INTO subscriptions (id, user_id, plan, ai_tokens_used, ai_tokens_limit, max_branches, max_store_owners, trial_status, trial_started_at, expires_at) VALUES (?, ?, 'free', 0, 0, 0, 0, 'NOT_STARTED', NULL, NULL)",
      [subId, userId]
    );

    // Create session
    const token = signToken({ userId: userId });

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days in ms
    });

    res.json({
      user: {
        id: userId,
        email: data.email,
        fullName: data.fullName,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0].message });
    }
    console.error("Signup error:", error);
    res.status(500).json({ error: "Failed to signup" });
  }
});

router.post("/login", async (req, res) => {
  try {
    const data = loginSchema.parse(req.body);

    const [rows] = await pool.query("SELECT * FROM users WHERE email = ? LIMIT 1", [data.email]);
    const user = rows[0];

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    if (user.status === "suspended") {
      return res.status(403).json({ error: "Your account has been suspended. Please contact support." });
    }

    const valid = await comparePassword(data.password, user.password_hash);

    if (!valid) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const token = signToken({ userId: user.id });

    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      secure: env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0].message });
    }
    console.error("Login error:", error);
    res.status(500).json({ error: "Failed to login" });
  }
});

router.post("/logout", (req, res) => {
  res.cookie(COOKIE_NAME, "", {
    httpOnly: true,
    secure: env.NODE_ENV === "production",
    sameSite: "lax",
    expires: new Date(0),
  });
  res.json({ success: true });
});

router.get("/me", async (req, res) => {
  try {
    const token = req.cookies[COOKIE_NAME];
    if (!token) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const session = verifyToken(token);
    if (!session || !session.userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const [rows] = await pool.query("SELECT id, email, full_name, phone, role, status FROM users WHERE id = ? LIMIT 1", [session.userId]);
    const user = rows[0];

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.status === "suspended") {
      return res.status(403).json({ error: "Account suspended" });
    }

    const subCheck = await checkUserSubscription(user.id);
    const [subRows] = await pool.query(
      "SELECT plan, ai_tokens_used, ai_tokens_limit, max_branches, max_store_owners, created_at, expires_at, trial_status, trial_started_at FROM subscriptions WHERE user_id = ? LIMIT 1",
      [user.id]
    );

    let subscription = null;
    if (subRows.length > 0) {
      const sub = subRows[0];
      subscription = {
        plan: sub.plan,
        aiTokensUsed: sub.ai_tokens_used || 0,
        aiTokensLimit: sub.ai_tokens_limit || 0,
        maxBranches: sub.max_branches || 0,
        maxStoreOwners: sub.max_store_owners || 0,
        createdAt: sub.created_at,
        expiresAt: subCheck.expiresAt ? subCheck.expiresAt.toISOString() : null,
        isExpired: subCheck.isExpired,
        trialStatus: subCheck.trialStatus,
        trialStartedAt: sub.trial_started_at,
        remainingDays: subCheck.remainingDays ?? null,
        remainingHours: subCheck.remainingHours ?? null,
        canSubmitReviews: subCheck.canSubmitReviews,
      };
    }

    res.json({ 
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        phone: user.phone,
        role: user.role,
        subscription,
      } 
    });
  } catch (error) {
    console.error("Me error:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// GET user's submitted support messages
router.get("/support", async (req, res) => {
  try {
    const token = req.cookies[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const session = verifyToken(token);
    if (!session || !session.userId) return res.status(401).json({ error: "Unauthorized" });

    // Get user's email
    const [userRows] = await pool.query("SELECT email FROM users WHERE id = ? LIMIT 1", [session.userId]);
    if (userRows.length === 0) return res.status(404).json({ error: "User not found" });

    const email = userRows[0].email;

    const [messages] = await pool.query(
      "SELECT * FROM contact_messages WHERE email = ? ORDER BY created_at DESC",
      [email]
    );

    // Fetch replies for each ticket
    for (const m of messages) {
      const [replies] = await pool.query(
        "SELECT * FROM support_replies WHERE ticket_id = ? ORDER BY created_at ASC",
        [m.id]
      );
      m.replies = replies;
    }

    res.json({ messages });
  } catch (error) {
    console.error("Get support messages error:", error);
    res.status(500).json({ error: "Failed to fetch support messages" });
  }
});

// GET support tickets for managed owners (called by agents)
router.get("/support/managed", async (req, res) => {
  try {
    const token = req.cookies[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const session = verifyToken(token);
    if (!session || !session.userId) return res.status(401).json({ error: "Unauthorized" });

    // Verify role is agent
    const [userRows] = await pool.query("SELECT role FROM users WHERE id = ? LIMIT 1", [session.userId]);
    if (userRows.length === 0 || userRows[0].role !== "agent") {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Get all contact messages from owners created by this agent
    const [messages] = await pool.query(
      `SELECT cm.* FROM contact_messages cm
       INNER JOIN users u ON cm.email = u.email
       WHERE u.created_by_agent_id = ?
       ORDER BY cm.created_at DESC`,
      [session.userId]
    );

    // Fetch replies for each
    for (const m of messages) {
      const [replies] = await pool.query(
        "SELECT * FROM support_replies WHERE ticket_id = ? ORDER BY created_at ASC",
        [m.id]
      );
      m.replies = replies;
    }

    res.json({ messages });
  } catch (error) {
    console.error("Get managed support error:", error);
    res.status(500).json({ error: "Failed to fetch managed owners' support tickets" });
  }
});

// POST user/agent replies to support ticket
router.post("/support/:id/reply", async (req, res) => {
  try {
    const token = req.cookies[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const session = verifyToken(token);
    if (!session || !session.userId) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const { message, image } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Reply text is required" });
    }

    // Verify ownership of ticket
    const [ticketRows] = await pool.query(
      "SELECT * FROM contact_messages WHERE id = ? LIMIT 1",
      [id]
    );
    if (ticketRows.length === 0) {
      return res.status(404).json({ error: "Ticket not found" });
    }

    const [userRows] = await pool.query("SELECT email, full_name, role FROM users WHERE id = ? LIMIT 1", [session.userId]);
    if (userRows.length === 0) return res.status(404).json({ error: "User not found" });

    // Verify ownership or agent relationship
    const [submitterRows] = await pool.query("SELECT id, created_by_agent_id FROM users WHERE email = ? LIMIT 1", [ticketRows[0].email]);
    const isOwner = ticketRows[0].email === userRows[0].email;
    const isAgent = submitterRows.length > 0 && submitterRows[0].created_by_agent_id === session.userId;

    if (!isOwner && !isAgent) {
      return res.status(403).json({ error: "Unauthorized to reply to this ticket" });
    }

    // Add reply
    const crypto = await import("crypto");
    const replyId = crypto.randomUUID();
    const roleForReply = isAgent ? 'agent' : 'user';

    await pool.query(
      "INSERT INTO support_replies (id, ticket_id, sender_role, sender_name, message, image) VALUES (?, ?, ?, ?, ?, ?)",
      [replyId, id, roleForReply, userRows[0].full_name, message.trim(), image || null]
    );

    // Reopen ticket status if closed so agent/admin sees new replies
    await pool.query("UPDATE contact_messages SET status = 'open' WHERE id = ?", [id]);

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to submit reply" });
  }
});

// POST toggle status of support ticket (user-accessible)
router.post("/support/:id/status", async (req, res) => {
  try {
    const token = req.cookies[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const session = verifyToken(token);
    if (!session || !session.userId) return res.status(401).json({ error: "Unauthorized" });

    const { id } = req.params;
    const { status } = req.body; // 'open' or 'closed'

    if (!status || (status !== "open" && status !== "closed")) {
      return res.status(400).json({ error: "Invalid status" });
    }

    // Get user's details
    const [userRows] = await pool.query("SELECT email, role FROM users WHERE id = ? LIMIT 1", [session.userId]);
    if (userRows.length === 0) return res.status(404).json({ error: "User not found" });
    const email = userRows[0].email;

    // Verify ownership
    const [ticketRows] = await pool.query("SELECT email FROM contact_messages WHERE id = ? LIMIT 1", [id]);
    if (ticketRows.length === 0) return res.status(404).json({ error: "Ticket not found" });

    const [submitterRows] = await pool.query("SELECT created_by_agent_id FROM users WHERE email = ? LIMIT 1", [ticketRows[0].email]);
    const isOwner = ticketRows[0].email === email;
    const isAgent = submitterRows.length > 0 && submitterRows[0].created_by_agent_id === session.userId;

    if (!isOwner && !isAgent) {
      return res.status(403).json({ error: "Unauthorized" });
    }

    await pool.query("UPDATE contact_messages SET status = ? WHERE id = ?", [status, id]);
    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update ticket status" });
  }
});

// POST submit support message
router.post("/support", async (req, res) => {
  try {
    const token = req.cookies[COOKIE_NAME];
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    const session = verifyToken(token);
    if (!session || !session.userId) return res.status(401).json({ error: "Unauthorized" });

    const { name, email, message, plan, image } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: "Name, email and message are required" });
    }

    const crypto = await import("crypto");
    const id = crypto.randomUUID();

    await pool.query(
      "INSERT INTO contact_messages (id, name, email, message, plan, image) VALUES (?, ?, ?, ?, ?, ?)",
      [id, name, email, message, plan || null, image || null]
    );

    res.json({ success: true });
  } catch (error) {
    console.error("Submit support error:", error);
    res.status(500).json({ error: "Failed to submit support message" });
  }
});

export default router;
