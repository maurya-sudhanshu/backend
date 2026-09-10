import express from "express";
import crypto from "crypto";
import QRCode from "qrcode";
import { z } from "zod";
import { pool } from "../config/db.js";
import { verifyToken, COOKIE_NAME } from "../utils/auth.js";
import { env } from "../config/env.js";

const router = express.Router();

const createBranchSchema = z.object({
  businessId: z.string().uuid(),
  name: z.string().min(2),
  address: z.string().optional(),
  lowRatingThreshold: z.number().min(1).max(5).optional(),
  keywords: z.string().optional(),
});

const updateBranchSchema = z.object({
  name: z.string().min(2),
  address: z.string().optional(),
  lowRatingThreshold: z.number().min(1).max(5).optional(),
  keywords: z.string().optional(),
});

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

// GET all branches for a business
router.get("/", async (req, res) => {
  try {
    const businessId = req.query.businessId;

    if (!businessId) {
      return res.status(400).json({ error: "businessId required" });
    }

    // Verify business belongs to user (or if agent, belongs to an owner created by this agent)
    const [businessRows] = await pool.query(
      `SELECT b.id FROM businesses b 
       INNER JOIN users u ON b.user_id = u.id 
       WHERE b.id = ? AND (b.user_id = ? OR u.created_by_agent_id = ?) LIMIT 1`,
      [businessId, req.userId, req.userId]
    );

    if (businessRows.length === 0) {
      return res.status(404).json({ error: "Business not found" });
    }

    const [businessBranches] = await pool.query(
      "SELECT * FROM branches WHERE business_id = ?",
      [businessId]
    );

    let branchesWithReviews = [];
    if (businessBranches.length > 0) {
      // Return branches mapped to camelCase
      branchesWithReviews = businessBranches.map(b => ({
        id: b.id,
        businessId: b.business_id,
        name: b.name,
        address: b.address,
        qrCode: b.qr_code,
        publicSlug: b.public_slug,
        lowRatingThreshold: b.low_rating_threshold,
        keywords: b.keywords,
        createdAt: b.created_at,
        reviews: [] // Reviews will be implemented later
      }));
    }

    res.json({ branches: branchesWithReviews });
  } catch (error) {
    console.error("Get branches error:", error);
    res.status(500).json({ error: "Failed to fetch branches" });
  }
});

router.post("/", async (req, res) => {
  try {
    // Check user role: Admin cannot create a branch or QR code
    const [userRows] = await pool.query("SELECT role FROM users WHERE id = ? LIMIT 1", [req.userId]);
    if (userRows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    if (userRows[0].role === "admin") {
      return res.status(403).json({ error: "Admins are not allowed to create branches or QR codes" });
    }

    const data = createBranchSchema.parse(req.body);

    // Verify business belongs to user (or if agent, belongs to an owner created by this agent)
    const [businessRows] = await pool.query(
       `SELECT b.id FROM businesses b 
        INNER JOIN users u ON b.user_id = u.id 
        WHERE b.id = ? AND (b.user_id = ? OR u.created_by_agent_id = ?) LIMIT 1`,
      [data.businessId, req.userId, req.userId]
    );

    if (businessRows.length === 0) {
      return res.status(404).json({ error: "Business not found" });
    }

    // Check branch limits
    const [subRows] = await pool.query(
      "SELECT max_branches FROM subscriptions WHERE user_id = ? LIMIT 1",
      [req.userId]
    );

    const [branchRows] = await pool.query(
      "SELECT id FROM branches WHERE business_id = ?",
      [data.businessId]
    );

    if (subRows.length > 0 && branchRows.length >= subRows[0].max_branches) {
      return res.status(400).json({ error: "Branch limit reached for your plan" });
    }

    // Generate unique slug
    const publicSlug = crypto.randomBytes(5).toString('hex');

    // Create branch
    const branchId = crypto.randomUUID();
    
    await pool.query(
      "INSERT INTO branches (id, business_id, name, address, public_slug, low_rating_threshold, keywords) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [branchId, data.businessId, data.name, data.address || null, publicSlug, data.lowRatingThreshold || 3, data.keywords || null]
    );

    // Generate QR code
    const siteUrl = env.FRONTEND_URL;
    const reviewUrl = `${siteUrl}/review/${publicSlug}`;
    const qrDataUrl = await QRCode.toDataURL(reviewUrl, {
      width: 400,
      margin: 2,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    });

    // Update branch with QR code
    await pool.query(
      "UPDATE branches SET qr_code = ? WHERE id = ?",
      [qrDataUrl, branchId]
    );

    const [updatedBranchRows] = await pool.query(
      "SELECT * FROM branches WHERE id = ? LIMIT 1",
      [branchId]
    );
    const updatedBranch = updatedBranchRows[0];

    res.status(201).json({ 
      branch: {
        id: updatedBranch.id,
        businessId: updatedBranch.business_id,
        name: updatedBranch.name,
        address: updatedBranch.address,
        qrCode: updatedBranch.qr_code,
        publicSlug: updatedBranch.public_slug,
        lowRatingThreshold: updatedBranch.low_rating_threshold,
        keywords: updatedBranch.keywords,
        createdAt: updatedBranch.created_at,
      } 
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0].message });
    }
    console.error("Create branch error:", error);
    res.status(500).json({ error: "Failed to create branch" });
  }
});

// PUT update branch details
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const data = updateBranchSchema.parse(req.body);

    // Verify user role
    const [userRows] = await pool.query("SELECT role FROM users WHERE id = ? LIMIT 1", [req.userId]);
    if (userRows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    if (userRows[0].role === "admin") {
      return res.status(403).json({ error: "Admins are not allowed to update branches" });
    }

    // Verify branch exists and business belongs to user (or if agent, owner created by this agent)
    const [branchRows] = await pool.query("SELECT * FROM branches WHERE id = ? LIMIT 1", [id]);
    if (branchRows.length === 0) {
      return res.status(404).json({ error: "Branch not found" });
    }
    const branch = branchRows[0];

    const [businessRows] = await pool.query(
       `SELECT b.id FROM businesses b 
        INNER JOIN users u ON b.user_id = u.id 
        WHERE b.id = ? AND (b.user_id = ? OR u.created_by_agent_id = ?) LIMIT 1`,
      [branch.business_id, req.userId, req.userId]
    );

    if (businessRows.length === 0) {
      return res.status(404).json({ error: "Unauthorized or business not found" });
    }

    // Update branch
    await pool.query(
      "UPDATE branches SET name = ?, address = ?, low_rating_threshold = ?, keywords = ? WHERE id = ?",
      [data.name, data.address || null, data.lowRatingThreshold || 3, data.keywords || null, id]
    );

    res.json({ success: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0].message });
    }
    console.error("Update branch error:", error);
    res.status(500).json({ error: "Failed to update branch" });
  }
});

export default router;
