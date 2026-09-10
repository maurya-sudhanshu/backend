import express from "express";
import { z } from "zod";
import { pool } from "../config/db.js";
import { checkBranchSubscriptionBySlug } from "../utils/subscription.js";

const router = express.Router();

const generateReviewSchema = z.object({
  slug: z.string().min(1),
  businessName: z.string().min(1),
  rating: z.number().min(1).max(5),
  industry: z.string().optional(),
  keywords: z.string().optional(),
  tone: z.enum(["professional", "casual", "enthusiastic"]).default("professional"),
  keywordOffset: z.number().optional().default(0),
});

// Human-like template fallback generator when AI API is unavailable
function generateReviewFromTemplate(businessName, rating, tone, keywords, variationIndex = 0) {
  const keywordList = keywords
    ? keywords.split(",").map((k) => k.trim()).filter(Boolean)
    : [];

  const mainKeyword = keywordList.length > 0 ? keywordList[0] : "";

  const templates = [
    // Variation 0: Friendly service focus
    () => {
      const kw = mainKeyword ? `The ${mainKeyword} was top notch.` : "The overall experience was great.";
      return `Really pleased with my visit to ${businessName}. The staff was welcoming, attentive, and handled everything efficiently. ${kw} I will definitely return.`;
    },
    // Variation 1: Product & quality focus
    () => {
      const kw = mainKeyword ? `Special mention to their ${mainKeyword}, which was fantastic.` : "Everything was handled with great care and professionalism.";
      return `Had a wonderful experience at ${businessName}. ${kw} Quality service and a clean, comfortable atmosphere. Highly recommend checking them out.`;
    },
    // Variation 2: General recommendation & value focus
    () => {
      const kw = mainKeyword ? `Appreciated the attention to detail with ${mainKeyword}.` : "Appreciated their attention to detail and clear communication.";
      return `Glad I decided to try ${businessName}. ${kw} Fair pricing, friendly team, and great overall service. Will definitely be a returning customer.`;
    },
  ];

  const templateFn = templates[variationIndex % templates.length];
  return templateFn();
}

// Fetch helper with retry logic for 429 Too Many Requests
async function fetchWithRetry(url, options, maxRetries = 3, initialDelay = 1000) {
  let delay = initialDelay;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        let isQuotaExceeded = false;
        let errMsg = "";
        try {
          const clone = res.clone();
          const data = await clone.json();
          errMsg = data.error?.message || "";
          if (data.error?.status === "RESOURCE_EXHAUSTED" || errMsg.toLowerCase().includes("quota")) {
            isQuotaExceeded = true;
          }
        } catch (_) {}

        if (isQuotaExceeded) {
          console.error(`Quota exhausted on ${url}. Skipping retries. Error: ${errMsg}`);
          return res;
        }

        console.warn(`Rate limited (429) on ${url}. Attempt ${i + 1} of ${maxRetries}. Retrying in ${delay}ms...`);
        if (i < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2; // Exponential backoff
          continue;
        }
      }
      return res;
    } catch (err) {
      if (i === maxRetries - 1) throw err;
      console.warn(`Fetch error on ${url}. Attempt ${i + 1} of ${maxRetries}. Retrying in ${delay}ms...`, err);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
}

async function generateReviewFromAI(activeModel, businessName, rating, tone, keywords, variationIndex = 0, pastReviews = [], industry = "") {
  const keywordList = keywords
    ? keywords.split(",").map((k) => k.trim()).filter(Boolean)
    : [];

  const variationAngles = [
    "Focus on personal interaction, friendly staff, and a welcoming atmosphere. Tone: Conversational, genuine.",
    "Focus on service quality, efficiency, and attention to detail. Tone: Direct, positive, polite.",
    "Focus on overall satisfaction, great value, and recommending them to others. Tone: Warm, enthusiastic yet grounded.",
  ];

  const chosenAngle = variationAngles[variationIndex % variationAngles.length];

  const prompt = `You are a real customer writing an authentic online review for "${businessName}"${industry ? ` (${industry})` : ''}.
Star Rating: ${rating}/5 stars.

STRICT WRITING RULES:
1. NATURAL HUMAN STYLE: Write in a realistic, clean customer voice. Avoid robotic AI clichés such as "exceeded my expectations", "simply the best", "top-tier service", or overusing exclamation marks.
2. LENGTH: Short to medium paragraph (2 to 4 natural sentences, approximately 25-50 words total).
3. NO FAKE ERRORS: Maintain clean, correct spelling and grammar. Do not insert artificial typos or unnatural errors.
4. VARIATION & TONE: ${chosenAngle} Use varied sentence structures and phrasing so this review feels completely distinct from other reviews.
5. RELEVANCE & CONTEXT: ${keywordList.length > 0 ? `Naturally incorporate these key aspects: ${keywordList.join(', ')}.` : 'Keep the content relevant to what real customers care about for this type of business.'}
6. REALISM: Sound like a customer leaving a real review on Google. Refer naturally to "this place" or "the team" rather than repeatedly over-using the business name.

${pastReviews.length > 0 ? `CRITICAL CONSTRAINT: Do NOT copy, repeat, or use similar phrasing to any of these past reviews:\n${pastReviews.map((r) => `- "${r}"`).join('\n')}` : ''}

Output ONLY the raw review text without any quotes, headers, rating numbers, or extra commentary.`;

  try {
    if (activeModel.provider.toLowerCase() === "openai" || activeModel.provider.toLowerCase() === "zlm") {
      const baseUrl = activeModel.provider.toLowerCase() === "zlm" ? "https://api.zlm.example/v1" : "https://api.openai.com/v1";
      const res = await fetchWithRetry(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${activeModel.apiKey}`,
        },
        body: JSON.stringify({
          model: activeModel.modelName || "gpt-3.5-turbo",
          messages: [{ role: "user", content: prompt }],
          max_tokens: 120,
          temperature: 0.9,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        await pool.query("UPDATE ai_models SET status_error = NULL WHERE id = ?", [activeModel.id]).catch(console.error);
        return data.choices?.[0]?.message?.content?.trim();
      } else {
        const errText = await res.text().catch(() => "");
        let apiErrorMsg = `AI API response error (status ${res.status}): ${errText}`;
        try {
          const parsed = JSON.parse(errText);
          apiErrorMsg = parsed.error?.message || apiErrorMsg;
        } catch (_) {}
        console.error(`AI API response error (status ${res.status}): ${errText}`);
        await pool.query("UPDATE ai_models SET status_error = ? WHERE id = ?", [apiErrorMsg, activeModel.id]).catch(console.error);
      }
    } else if (activeModel.provider.toLowerCase() === "gemini") {
      const res = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${activeModel.modelName || "gemini-1.5-flash"}:generateContent?key=${activeModel.apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.9,
          }
        }),
      });
      if (res.ok) {
        const data = await res.json();
        await pool.query("UPDATE ai_models SET status_error = NULL WHERE id = ?", [activeModel.id]).catch(console.error);
        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
      } else {
        const errText = await res.text().catch(() => "");
        let apiErrorMsg = `Gemini API response error (status ${res.status}): ${errText}`;
        try {
          const parsed = JSON.parse(errText);
          apiErrorMsg = parsed.error?.message || apiErrorMsg;
        } catch (_) {}
        console.error(`Gemini API response error (status ${res.status}): ${errText}`);
        await pool.query("UPDATE ai_models SET status_error = ? WHERE id = ?", [apiErrorMsg, activeModel.id]).catch(console.error);
      }
    }
  } catch (err) {
    console.error(`AI Provider error (${activeModel.provider}):`, err);
    await pool.query("UPDATE ai_models SET status_error = ? WHERE id = ?", [err.message || String(err), activeModel.id]).catch(console.error);
  }
  return null; // Return null if API fails
}

// POST /api/ai/generate-review (public — used by customer review page)
router.post("/generate-review", async (req, res) => {
  try {
    const data = generateReviewSchema.parse(req.body);

    // Validate subscription/trial expiration for the branch
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

    const { branch, business, ownerUserId } = subCheck;

    // Fetch last 15 reviews for this branch to prevent duplicates
    const [pastReviewRows] = await pool.query(
      "SELECT content FROM reviews WHERE branch_id = ? AND content IS NOT NULL AND content != '' ORDER BY created_at DESC LIMIT 15",
      [branch.id]
    );
    const pastReviews = pastReviewRows.map(r => r.content);

    // Check AI token usage against owner's subscription
    const [subRows] = await pool.query(
      "SELECT ai_tokens_used, ai_tokens_limit FROM subscriptions WHERE user_id = ? LIMIT 1",
      [ownerUserId]
    );

    if (subRows.length > 0 && subRows[0].ai_tokens_used >= subRows[0].ai_tokens_limit) {
      return res.status(402).json({ error: "AI token limit reached. Please upgrade your plan." });
    }

    // Fetch active AI model
    const [models] = await pool.query(
      "SELECT id, provider, model_name as modelName, api_key as apiKey FROM ai_models WHERE is_active = 1 LIMIT 1"
    );

    let reviews = [];
    let aiFailed = false;
    const keywordList = data.keywords
      ? data.keywords.split(",").map((k) => k.trim()).filter(Boolean)
      : [];

    if (models.length > 0) {
      try {
        const results = [];
        for (let index = 0; index < 3; index++) {
          const kwIndex = keywordList.length > 0 ? (data.keywordOffset + index) % keywordList.length : -1;
          const currentKeyword = kwIndex !== -1 ? keywordList[kwIndex] : "";
          const result = await generateReviewFromAI(
            models[0],
            data.businessName,
            data.rating,
            data.tone,
            currentKeyword,
            index,
            pastReviews,
            data.industry || business.industry || ""
          );
          if (result) {
            results.push(result);
          }
          if (index < 2) {
            await new Promise((resolve) => setTimeout(resolve, 200));
          }
        }
        reviews = results;
        if (reviews.length === 0) {
          aiFailed = true;
        }
      } catch (err) {
        aiFailed = true;
        console.error("AI generation failed, falling back to templates:", err);
      }
    } else {
      aiFailed = true;
    }

    // Fill up with template-based reviews if AI didn't return 3 reviews
    while (reviews.length < 3) {
      const idx = reviews.length;
      const kwIndex = keywordList.length > 0 ? (data.keywordOffset + idx) % keywordList.length : -1;
      const currentKeyword = kwIndex !== -1 ? keywordList[kwIndex] : "";
      reviews.push(
        generateReviewFromTemplate(
          data.businessName,
          data.rating,
          data.tone,
          currentKeyword,
          idx
        )
      );
    }

    // Store every generated/regenerated review in the database
    const crypto = await import("crypto");
    const storedReviewItems = [];

    for (let idx = 0; idx < reviews.length; idx++) {
      const text = reviews[idx];
      const kwIndex = keywordList.length > 0 ? (data.keywordOffset + idx) % keywordList.length : -1;
      const currentKeyword = kwIndex !== -1 ? keywordList[kwIndex] : (data.keywords || null);
      const reviewId = crypto.randomUUID();

      try {
        await pool.query(
          "INSERT INTO reviews (id, branch_id, rating, content, keyword, ai_generated, status) VALUES (?, ?, ?, ?, ?, 1, 'generated')",
          [reviewId, branch.id, data.rating, text, currentKeyword || null]
        );
      } catch (insertErr) {
        console.error("Failed to insert generated review:", insertErr.message);
      }

      storedReviewItems.push({
        id: reviewId,
        content: text,
        keyword: currentKeyword || "",
      });
    }

    // Increment token usage (30 tokens for 3 reviews generated)
    if (subRows.length > 0 && !aiFailed) {
      await pool.query(
        "UPDATE subscriptions SET ai_tokens_used = ai_tokens_used + 30 WHERE user_id = ?",
        [ownerUserId]
      );
    }

    return res.json({ reviews, reviewItems: storedReviewItems, review: reviews[0], aiFailed });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: error.issues[0].message });
    }
    console.error("AI generate error:", error);
    return res.status(500).json({ error: "Failed to generate review" });
  }
});

export default router;
