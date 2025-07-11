# 23plusone Happiness Scan

## Setup

1. **Clone repo**  
2. **Install dependencies**  
   ```bash
   cd server
   npm install
```

3. **Configure your database**

   * Create a PostgreSQL database.
   * In `server/.env`, set:

     ```
     DATABASE_URL=postgres://sinyo@localhost:5432/happiness_benchmark
     ```
4. **Run schema**

   ```bash
   psql $DATABASE_URL -f ../db/schema.sql
   ```
5. **Start server**

   ```bash
   node server.js
   ```
6. **Open** `public/index.html` in your browser to test locally.

## Deployment & iframe embedding

* Deploy **public/** + **server/** together (e.g. on Heroku, Netlify + Functions, AWS, etc.).
* Ensure your host supports CORS and doesn’t send `X-Frame-Options: DENY`.
* **Squarespace**: add a Code Block with:

  ```html
  <iframe src="https://your-domain.com/scan.html"
          width="100%" height="650" style="border:0;"></iframe>
  ```
* That’s it—visitors can take the scan, see their IHS, and you’ll accumulate responses in your database for benchmarking! 