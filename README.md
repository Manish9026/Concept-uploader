# Concept Vault

A premium educational resource repository built with Express.js, Multer, and Monaco Editor.

## Features
- **Modern UI**: Dark-themed, responsive design with glassmorphism.
- **Nesting Support**: Organize concepts into parent-child relationships.
- **Built-in Editor**: Edit HTML concepts directly in the browser using the Monaco Editor.
- **Organized Uploads**: Group concepts by subject and custom sort order.

## Deployment

### Prerequisites
- Node.js (>= 14.x)
- npm

### Local Setup
1. `npm install`
2. `npm start` (Server runs on http://localhost:3000)

### Deployment Platforms
This project is configured for:
- **Render / Railway / Heroku**: Uses the `Procfile` and `start` script.
- **Vercel**: Uses `vercel.json`.

> [!WARNING]
> **Persistent Storage Note**: Platforms like Vercel and Heroku use ephemeral file systems. Uploaded HTML files and the `concepts.json` file will be reset when the server restarts or redeploys. 
> 
> For **Production Usage**, it is recommended to deploy on a platform with a **Persistent Disk** (like Render or Railway) or integrate with a database (MongoDB/PostgreSQL) and cloud storage (AWS S3/Cloudinary).

## Development
- Use `npm run dev` if you have `nodemon` installed for auto-restarts.
