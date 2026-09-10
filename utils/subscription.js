import { pool } from "../config/db.js";

/**
 * Checks whether a user's subscription or trial is active or expired.
 * Evaluates state flow: NOT_STARTED -> ACTIVE -> EXPIRED
 * @param {string} userId - The business owner's user ID
 * @returns {Promise<{ isExpired: boolean, trialStatus: 'NOT_STARTED'|'ACTIVE'|'EXPIRED', plan: string, expiresAt: Date|null, remainingDays?: number|null, remainingHours?: number|null, canSubmitReviews: boolean, reason?: string }>}
 */
export async function checkUserSubscription(userId) {
  const [subRows] = await pool.query(
    "SELECT plan, expires_at, created_at, trial_status, trial_started_at FROM subscriptions WHERE user_id = ? LIMIT 1",
    [userId]
  );

  if (subRows.length === 0) {
    // If no subscription record exists, default to NOT_STARTED
    return {
      isExpired: false,
      trialStatus: "NOT_STARTED",
      plan: "free",
      expiresAt: null,
      canSubmitReviews: false,
    };
  }

  const sub = subRows[0];
  const now = new Date();
  const plan = (sub.plan || "free").toLowerCase();
  let trialStatus = sub.trial_status || "NOT_STARTED";

  // Paid plans (silver, gold, platinum, agent_pro, agent_enterprise)
  const isPaidPlan = ["silver", "gold", "platinum", "agent_pro", "agent_enterprise"].includes(plan);

  if (isPaidPlan) {
    if (sub.expires_at) {
      const expiresAt = new Date(sub.expires_at);
      if (expiresAt.getTime() <= now.getTime()) {
        return {
          isExpired: true,
          trialStatus: "EXPIRED",
          plan,
          expiresAt,
          canSubmitReviews: false,
          reason: "Paid subscription period has expired",
        };
      }
    }
    return {
      isExpired: false,
      trialStatus: "ACTIVE",
      plan,
      expiresAt: sub.expires_at ? new Date(sub.expires_at) : null,
      canSubmitReviews: true,
    };
  }

  // Explicitly marked EXPIRED state or plan === 'expired'
  if (trialStatus === "EXPIRED" || plan === "expired") {
    return {
      isExpired: true,
      trialStatus: "EXPIRED",
      plan: "expired",
      expiresAt: sub.expires_at ? new Date(sub.expires_at) : null,
      canSubmitReviews: false,
      reason: "Free trial has expired",
    };
  }

  // NOT_STARTED state (trial inactive, review QR disabled until activation)
  if (trialStatus === "NOT_STARTED") {
    return {
      isExpired: false,
      trialStatus: "NOT_STARTED",
      plan: "free",
      expiresAt: null,
      canSubmitReviews: false,
    };
  }

  // ACTIVE state (trial running)
  if (trialStatus === "ACTIVE") {
    let expiresAt = sub.expires_at ? new Date(sub.expires_at) : null;
    if (!expiresAt && sub.trial_started_at) {
      const startedAt = new Date(sub.trial_started_at);
      expiresAt = new Date(startedAt.getTime() + 14 * 24 * 60 * 60 * 1000);
    }

    if (expiresAt && expiresAt.getTime() <= now.getTime()) {
      // Transition permanently to EXPIRED in database (ACTIVE -> EXPIRED)
      await pool.query(
        "UPDATE subscriptions SET trial_status = 'EXPIRED', plan = 'expired' WHERE user_id = ?",
        [userId]
      );
      return {
        isExpired: true,
        trialStatus: "EXPIRED",
        plan: "expired",
        expiresAt,
        canSubmitReviews: false,
        reason: "14-day free trial has expired",
      };
    }

    // Remaining time calculation
    const remainingMs = expiresAt ? Math.max(0, expiresAt.getTime() - now.getTime()) : 0;
    const remainingDays = Math.floor(remainingMs / (1000 * 60 * 60 * 24));
    const remainingHours = Math.floor((remainingMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    return {
      isExpired: false,
      trialStatus: "ACTIVE",
      plan: "free",
      expiresAt,
      remainingDays,
      remainingHours,
      canSubmitReviews: true,
    };
  }

  return {
    isExpired: true,
    trialStatus: "EXPIRED",
    plan: "expired",
    expiresAt: null,
    canSubmitReviews: false,
  };
}

/**
 * Checks trial/subscription status for a public branch slug.
 * @param {string} slug - Public branch slug
 * @returns {Promise<{ found: boolean, isExpired: boolean, trialStatus: string, branch?: object, business?: object, ownerUserId?: string, errorMessage?: string, error?: string }>}
 */
export async function checkBranchSubscriptionBySlug(slug) {
  const [branchRows] = await pool.query(
    "SELECT id, business_id, name, low_rating_threshold, keywords FROM branches WHERE public_slug = ? LIMIT 1",
    [slug]
  );

  if (branchRows.length === 0) {
    return { found: false, isExpired: false, trialStatus: "EXPIRED", error: "Branch not found" };
  }

  const branch = branchRows[0];

  const [businessRows] = await pool.query(
    "SELECT id, user_id, name, industry, google_review_url FROM businesses WHERE id = ? LIMIT 1",
    [branch.business_id]
  );

  if (businessRows.length === 0) {
    return { found: false, isExpired: false, trialStatus: "EXPIRED", error: "Business not found for branch" };
  }

  const business = businessRows[0];
  const subCheck = await checkUserSubscription(business.user_id);

  if (!subCheck.canSubmitReviews) {
    let errorMessage = "This QR code has expired. Please contact the business for a new review link.";
    if (subCheck.trialStatus === "NOT_STARTED") {
      errorMessage = "This business review QR code has not been activated yet. Please contact the business.";
    }

    return {
      found: true,
      isExpired: true,
      trialStatus: subCheck.trialStatus,
      branch,
      business,
      ownerUserId: business.user_id,
      errorMessage,
    };
  }

  return {
    found: true,
    isExpired: false,
    trialStatus: subCheck.trialStatus,
    branch,
    business,
    ownerUserId: business.user_id,
  };
}
