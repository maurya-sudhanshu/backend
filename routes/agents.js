import express from "express";
import crypto from "crypto";
import { pool } from "../config/db.js";
import { verifyToken, COOKIE_NAME, hashPassword } from "../utils/auth.js";
import { checkUserSubscription } from "../utils/subscription.js";

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

router.use(requireAuth);

router.get("/list", async (req, res) => {
  try {
    const [currentUserRows] = await pool.query("SELECT role FROM users WHERE id = ? LIMIT 1", [req.userId]);
    if (currentUserRows.length === 0 || currentUserRows[0].role !== "admin") {
      return res.status(403).json({ error: "Only admins can view agents" });
    }

    // Admin can see all branches
    const [ownerBranches] = await pool.query(
      `SELECT branches.* FROM branches`
    );

    if (ownerBranches.length === 0) {
      return res.json({ agents: [], branches: [] });
    }

    const validBranchIds = ownerBranches.map(b => b.id);
    const branchIdPlaceholders = validBranchIds.map(() => "?").join(",");

    // Get all agents assigned to these branches
    const [assignments] = await pool.query(
      `SELECT * FROM agent_branches WHERE branch_id IN (${branchIdPlaceholders})`,
      validBranchIds
    );

    const agentUserIds = [...new Set(assignments.map(a => a.user_id))];

    let agentsList = [];
    if (agentUserIds.length > 0) {
      const agentIdPlaceholders = agentUserIds.map(() => "?").join(",");
      const [assignedUsers] = await pool.query(
        `SELECT id, email, full_name, created_at FROM users WHERE id IN (${agentIdPlaceholders})`,
        agentUserIds
      );

      agentsList = assignedUsers.map(u => {
        // Find which branches they manage
        const theirAssignments = assignments.filter(a => a.user_id === u.id);
        const theirBranchIds = theirAssignments.map(a => a.branch_id);
        const theirBranches = ownerBranches.filter(b => theirBranchIds.includes(b.id));

        return {
          id: u.id,
          email: u.email,
          fullName: u.full_name, // Map to camelCase
          createdAt: u.created_at,
          branches: theirBranches.map(b => ({ id: b.id, name: b.name }))
        };
      });
    }

    // Also return branches so the UI can populate the "Add Agent" dropdown
    const availableBranches = ownerBranches.map(b => ({
      id: b.id,
      name: b.name
    }));

    return res.json({ agents: agentsList, branches: availableBranches });
  } catch (error) {
    console.error("Fetch agents error:", error);
    return res.status(500).json({ error: "Failed to fetch agents" });
  }
});

router.post("/", async (req, res) => {
  try {
    const [currentUserRows] = await pool.query("SELECT role FROM users WHERE id = ? LIMIT 1", [req.userId]);
    if (currentUserRows.length === 0 || currentUserRows[0].role !== "admin") {
      return res.status(403).json({ error: "Only admins can assign agents" });
    }

    const { email, fullName, password, branchId } = req.body;

    // Verify branch exists (could optionally join to businesses to verify ownership here)
    const [branchRows] = await pool.query("SELECT id FROM branches WHERE id = ? LIMIT 1", [branchId]);
    if (branchRows.length === 0) {
      return res.status(404).json({ error: "Branch not found" });
    }

    // Check if user exists
    let [agentUserRows] = await pool.query("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
    let agentUserId;

    if (agentUserRows.length === 0) {
      // Create new agent user
      const password_hash = await hashPassword(password || "defaultPassword123");
      agentUserId = crypto.randomUUID();
      await pool.query(
        "INSERT INTO users (id, email, full_name, password_hash, role) VALUES (?, ?, ?, ?, 'agent')",
        [agentUserId, email, fullName, password_hash]
      );
    } else {
      agentUserId = agentUserRows[0].id;
    }

    // Assign to branch
    // Optional: prevent duplicate assignment
    const [existingAssignment] = await pool.query(
      "SELECT id FROM agent_branches WHERE user_id = ? AND branch_id = ? LIMIT 1",
      [agentUserId, branchId]
    );

    if (existingAssignment.length === 0) {
      await pool.query(
        "INSERT INTO agent_branches (id, user_id, branch_id) VALUES (?, ?, ?)",
        [crypto.randomUUID(), agentUserId, branchId]
      );
    }

    return res.json({ success: true, agentId: agentUserId });
  } catch (error) {
    console.error("Agent assignment error:", error);
    return res.status(500).json({ error: "Failed to assign agent" });
  }
});

// GET /owners - Agents can fetch the owners they created
router.get("/owners", async (req, res) => {
  try {
    const [currentUserRows] = await pool.query("SELECT role FROM users WHERE id = ? LIMIT 1", [req.userId]);
    if (currentUserRows.length === 0 || currentUserRows[0].role !== "agent") {
      return res.status(403).json({ error: "Only agents can view their owners" });
    }

    const [owners] = await pool.query(
      `SELECT u.id, u.email, u.full_name, u.status, u.created_at,
              s.plan, s.created_at as subCreatedAt, s.expires_at as expiresAt
       FROM users u
       LEFT JOIN subscriptions s ON u.id = s.user_id
       WHERE u.created_by_agent_id = ? AND u.role = 'owner'`,
      [req.userId]
    );

    // Get agent's plan info
    const [sub] = await pool.query(
      "SELECT max_store_owners FROM subscriptions WHERE user_id = ? LIMIT 1",
      [req.userId]
    );
    const maxStoreOwners = sub.length > 0 ? sub[0].max_store_owners : 0;

    const mappedOwners = await Promise.all(owners.map(async o => {
      let subCheck = null;
      if (o.plan) {
        subCheck = await checkUserSubscription(o.id);
      }
      return {
        id: o.id,
        email: o.email,
        fullName: o.full_name,
        status: o.status,
        createdAt: o.created_at,
        subscription: o.plan ? {
          plan: o.plan,
          createdAt: o.subCreatedAt || o.created_at,
          expiresAt: subCheck && subCheck.expiresAt ? subCheck.expiresAt.toISOString() : null,
          isExpired: subCheck ? subCheck.isExpired : false,
        } : null,
      };
    }));

    return res.json({ owners: mappedOwners, currentCount: owners.length, maxStoreOwners });
  } catch (error) {
    console.error("Fetch owners error:", error);
    return res.status(500).json({ error: "Failed to fetch owners" });
  }
});

// POST /owners - Agents can add an owner if they have available slots
router.post("/owners", async (req, res) => {
  try {
    const [currentUserRows] = await pool.query("SELECT role FROM users WHERE id = ? LIMIT 1", [req.userId]);
    if (currentUserRows.length === 0 || currentUserRows[0].role !== "agent") {
      return res.status(403).json({ error: "Only agents can add owners" });
    }

    const { email, fullName, password } = req.body;

    // Check plan limits
    const [sub] = await pool.query(
      "SELECT max_store_owners FROM subscriptions WHERE user_id = ? LIMIT 1",
      [req.userId]
    );
    const maxStoreOwners = sub.length > 0 ? sub[0].max_store_owners : 0;

    const [existingOwners] = await pool.query(
      "SELECT COUNT(*) as count FROM users WHERE created_by_agent_id = ? AND role = 'owner'",
      [req.userId]
    );

    if (existingOwners[0].count >= maxStoreOwners) {
      return res.status(403).json({ error: "Plan limit reached. Upgrade plan to add more owners." });
    }

    // Check if user already exists
    let [existingUserRows] = await pool.query("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
    if (existingUserRows.length > 0) {
      return res.status(400).json({ error: "Email already in use." });
    }

    const password_hash = await hashPassword(password || "defaultPassword123");
    const ownerId = crypto.randomUUID();
    
    await pool.query(
      "INSERT INTO users (id, email, full_name, password_hash, role, created_by_agent_id) VALUES (?, ?, ?, ?, 'owner', ?)",
      [ownerId, email, fullName, password_hash, req.userId]
    );

    return res.json({ success: true, ownerId });
  } catch (error) {
    console.error("Add owner error:", error);
    return res.status(500).json({ error: "Failed to add owner" });
  }
});

// PUT /owners/:id/status - Agents can toggle the status of their owners (active / suspended)
router.put("/owners/:id/status", async (req, res) => {
  try {
    const [currentUserRows] = await pool.query("SELECT role FROM users WHERE id = ? LIMIT 1", [req.userId]);
    if (currentUserRows.length === 0 || currentUserRows[0].role !== "agent") {
      return res.status(403).json({ error: "Only agents can manage owner status" });
    }

    const { id } = req.params;
    const { status } = req.body;

    if (!["active", "suspended"].includes(status)) {
      return res.status(400).json({ error: "Invalid status (must be active or suspended)" });
    }

    // Verify this owner was created by the logged-in agent
    const [ownerRows] = await pool.query(
      "SELECT id FROM users WHERE id = ? AND created_by_agent_id = ? AND role = 'owner' LIMIT 1",
      [id, req.userId]
    );

    if (ownerRows.length === 0) {
      return res.status(404).json({ error: "Owner not found or not managed by you" });
    }

    await pool.query("UPDATE users SET status = ? WHERE id = ?", [status, id]);
    return res.json({ success: true });
  } catch (error) {
    console.error("Update owner status error:", error);
    return res.status(500).json({ error: "Failed to update owner status" });
  }
});

// PUT /owners/:id - Agents can update the details of their owners
router.put("/owners/:id", async (req, res) => {
  try {
    const [currentUserRows] = await pool.query("SELECT role FROM users WHERE id = ? LIMIT 1", [req.userId]);
    if (currentUserRows.length === 0 || currentUserRows[0].role !== "agent") {
      return res.status(403).json({ error: "Only agents can update owner details" });
    }

    const { id } = req.params;
    const { fullName, email, password } = req.body;

    if (!fullName || !email) {
      return res.status(400).json({ error: "Full Name and Email are required" });
    }

    // Verify this owner was created by the logged-in agent
    const [ownerRows] = await pool.query(
      "SELECT id FROM users WHERE id = ? AND created_by_agent_id = ? AND role = 'owner' LIMIT 1",
      [id, req.userId]
    );

    if (ownerRows.length === 0) {
      return res.status(404).json({ error: "Owner not found or not managed by you" });
    }

    // Check if email is already in use by another user
    const [existingEmail] = await pool.query(
      "SELECT id FROM users WHERE email = ? AND id != ? LIMIT 1",
      [email, id]
    );
    if (existingEmail.length > 0) {
      return res.status(400).json({ error: "Email already in use." });
    }

    if (password) {
      const password_hash = await hashPassword(password);
      await pool.query(
        "UPDATE users SET full_name = ?, email = ?, password_hash = ? WHERE id = ?",
        [fullName, email, password_hash, id]
      );
    } else {
      await pool.query(
        "UPDATE users SET full_name = ?, email = ? WHERE id = ?",
        [fullName, email, id]
      );
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("Update owner error:", error);
    return res.status(500).json({ error: "Failed to update owner" });
  }
});

export default router;
