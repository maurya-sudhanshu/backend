import {
  mysqlTable,
  text,
  timestamp,
  int,
  boolean,
  mysqlEnum,
  index,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { relations, sql } from "drizzle-orm";
import crypto from "crypto";


// Helper for generating UUIDs on the client side since MySQL doesn't natively do UUID generation well in schemas sometimes
const generateId = () => crypto.randomUUID();

// Users (business owners)
export const users = mysqlTable(
  "users",
  {
    id: varchar("id", { length: 36 }).primaryKey().$defaultFn(generateId),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    role: mysqlEnum("role", ["admin", "owner", "agent"]).notNull().default("owner"),
    createdAt: timestamp("created_at")
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    emailIdx: uniqueIndex("users_email_idx").on(table.email),
    roleIdx: index("users_role_idx").on(table.role),
  })
);

// Subscription / plan info per user
export const subscriptions = mysqlTable("subscriptions", {
  id: varchar("id", { length: 36 }).primaryKey().$defaultFn(generateId),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  plan: mysqlEnum("plan", ["silver", "gold", "platinum"]).notNull().default("silver"),
  aiTokensUsed: int("ai_tokens_used").notNull().default(0),
  aiTokensLimit: int("ai_tokens_limit").notNull().default(10000),
  maxBranches: int("max_branches").notNull().default(2),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at")
    .defaultNow()
    .notNull(),
});

// Business
export const businesses = mysqlTable(
  "businesses",
  {
    id: varchar("id", { length: 36 }).primaryKey().$defaultFn(generateId),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    industry: text("industry"),
    googlePlaceId: text("google_place_id"),
    googleReviewUrl: text("google_review_url"),
    createdAt: timestamp("created_at")
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    userIdx: index("businesses_user_idx").on(table.userId),
  })
);

// Branches (locations of a business, each with its own QR)
export const branches = mysqlTable(
  "branches",
  {
    id: varchar("id", { length: 36 }).primaryKey().$defaultFn(generateId),
    businessId: varchar("business_id", { length: 36 })
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    address: text("address"),
    qrCode: text("qr_code"), // unique short slug / identifier
    publicSlug: varchar("public_slug", { length: 255 }).notNull(), // Needs to be varchar for unique index in MySQL
    lowRatingThreshold: int("low_rating_threshold").notNull().default(3),
    createdAt: timestamp("created_at")
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    businessIdx: index("branches_business_idx").on(table.businessId),
    slugIdx: uniqueIndex("branches_slug_idx").on(table.publicSlug),
  })
);

// Reviews (customer submissions)
export const reviews = mysqlTable(
  "reviews",
  {
    id: varchar("id", { length: 36 }).primaryKey().$defaultFn(generateId),
    branchId: varchar("branch_id", { length: 36 })
      .notNull()
      .references(() => branches.id, { onDelete: "cascade" }),
    customerName: text("customer_name"),
    customerEmail: text("customer_email"),
    rating: int("rating").notNull(),
    content: text("content"),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    status: mysqlEnum("status", ["pending", "public", "private", "ignored"]).notNull().default("public"),
    googleReviewLink: text("google_review_link"),
    createdAt: timestamp("created_at")
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    branchIdx: index("reviews_branch_idx").on(table.branchId),
    statusIdx: index("reviews_status_idx").on(table.status),
  })
);

// AI-generated auto replies
export const aiReplies = mysqlTable("ai_replies", {
  id: varchar("id", { length: 36 }).primaryKey().$defaultFn(generateId),
  reviewId: varchar("review_id", { length: 36 })
    .notNull()
    .references(() => reviews.id, { onDelete: "cascade" }),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  reply: text("reply").notNull(),
  posted: boolean("posted").notNull().default(false),
  createdAt: timestamp("created_at")
    .defaultNow()
    .notNull(),
});

// Audit reports (GBP audits)
export const auditReports = mysqlTable("audit_reports", {
  id: varchar("id", { length: 36 }).primaryKey().$defaultFn(generateId),
  businessId: varchar("business_id", { length: 36 })
    .notNull()
    .references(() => businesses.id, { onDelete: "cascade" }),
  score: int("score").notNull(),
  reportData: text("report_data").notNull(), // JSON stringified
  createdAt: timestamp("created_at")
    .defaultNow()
    .notNull(),
});

// Contact form messages
export const contactMessages = mysqlTable("contact_messages", {
  id: varchar("id", { length: 36 }).primaryKey().$defaultFn(generateId),
  name: text("name").notNull(),
  email: text("email").notNull(),
  message: text("message").notNull(),
  plan: text("plan"),
  createdAt: timestamp("created_at")
    .defaultNow()
    .notNull(),
});

// Relations
export const agentBranches = mysqlTable("agent_branches", {
  id: varchar("id", { length: 36 }).primaryKey().$defaultFn(generateId),
  userId: varchar("user_id", { length: 36 })
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  branchId: varchar("branch_id", { length: 36 })
    .notNull()
    .references(() => branches.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at")
    .defaultNow()
    .notNull(),
}, (table) => ({
  userBranchIdx: uniqueIndex("agent_branch_idx").on(table.userId, table.branchId),
}));

export const usersRelations = relations(users, ({ many }) => ({
  businesses: many(businesses),
  subscriptions: many(subscriptions),
  agentBranches: many(agentBranches),
}));

export const businessesRelations = relations(businesses, ({ one, many }) => ({
  user: one(users, { fields: [businesses.userId], references: [users.id] }),
  branches: many(branches),
}));

export const branchesRelations = relations(branches, ({ one, many }) => ({
  business: one(businesses, {
    fields: [branches.businessId],
    references: [businesses.id],
  }),
  reviews: many(reviews),
  agentBranches: many(agentBranches),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  branch: one(branches, {
    fields: [reviews.branchId],
    references: [branches.id],
  }),
}));

export const agentBranchesRelations = relations(agentBranches, ({ one }) => ({
  user: one(users, {
    fields: [agentBranches.userId],
    references: [users.id],
  }),
  branch: one(branches, {
    fields: [agentBranches.branchId],
    references: [branches.id],
  }),
}));
