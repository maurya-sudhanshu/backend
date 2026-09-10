import express from "express";
import crypto from "crypto";
import { z } from "zod";
import { pool } from "../config/db.js";
import { verifyToken, COOKIE_NAME } from "../utils/auth.js";
import { checkBranchSubscriptionBySlug } from "../utils/subscription.js";

const router = express.Router();

const getReviewsSchema = z.object({
  branchId: z.string().uuid().optional(),
  businessId: z.string().uuid().optional(),
  status: z.enum(["public", "private", "pending", "ignored"]).optional(),
});

const submitReviewSchema = z.object({
  slug: z.string().min(1),
  customerName: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  customerEmail: z.preprocess((v) => (v === "" ? undefined : v), z.string().email().optional()),
  rating: z.number().min(1).max(5),
  content: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  keyword: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
  reviewId: z.preprocess((v) => (v === "" ? undefined : v), z.string().optional()),
});

// POST mark-copied - Mark a review as copied by user
router.post("/mark-copied", async (req, res) => {
  try {
    const { reviewId, content, slug } = req.body;
    if (reviewId) {
      await pool.query("UPDATE reviews SET status = 'copied' WHERE id = ?", [reviewId]);
      return res.json({ success: true });
    } else if (content && slug) {
      const subCheck = await checkBranchSubscriptionBySlug(slug);
      if (subCheck.found && subCheck.branch) {
        await pool.query(
          "UPDATE reviews SET status = 'copied' WHERE branch_id = ? AND content = ? ORDER BY created_at DESC LIMIT 1",
          [subCheck.branch.id, content]
        );
      }
      return res.json({ success: true });
    }
    return res.status(400).json({ error: "Missing reviewId or content" });
  } catch (e) {
    console.error("Mark copied error:", e);
    return res.status(500).json({ error: "Failed to mark copied" });
  }
});

// POST submit review from public review page
router.post("/submit", async (req, res) => {
  try {
    const data = submitReviewSchema.parse(req.body);

    // Find branch by slug & verify subscription/trial status
    const subCheck = await checkBranchSubscriptionBySlug(data.slug);
    if (!subCheck.found) {
      return res.status(404).json({ error: subCheck.error || "Branch not found" });
    }
    if (subCheck.isExpired) {
      return res.status(403).json({
        expired: true,
        error: subCheck.errorMessage || "This QR code has expired. Please contact the business for a new review link.",
      });
    }

    const branch = subCheck.branch;

    // Determine if review is public or private based on rating
    const status = data.rating >= branch.low_rating_threshold ? "public" : "private";

    let reviewId = data.reviewId || crypto.randomUUID();

    // Check if review already exists in DB from generation
    const [existingRows] = await pool.query("SELECT id FROM reviews WHERE id = ? OR (branch_id = ? AND content = ?) LIMIT 1", [reviewId, branch.id, data.content || ""]);

    if (existingRows.length > 0) {
      reviewId = existingRows[0].id;
      await pool.query(
        "UPDATE reviews SET customer_name = ?, customer_email = ?, status = ?, keyword = COALESCE(keyword, ?) WHERE id = ?",
        [data.customerName || null, data.customerEmail || null, status, data.keyword || null, reviewId]
      );
    } else {
      await pool.query(
        "INSERT INTO reviews (id, branch_id, customer_name, customer_email, rating, content, keyword, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [reviewId, branch.id, data.customerName || null, data.customerEmail || null, data.rating, data.content || null, data.keyword || null, status]
      );
    }

    const review = {
      id: reviewId,
      branchId: branch.id,
      customerName: data.customerName,
      customerEmail: data.customerEmail,
      rating: data.rating,
      content: data.content,
      keyword: data.keyword,
      status,
      createdAt: new Date(),
    };

    return res.json({
      review,
      redirect: status === "public" ? "google" : "private",
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0].message });
    }
    console.error("Submit review error:", error);
    return res.status(500).json({ error: "Failed to submit review" });
  }
});

export default router;
