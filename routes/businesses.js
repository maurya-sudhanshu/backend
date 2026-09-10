import express from "express";
import crypto from "crypto";
import { z } from "zod";
import { pool } from "../config/db.js";
import { verifyToken, COOKIE_NAME } from "../utils/auth.js";

const router = express.Router();

const createBusinessSchema = z.object({
  name: z.string().min(2),
  industry: z.string().optional().nullable(),
  subIndustry: z.string().optional().nullable(),
  googlePlaceId: z.string().optional().nullable(),
  googleReviewUrl: z.string().url().or(z.literal("")).optional().nullable(),
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

// GET all businesses for current user (or if agent, businesses belonging to owners created by this agent)
router.get("/", async (req, res) => {
  try {
    const [userRows] = await pool.query("SELECT role FROM users WHERE id = ? LIMIT 1", [req.userId]);
    if (userRows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const role = userRows[0].role;

    let userBusinesses = [];
    if (role === "agent") {
      [userBusinesses] = await pool.query(
        `SELECT b.* FROM businesses b 
         INNER JOIN users u ON b.user_id = u.id 
         WHERE u.created_by_agent_id = ?`,
        [req.userId]
      );
    } else {
      [userBusinesses] = await pool.query("SELECT * FROM businesses WHERE user_id = ?", [req.userId]);
    }

    let businessesWithBranches = [];
    if (userBusinesses.length > 0) {
      const businessIds = userBusinesses.map(b => b.id);
      
      const placeholders = businessIds.map(() => "?").join(",");
      const [allBranches] = await pool.query(`SELECT * FROM branches WHERE business_id IN (${placeholders})`, businessIds);

      businessesWithBranches = userBusinesses.map(business => {
        let ind = business.industry || "";
        let subInd = "";
        if (ind && ind.includes(" • ")) {
          const parts = ind.split(" • ");
          ind = parts[0];
          subInd = parts.slice(1).join(" • ");
        }
        return {
          id: business.id,
          userId: business.user_id,
          name: business.name,
          industry: ind,
          subIndustry: subInd,
          googlePlaceId: business.google_place_id,
          googleReviewUrl: business.google_review_url,
          createdAt: business.created_at,
          branches: allBranches
            .filter(b => b.business_id === business.id)
            .map(b => ({
              id: b.id,
              businessId: b.business_id,
              name: b.name,
              address: b.address,
              qrCode: b.qr_code,
              publicSlug: b.public_slug,
              lowRatingThreshold: b.low_rating_threshold,
              createdAt: b.created_at
            }))
        };
      });
    }

    res.json({ businesses: businessesWithBranches });
  } catch (error) {
    console.error("Get businesses error:", error);
    res.status(500).json({ error: "Failed to fetch businesses" });
  }
});

// POST create new business
router.post("/", async (req, res) => {
  try {
    // Check user role: Admin cannot create a business
    const [userRows] = await pool.query("SELECT role FROM users WHERE id = ? LIMIT 1", [req.userId]);
    if (userRows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    if (userRows[0].role === "admin") {
      return res.status(403).json({ error: "Admins are not allowed to create businesses" });
    }

    let targetUserId = req.userId;
    if (userRows[0].role === "agent") {
      const { ownerId } = req.body;
      if (!ownerId) {
        return res.status(400).json({ error: "ownerId is required for agents to create a business" });
      }
      
      const [ownerRows] = await pool.query(
        "SELECT id FROM users WHERE id = ? AND created_by_agent_id = ? AND role = 'owner' LIMIT 1",
        [ownerId, req.userId]
      );
      if (ownerRows.length === 0) {
        return res.status(403).json({ error: "Owner not found or not managed by you" });
      }
      targetUserId = ownerId;
    }

    const data = createBusinessSchema.parse(req.body);
    const businessId = crypto.randomUUID();

    const formattedIndustry = data.industry
      ? (data.subIndustry ? `${data.industry} • ${data.subIndustry}` : data.industry)
      : null;

    await pool.query(
      "INSERT INTO businesses (id, user_id, name, industry, google_place_id, google_review_url) VALUES (?, ?, ?, ?, ?, ?)",
      [businessId, targetUserId, data.name, formattedIndustry, data.googlePlaceId || null, data.googleReviewUrl || null]
    );

    const business = {
      id: businessId,
      userId: targetUserId,
      name: data.name,
      industry: data.industry,
      subIndustry: data.subIndustry,
      googlePlaceId: data.googlePlaceId,
      googleReviewUrl: data.googleReviewUrl,
      createdAt: new Date(),
    };

    res.status(201).json({ business });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0].message });
    }
    console.error("Create business error:", error);
    res.status(500).json({ error: "Failed to create business" });
  }
});

// PUT update business
router.put("/:id", async (req, res) => {
  try {
    const businessId = req.params.id;
    const [userRows] = await pool.query("SELECT role FROM users WHERE id = ? LIMIT 1", [req.userId]);
    if (userRows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const role = userRows[0].role;

    if (role === "admin") {
      return res.status(403).json({ error: "Admins are not allowed to update businesses" });
    }

    const [businessRows] = await pool.query("SELECT * FROM businesses WHERE id = ? LIMIT 1", [businessId]);
    if (businessRows.length === 0) {
      return res.status(404).json({ error: "Business not found" });
    }

    const business = businessRows[0];

    if (role === "agent") {
      const [ownerRows] = await pool.query(
        "SELECT id FROM users WHERE id = ? AND created_by_agent_id = ? LIMIT 1",
        [business.user_id, req.userId]
      );
      if (ownerRows.length === 0) {
        return res.status(403).json({ error: "Unauthorized to update this business" });
      }
    } else if (role === "owner") {
      if (business.user_id !== req.userId) {
        return res.status(403).json({ error: "Unauthorized to update this business" });
      }
    } else {
      return res.status(403).json({ error: "Unauthorized" });
    }

    const updateSchema = z.object({
      name: z.string().min(2),
      industry: z.string().optional().nullable(),
      subIndustry: z.string().optional().nullable(),
      googlePlaceId: z.string().optional().nullable(),
      googleReviewUrl: z.string().url().or(z.literal("")).optional().nullable(),
    });

    const data = updateSchema.parse(req.body);
    const googleReviewUrl = data.googleReviewUrl === "" ? null : (data.googleReviewUrl || null);

    const formattedIndustry = data.industry
      ? (data.subIndustry ? `${data.industry} • ${data.subIndustry}` : data.industry)
      : null;

    await pool.query(
      "UPDATE businesses SET name = ?, industry = ?, google_place_id = ?, google_review_url = ? WHERE id = ?",
      [data.name, formattedIndustry, data.googlePlaceId || null, googleReviewUrl, businessId]
    );

    res.json({
      business: {
        id: businessId,
        userId: business.user_id,
        name: data.name,
        industry: data.industry,
        subIndustry: data.subIndustry,
        googlePlaceId: data.googlePlaceId,
        googleReviewUrl: googleReviewUrl,
      }
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0].message });
    }
    console.error("Update business error:", error);
    res.status(500).json({ error: "Failed to update business" });
  }
});

// DELETE business
router.delete("/:id", async (req, res) => {
  try {
    const businessId = req.params.id;
    const [userRows] = await pool.query("SELECT role FROM users WHERE id = ? LIMIT 1", [req.userId]);
    if (userRows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const role = userRows[0].role;

    if (role === "admin") {
      return res.status(403).json({ error: "Admins are not allowed to delete businesses" });
    }

    const [businessRows] = await pool.query("SELECT * FROM businesses WHERE id = ? LIMIT 1", [businessId]);
    if (businessRows.length === 0) {
      return res.status(404).json({ error: "Business not found" });
    }

    const business = businessRows[0];

    if (role === "agent") {
      const [ownerRows] = await pool.query(
        "SELECT id FROM users WHERE id = ? AND created_by_agent_id = ? LIMIT 1",
        [business.user_id, req.userId]
      );
      if (ownerRows.length === 0) {
        return res.status(403).json({ error: "Unauthorized to delete this business" });
      }
    } else if (role === "owner") {
      if (business.user_id !== req.userId) {
        return res.status(403).json({ error: "Unauthorized to delete this business" });
      }
    } else {
      return res.status(403).json({ error: "Unauthorized" });
    }

    await pool.query("DELETE FROM businesses WHERE id = ?", [businessId]);

    res.json({ message: "Business deleted successfully" });
  } catch (error) {
    console.error("Delete business error:", error);
    res.status(500).json({ error: "Failed to delete business" });
  }
});

export default router;
