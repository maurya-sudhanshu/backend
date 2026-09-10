import express from "express";
import { pool } from "../config/db.js";
import { checkBranchSubscriptionBySlug } from "../utils/subscription.js";

const router = express.Router();

// GET public branch info for review page
router.get("/:slug", async (req, res) => {
  try {
    const slug = req.params.slug;

    const subCheck = await checkBranchSubscriptionBySlug(slug);

    if (!subCheck.found) {
      return res.status(404).json({ error: subCheck.error || "Branch not found" });
    }

    if (subCheck.isExpired) {
      return res.status(403).json({
        expired: true,
        error: subCheck.errorMessage || "This QR code has expired. Please contact the business for a new review link.",
      });
    }

    const { branch, business } = subCheck;

    res.json({
      expired: false,
      branch: {
        name: branch.name,
        businessName: business.name,
        industry: business.industry,
        lowRatingThreshold: branch.low_rating_threshold,
        googleReviewUrl: business.google_review_url,
        keywords: branch.keywords,
      },
    });
  } catch (error) {
    console.error("Public branch error:", error);
    res.status(500).json({ error: "Failed to fetch branch" });
  }
});

export default router;
