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

router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const businessId = req.query.businessId;
    const days = Number(req.query.days || 30);

    // Get user's businesses (or if agent, businesses of owners created by this agent)
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
      [userBusinesses] = await pool.query(
        "SELECT * FROM businesses WHERE user_id = ?",
        [req.userId]
      );
    }

    if (userBusinesses.length === 0) {
      return res.json({
        totalReviews: 0,
        publicReviews: 0,
        privateReviews: 0,
        averageRating: 0,
        ratingDistribution: { "5": 0, "4": 0, "3": 0, "2": 0, "1": 0 },
        recentReviews: [],
        businesses: 0,
        branches: 0,
      });
    }

    // Filter by businessId if provided
    let targetBusinesses = userBusinesses;
    if (businessId) {
      targetBusinesses = userBusinesses.filter((b) => b.id === businessId);
    }

    const businessIds = targetBusinesses.map((b) => b.id);
    if (businessIds.length === 0) {
      return res.json({
        totalReviews: 0,
        publicReviews: 0,
        privateReviews: 0,
        averageRating: 0,
        ratingDistribution: { "5": 0, "4": 0, "3": 0, "2": 0, "1": 0 },
        recentReviews: [],
        businesses: 0,
        branches: 0,
      });
    }

    // Get branches for these businesses
    const businessIdPlaceholders = businessIds.map(() => "?").join(",");
    const [branches] = await pool.query(
      `SELECT id FROM branches WHERE business_id IN (${businessIdPlaceholders})`,
      businessIds
    );

    const branchIds = branches.map((b) => b.id);

    let recentReviews = [];
    if (branchIds.length > 0) {
      const branchIdPlaceholders = branchIds.map(() => "?").join(",");
      const sinceDate = new Date();
      sinceDate.setDate(sinceDate.getDate() - days);
      
      const [reviewsData] = await pool.query(
        `SELECT * FROM reviews WHERE branch_id IN (${branchIdPlaceholders}) AND created_at >= ? ORDER BY created_at DESC`,
        [...branchIds, sinceDate]
      );
      // Map to camelCase
      recentReviews = reviewsData.map(r => ({
        id: r.id,
        branchId: r.branch_id,
        customerName: r.customer_name,
        customerEmail: r.customer_email,
        rating: r.rating,
        content: r.content,
        aiGenerated: r.ai_generated,
        status: r.status,
        googleReviewLink: r.google_review_link,
        createdAt: r.created_at
      }));
    }

    const publicReviews = recentReviews.filter((r) => r.status === "public").length;
    const privateReviews = recentReviews.filter((r) => r.status === "private").length;

    const avgRating =
      recentReviews.length > 0
        ? recentReviews.reduce((sum, r) => sum + r.rating, 0) /
          recentReviews.length
        : 0;

    const ratingDistribution = {
      "5": recentReviews.filter((r) => r.rating === 5).length,
      "4": recentReviews.filter((r) => r.rating === 4).length,
      "3": recentReviews.filter((r) => r.rating === 3).length,
      "2": recentReviews.filter((r) => r.rating === 2).length,
      "1": recentReviews.filter((r) => r.rating === 1).length,
    };

    res.json({
      totalReviews: recentReviews.length,
      publicReviews,
      privateReviews,
      averageRating: Math.round(avgRating * 10) / 10,
      ratingDistribution,
      recentReviews: recentReviews.slice(0, 20),
      businesses: targetBusinesses.length,
      branches: branchIds.length,
    });
  } catch (error) {
    console.error("Analytics error:", error);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

export default router;
