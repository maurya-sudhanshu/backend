```md name=README.md
# AutoRevo Backend

Node.js + Express backend for the AutoRevo platform. This service powers authentication, business and branch management, review workflows, AI-driven analytics, support tickets, subscriptions, and payment handling.

## Overview

This repository exposes a REST API used by the frontend to manage:

- user authentication and sessions
- business and branch records
- review submission and moderation
- AI model and analytics workflows
- subscription and trial logic
- support requests and replies
- payment verification and plan management

The server is bootstrapped in `app.js`, and the route logic is organized under `routes/`.

## Tech Stack

- Node.js
- Express
- MySQL via `mysql2`
- JWT for session auth
- `bcryptjs` for password hashing
- CORS and `cookie-parser`
- `zod` for request validation

## Project Structure

```text
.
├── app.js                  # Express app bootstrap and DB initialization
├── package.json            # Scripts and dependencies
├── .gitignore
├── config/
│   ├── db.js               # MySQL connection pool
│   └── env.js              # Runtime environment settings
├── models/
│   └── app_db.sql          # Database schema and seed SQL
├── routes/
│   ├── admin.js
│   ├── agents.js
│   ├── ai.js
│   ├── analytics.js
│   ├── auth.js
│   ├── branch.js
│   ├── branches.js
│   ├── businesses.js
│   ├── payments.js
│   └── reviews.js
├── utils/
│   ├── auth.js             # JWT and password helpers
│   └── subscription.js     # Trial and subscription checks
└── node_modules/           # Installed dependencies
```

## Main Features

### Authentication
- User signup and login
- Logout flow
- Cookie-based JWT sessions
- Suspended account checks
- Support ticket access and reply handling

### Business and Branch Management
- Create, update, and delete businesses
- Manage multiple branches per business
- Store Google Place / Google Review metadata
- Branch public review links and QR flow support

### Reviews and Rating Flow
- Review submission and moderation workflows
- Keyword and response support
- Low-rating threshold logic
- Business performance analytics

### AI and Analytics
- AI-related endpoints and model management
- Analytics summaries
- AI token tracking and plan-based limits

### Subscription and Plans
- Free trial lifecycle handling
- Paid plan validation
- Expiration logic
- Shared subscription checks in `utils/subscription.js`

### Support and Payments
- Contact/support form submission
- Ticket replies and status updates
- Payment settings and verification support
- UPI / QR-based payment handling

## Environment Configuration

The application reads runtime values from `config/env.js`.

Example:

```js
export const env = {
  DATABASE_URL: "mysql://root:@127.0.0.1:3306/app_db",
  PORT: 3001,
  JWT_SECRET: "magic-review-ai-dev-secret-change-me",
  STRIPE_SECRET_KEY: "sk_test_placeholder",
  STRIPE_WEBHOOK_SECRET: "whsec_placeholder",
  FRONTEND_URL: "https://autorevio.com/",
  NODE_ENV: "production",
};
```

Update these values before running the project in your environment.

## Database

This project expects a MySQL database to be available.

- Schema is provided in `models/app_db.sql`
- Startup logic in `app.js` creates and updates required tables if needed
- Database connection is configured in `config/db.js`

## Installation

1. Install dependencies:

```bash
npm install
```

2. Configure MySQL and update values in `config/env.js`

3. Start the server:

```bash
npm start
```

For development mode with live reload:

```bash
npm run dev
```

## API Routes

The app exposes the following major route groups:

```text
/api/auth
/api/businesses
/api/branches
/api/branch
/api/analytics
/api/reviews
/api/agents
/api/admin
/api/ai
/api/payments
```

These routes are mounted in `app.js` and used by the frontend client for platform operations.

## Notes

- The app is configured for a production-like frontend domain: `https://autorevio.com`
- Sessions use cookie-based authentication
- Startup includes safe schema migration and table creation logic to simplify local/bootstrap setup

## License

This project does not include a root license file. If you plan to publish or distribute this project, confirm the licensing terms before use.

## Contributing

To contribute:

1. Create a feature branch
2. Make your changes
3. Test locally
4. Open a pull request with a clear summary of your update

---

Generated for the `maurya-sudhanshu/backend` repository.
```

If you want, I can also give you:
- a shorter version for GitHub
- a more polished SaaS-style version
- a version with badges and product screenshots placeholders
