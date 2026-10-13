<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0F172A,45:4F46E5,100:818CF8&height=210&section=header&text=Autorevio%20Backend&fontSize=42&fontColor=FFFFFF&fontAlignY=38&desc=APIs%20%7C%20Authentication%20%7C%20Business%20Logic&descAlignY=60&descSize=16" width="100%" alt="Autorevio backend banner" />

<p>
  <img src="https://img.shields.io/badge/Node.js-Backend-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/Express.js-API%20Server-111827?style=for-the-badge&logo=express&logoColor=white" alt="Express.js" />
  <img src="https://img.shields.io/badge/MySQL-Database-4479A1?style=for-the-badge&logo=mysql&logoColor=white" alt="MySQL" />
</p>

**Backend services for Autorevio — powering application APIs, authentication, and data access.**

</div>

---

## ✨ Overview

This repository contains the **Autorevio backend**, built with Node.js and Express. It provides the server-side foundation for the application, including API routing, database connectivity, authentication utilities, and request handling.

The backend is designed to work alongside the Autorevio frontend.

## 🧰 Tech Stack

<div align="center">

<img src="https://skillicons.dev/icons?i=nodejs,express,mysql&theme=dark" alt="Node.js, Express and MySQL" />

<br/>

<img src="https://img.shields.io/badge/Node.js-ES%20Modules-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js ES Modules" />
<img src="https://img.shields.io/badge/Express.js-4.x-111827?style=flat-square&logo=express" alt="Express.js" />
<img src="https://img.shields.io/badge/MySQL-mysql2-4479A1?style=flat-square&logo=mysql&logoColor=white" alt="MySQL mysql2" />
<img src="https://img.shields.io/badge/Auth-JWT-000000?style=flat-square&logo=jsonwebtokens&logoColor=white" alt="JWT authentication" />
<img src="https://img.shields.io/badge/Validation-Zod-3E67B1?style=flat-square" alt="Zod validation" />

</div>

| Technology | Purpose |
|---|---|
| Node.js | JavaScript runtime for server-side code |
| Express | HTTP server and API routing |
| MySQL2 | MySQL database connectivity |
| JSON Web Token | Token-based authentication support |
| bcryptjs | Password hashing utilities |
| Zod | Data/schema validation |
| CORS | Cross-origin request configuration |
| Cookie Parser | Parsing cookies from HTTP requests |
| QRCode | QR-code generation utilities |
| dotenv | Environment variable loading |

## 📁 Project Structure

```text
backend/
├── config/          # Application and service configuration
├── models/          # Data models and database-related logic
├── routes/          # API route handlers
├── utils/           # Shared utilities
├── app.js           # Express application entry point
├── package.json     # Dependencies and scripts
└── .gitignore       # Git exclusions
```

## ⚙️ Getting Started

### Prerequisites

- Node.js and npm
- A MySQL server and database
- Environment variables required by the application

### 1. Clone the repository

```bash
git clone https://github.com/maurya-sudhanshu/backend.git
cd backend
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a local `.env` file in the project root and set the values required by your configuration and route files. For example, your setup may need database connection details, an authentication secret, and the server port.

```env
PORT=5000
# Add the actual variable names and values required by your application.
# Do not commit credentials or production secrets.
```

Use the exact variable names expected by the current source code. Never publish real passwords, access tokens, or JWT secrets in this repository.

### 4. Run in development

```bash
npm run dev
```

The development script uses Node's watch mode to restart the server when files change.

### 5. Start the server

```bash
npm start
```

Check the terminal output for the port and startup status. The actual API base URL depends on your local and deployment configuration.

## 📜 Available Scripts

| Command | Description |
|---|---|
| `npm run dev` | Run the server with Node.js watch mode |
| `npm start` | Start the server normally |

## 🔌 API Routes

API endpoints are organized under the `routes/` directory. Review the route files and `app.js` to confirm the exact endpoint paths, HTTP methods, required payloads, and authentication requirements.

## 🔐 Security Notes

- Keep `.env` files and credentials out of version control.
- Hash passwords with a suitable password-hashing function; never store plain-text passwords.
- Validate request data before using it in business logic or database queries.
- Use parameterized SQL queries to reduce SQL injection risk.
- Configure CORS for the frontend origins you trust.
- Use HTTPS and strong, private signing secrets in production.
- Return safe error messages to clients and keep sensitive diagnostics in server logs.

## 🔗 Related Project

<div align="center">

<a href="https://github.com/maurya-sudhanshu/autorevio-frontend">
  <img src="https://img.shields.io/badge/Autorevio-Frontend%20Repository-7C3AED?style=for-the-badge&logo=github&logoColor=white" alt="Autorevio frontend repository" />
</a>

</div>

---

<div align="center">

**Autorevio Backend** · Built with Node.js, Express, and MySQL.

<img src="https://capsule-render.vercel.app/api?type=waving&color=0:0F172A,45:4F46E5,100:818CF8&height=100&section=footer" width="100%" alt="Footer decoration" />

</div>
