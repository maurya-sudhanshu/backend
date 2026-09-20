import express from "express";
import crypto from "crypto";
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

// Human-like template fallback generator when AI API is unavailable or fast-fails
function generateReviewFromTemplate(businessName, rating, tone, keywords, variationIndex = 0) {
  const keywordList = keywords
    ? keywords.split(",").map((k) => k.trim()).filter(Boolean)
    : [];

  const mainKeyword = keywordList.length > 0 ? keywordList[0] : "";

  const templates = [
    // Variation 0: Clean, authentic customer voice (proper capitalization, polite)
    () => {
      const kw = mainKeyword ? `The ${mainKeyword} was top notch.` : "The overall experience was great.";
      return `Really pleased with my visit to ${businessName}. The staff was welcoming, attentive, and handled everything efficiently. ${kw} I will definitely return.`;
    },
    // Variation 1: First letter capital and other small (casual phone typing)
    () => {
      const kw = mainKeyword ? `special mention to their ${mainKeyword}, which was fantastic.` : "everything was handled with great care.";
      return `Had a wonderful experience at ${businessName}. ${kw} quality service and a clean atmosphere. definitely recommend checking them out`;
    },
    // Variation 2: Real human mistakes (subtle typos, lowercase i, missing apostrophes)
    () => {
      const kw = mainKeyword ? `really liked the ${mainKeyword}.` : "staff was super freindly.";
      return `Glad i decided to try ${businessName}. ${kw} Fair pricing and great overall service. i didnt expect it to be this good, definetly recomended`;
    },
  ];

  const templateFn = templates[variationIndex % templates.length];
  return templateFn();
}

// Format review 2: first letter capital, other letters and sentence starters small
function formatFirstLetterCapitalOtherSmall(text, businessName = "") {
  if (!text) return text;
  const trimmed = text.trim();
  if (!trimmed) return trimmed;

  // Convert to lowercase and capitalize only the very first character of the review
  let result = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();

  // If the business name is mentioned, preserve its proper casing
  if (businessName && businessName.trim()) {
    try {
      const escaped = businessName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      result = result.replace(new RegExp(escaped, "gi"), businessName.trim());
    } catch (_) {}
  }

  return result;
}

// Format review 3: realistic human phone typing mistakes (missing apostrophes, lowercase i, common typos)
function applyHumanMistakes(text) {
  if (!text) return text;
  let s = text.trim();

  // 1. Lowercase standalone 'I' -> 'i'
  s = s.replace(/\bI\b/g, "i");

  // 2. Remove apostrophes from common phone typing contractions
  const contractions = [
    [/\bdon't\b/gi, "dont"],
    [/\bdidn't\b/gi, "didnt"],
    [/\bcan't\b/gi, "cant"],
    [/\bwon't\b/gi, "wont"],
    [/\bit's\b/gi, "its"],
    [/\bthat's\b/gi, "thats"],
    [/\bthere's\b/gi, "theres"],
    [/\bwasn't\b/gi, "wasnt"],
    [/\bcouldn't\b/gi, "couldnt"],
    [/\bwouldn't\b/gi, "wouldnt"],
    [/\bI'm\b/gi, "im"],
    [/\bI've\b/gi, "ive"],
    [/\bI'll\b/gi, "ill"],
    [/\bwe've\b/gi, "weve"],
    [/\bthey're\b/gi, "theyre"],
    [/\byou're\b/gi, "youre"],
  ];
  for (const [pattern, replacement] of contractions) {
    s = s.replace(pattern, replacement);
  }

  // 3. Subtle common human typos (apply at most one so it stays natural)
  const commonTypos = [
    [/\bdefinitely\b/gi, "definitly"],
    [/\brecommended\b/gi, "recomended"],
    [/\brecommend\b/gi, "recomend"],
    [/\bfriendly\b/gi, "freindly"],
    [/\bexperience\b/gi, "experiance"],
    [/\bawesome\b/gi, "awsome"],
    [/\bdelicious\b/gi, "delicous"],
    [/\breceive\b/gi, "recieve"],
    [/\buntil\b/gi, "untill"],
  ];
  for (const [pattern, replacement] of commonTypos) {
    if (pattern.test(s)) {
      s = s.replace(pattern, replacement);
      break;
    }
  }

  // 4. Sometimes end without trailing period (very common in phone reviews)
  if (s.endsWith(".")) {
    s = s.slice(0, -1);
  }

  return s;
}

// Post-processor ensuring diverse human styles across the generated reviews
function applyReviewStyles(reviews, businessName = "") {
  return reviews.map((rev, index) => {
    if (index === 1) {
      return formatFirstLetterCapitalOtherSmall(rev, businessName);
    }
    if (index === 2) {
      return applyHumanMistakes(rev);
    }
    return rev;
  });
}

// Fast fetch helper with strict timeout and fast-fail on quota exhaustion
async function fetchWithFastFail(url, options, timeoutMs = 4500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (res.status === 429) {
      let errMsg = "";
      try {
        const clone = res.clone();
        const data = await clone.json();
        errMsg = data.error?.message || "";
      } catch (_) {}
      console.warn(`AI Provider 429 Rate Limit on ${url}: ${errMsg}`);
      return { ok: false, status: 429, errorMsg: errMsg, res };
    }

    return { ok: res.ok, status: res.status, res };
  } catch (err) {
    clearTimeout(timer);
    console.warn(`Fetch to ${url} failed or timed out (${timeoutMs}ms):`, err.message);
    return { ok: false, status: 0, errorMsg: err.message };
  }
}

// Extract reviews from AI output (JSON array or fallback structure)
function extractReviewsFromRawText(rawText) {
  if (!rawText) return [];

  // 1. Try parsing JSON array directly
  try {
    const cleaned = rawText.replace(/```json/gi, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch (_) {}

  // 2. Fallback: extract numbered items (e.g. 1. "review", 2. "review")
  const numbered = rawText.match(/(?:^|\n)\s*(?:\d+[\.\)]|\-)\s*["']?([\s\S]+?)(?=["']?\s*(?:\n\s*(?:\d+[\.\)]|\-)|$))/g);
  if (numbered && numbered.length > 0) {
    const items = numbered
      .map((item) =>
        item
          .replace(/^\s*(?:\d+[\.\)]|\-)\s*["']?/, "")
          .replace(/["']?\s*$/, "")
          .trim()
      )
      .filter((l) => l.length > 15);
    if (items.length > 0) return items;
  }

  // 3. Fallback: split by double line breaks
  const paragraphs = rawText
    .split(/\n{2,}/)
    .map((l) => l.trim().replace(/^["']|["']$/g, ""))
    .filter((l) => l.length > 15);

  return paragraphs;
}

// Generate all 3 reviews in ONE single AI API call for maximum speed
async function generateAllReviewsFromAI(activeModel, businessName, rating, tone, keywords, pastReviews = [], industry = "") {
  const keywordList = keywords
    ? keywords.split(",").map((k) => k.trim()).filter(Boolean)
    : [];

  const prompt = `You are real customers writing 3 authentic Google reviews for "${businessName}"${industry ? ` (${industry})` : ""}.
Star Rating: ${rating}/5 stars.
${keywordList.length > 0 ? `Key aspects to naturally weave in: ${keywordList.join(", ")}.` : ""}

Generate exactly 3 reviews with DISTINCT, AUTHENTIC human writing styles:
- Review 1 (Normal Clean Style): Well-written, positive, polite customer voice with standard capitalization and proper sentences.
- Review 2 (Casual Mobile Typing Style - First letter capital and other small): Phone typing style where only the very first letter of the review is capital and subsequent sentences/words are typed in small letters (e.g., "Really loved the food here. service was fast and staff was very polite. will definitely come back soon").
- Review 3 (Human Imperfections Style): Authentic customer review with minor everyday phone typing mistakes or casual flaws (e.g., missing apostrophe like "dont" or "didnt", casual lowercase "i", or minor slip like "recomended" or "definitly", natural informal tone).

CRITICAL RULES:
1. LENGTH: Short (1 to 3 natural sentences, 20-40 words each).
2. REALISM: Sound like real everyday people writing on Google Maps, NOT robotic AI. Do not use AI clichés such as "exceeded expectations", "simply the best", or "testament to".
${pastReviews.length > 0 ? `3. AVOID REPETITION: Do NOT repeat phrasing from these past reviews:\n${pastReviews.slice(0, 5).map((r) => `- "${r}"`).join("\n")}` : ""}

Return ONLY a valid JSON array containing exactly 3 review strings:
["review 1 text", "review 2 text", "review 3 text"]`;

  try {
    const provider = (activeModel.provider || "").toLowerCase();

    if (provider === "openai" || provider === "zlm") {
      const baseUrl = provider === "zlm" ? "https://api.zlm.example/v1" : "https://api.openai.com/v1";
      const result = await fetchWithFastFail(
        `${baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${activeModel.apiKey}`,
          },
          body: JSON.stringify({
            model: activeModel.modelName || "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 350,
            temperature: 0.9,
          }),
        },
        4500
      );

      if (result.ok) {
        const data = await result.res.json();
        await pool.query("UPDATE ai_models SET status_error = NULL WHERE id = ?", [activeModel.id]).catch(console.error);
        const rawContent = data.choices?.[0]?.message?.content?.trim();
        return extractReviewsFromRawText(rawContent);
      } else {
        const errMsg = result.errorMsg || `HTTP error ${result.status}`;
        await pool.query("UPDATE ai_models SET status_error = ? WHERE id = ?", [errMsg, activeModel.id]).catch(console.error);
      }
    } else if (provider === "gemini") {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel.modelName || "gemini-1.5-flash"}:generateContent?key=${activeModel.apiKey}`;
      const result = await fetchWithFastFail(
        url,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.9,
              maxOutputTokens: 500,
              thinkingConfig: {
                thinkingBudget: 0,
              },
            },
          }),
        },
        4500
      );

      if (result.ok) {
        const data = await result.res.json();
        await pool.query("UPDATE ai_models SET status_error = NULL WHERE id = ?", [activeModel.id]).catch(console.error);
        const rawContent = data.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim();
        return extractReviewsFromRawText(rawContent);
      } else {
        const errMsg = result.errorMsg || `HTTP error ${result.status}`;
        await pool.query("UPDATE ai_models SET status_error = ? WHERE id = ?", [errMsg, activeModel.id]).catch(console.error);
      }
    }
  } catch (err) {
    console.error(`AI Provider error (${activeModel.provider}):`, err.message);
    await pool.query("UPDATE ai_models SET status_error = ? WHERE id = ?", [err.message || String(err), activeModel.id]).catch(console.error);
  }

  return [];
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

    // Concurrently fetch past reviews, subscription usage, and active AI model
    const [[pastReviewRows], [subRows], [models]] = await Promise.all([
      pool.query(
        "SELECT content FROM reviews WHERE branch_id = ? AND content IS NOT NULL AND content != '' ORDER BY created_at DESC LIMIT 15",
        [branch.id]
      ),
      pool.query(
        "SELECT ai_tokens_used, ai_tokens_limit FROM subscriptions WHERE user_id = ? LIMIT 1",
        [ownerUserId]
      ),
      pool.query(
        "SELECT id, provider, model_name as modelName, api_key as apiKey FROM ai_models WHERE is_active = 1 LIMIT 1"
      ),
    ]);

    const pastReviews = pastReviewRows.map((r) => r.content);

    // Check token quota
    if (subRows.length > 0 && subRows[0].ai_tokens_used >= subRows[0].ai_tokens_limit) {
      return res.status(402).json({ error: "AI token limit reached. Please upgrade your plan." });
    }

    let reviews = [];
    let aiFailed = false;

    // Generate in a single fast call if active model exists
    if (models.length > 0) {
      try {
        const generated = await generateAllReviewsFromAI(
          models[0],
          data.businessName,
          data.rating,
          data.tone,
          data.keywords || "",
          pastReviews,
          data.industry || business.industry || ""
        );

        if (generated && generated.length > 0) {
          reviews = generated.slice(0, 3);
        } else {
          aiFailed = true;
        }
      } catch (err) {
        aiFailed = true;
        console.error("AI generation failed, falling back to templates:", err.message);
      }
    } else {
      aiFailed = true;
    }

    const keywordList = data.keywords
      ? data.keywords.split(",").map((k) => k.trim()).filter(Boolean)
      : [];

    // Fill up with high-quality human template reviews if AI returned fewer than 3
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

    // Apply human variations:
    // Review 0: Normal clean customer voice
    // Review 1: First letter capital and other small
    // Review 2: Realistic human phone typing mistakes
    reviews = applyReviewStyles(reviews, data.businessName);

    // Store generated reviews in the database concurrently
    const storedReviewItems = [];
    const insertPromises = [];

    for (let idx = 0; idx < reviews.length; idx++) {
      const text = reviews[idx];
      const kwIndex = keywordList.length > 0 ? (data.keywordOffset + idx) % keywordList.length : -1;
      const currentKeyword = kwIndex !== -1 ? keywordList[kwIndex] : (data.keywords || null);
      const reviewId = crypto.randomUUID();

      storedReviewItems.push({
        id: reviewId,
        content: text,
        keyword: currentKeyword || "",
      });

      insertPromises.push(
        pool.query(
          "INSERT INTO reviews (id, branch_id, rating, content, keyword, ai_generated, status) VALUES (?, ?, ?, ?, ?, 1, 'generated')",
          [reviewId, branch.id, data.rating, text, currentKeyword || null]
        ).catch((insertErr) => {
          console.error("Failed to insert generated review:", insertErr.message);
        })
      );
    }

    await Promise.all(insertPromises);

    // Increment token usage (10 tokens per generation)
    if (subRows.length > 0 && !aiFailed) {
      await pool.query(
        "UPDATE subscriptions SET ai_tokens_used = ai_tokens_used + 10 WHERE user_id = ?",
        [ownerUserId]
      ).catch(console.error);
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
