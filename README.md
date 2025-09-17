# 23plusone Happiness Scan Platform

A fully hosted, embeddable happiness questionnaire that measures emotional drivers through a timed 24-card survey. Calculates Individual Happiness Scores (IHS) and provides normative benchmarks.

## 🌟 Features

- **Timed Questionnaire**: 24 cards + 4 practice rounds, 4-second timer per card
- **IHS Scoring**: Weighted algorithm combining affirmations, domain coverage, and response spread
- **Data Persistence**: PostgreSQL database with full response tracking
- **Benchmarking**: Percentile calculations from accumulated data
- **Embeddable**: Responsive iframe design for any website
- **Social Sharing**: Web Share API with social media fallbacks
- **Beautiful UI**: Modern, mobile-responsive design

## 🚀 Quick Start

### 1. Prerequisites
- Node.js (v14+)
- PostgreSQL database
- Git

### 2. Installation

```bash
# Clone the repository
git clone <your-repo-url>
cd 23plusone-scan

# Install dependencies
cd server
npm install
```

### 3. Database Setup

Create a PostgreSQL database:
```bash
createdb happiness_benchmark
```

Set up environment variables:
```bash
# Copy the example environment file
cp .env.example .env

# Edit .env with your database URL
DATABASE_URL=postgres://username:password@localhost:5432/happiness_benchmark
```

Run the database schema:
```bash
psql $DATABASE_URL -f ../db/schema.sql
```

### 4. Start the Server

```bash
node server.js
```

### 5. Test Locally

Open your browser to:
- **Demo page**: `http://localhost:3000`
- **Direct scan**: `http://localhost:3000/scan.html`

## 📊 Architecture

```
[User Browser] <--> [scan.html Frontend]
                         |
                         |--> POST /api/responses --> [Express.js Backend]
                         |                                    |
                         |                                    v
                         |--> GET /api/benchmarks <-- [PostgreSQL Database]
```

## 🔧 API Endpoints

### POST /api/responses
Submit scan responses and calculated IHS.

**Request:**
```json
{
  "timestamp": "2024-01-01T12:00:00.000Z",
  "responses": [
    {
      "id": 1,
      "domain": "Basics",
      "yes": true,
      "time": 1500
    }
  ],
  "ihs": 85.6
}
```

### GET /api/benchmarks
Get percentile benchmarks from all responses.

**Response:**
```json
{
  "percentiles": [45.2, 62.8, 75.3, 88.1, 94.5],
  "labels": ["10th", "25th", "50th", "75th", "90th"],
  "responseCount": 150
}
```

### GET /api/stats
Get basic statistics.

**Response:**
```json
{
  "totalResponses": 150,
  "totalAnswers": 3600,
  "averageIHS": 72.4,
  "minIHS": 12.8,
  "maxIHS": 98.2
}
```

## 🎯 Scoring Algorithm (current)

The Individual Happiness Score (IHS) is a 0–100 score built from three normalized components:

### N1: Affirmations × Speed (40%)
- For each "Yes" response i with reaction time tᵢ (ms, clamped 0–4000):
  - linearᵢ = (4000 − tᵢ) / 4000 ∈ [0,1]
  - timeMultiplierᵢ = √(linearᵢ)  (gentle non‑linear curve, diminishing returns for ultra‑fast taps)
  - affirmationᵢ = 4 × timeMultiplierᵢ
- rawN1 = Σ affirmationᵢ across all "Yes"; max 24 × 4 = 96
- N1% = min(100, rawN1 / 96 × 100)

### N2: Domain Coverage (40%)
- Count distinct domains with ≥1 "Yes" across the five 23plusone domains
- N2% = (coveredDomains / 5) × 100

### N3: Spread/Evenness (20%)
- Let counts cᵈ be the number of "Yes" per domain d across all five domains (zeros included)
- If totalYes = Σ cᵈ is 0 → N3% = 0
- Otherwise proportions pᵈ = cᵈ / totalYes for the five domains; ideal balance is 0.2 each
- deviation = Σ |pᵈ − 0.2| over the five domains (max 1.6)
- N3% = max(0, (1.6 − deviation) / 1.6 × 100)

### Final score
IHS = 0.4 × N1% + 0.4 × N2% + 0.2 × N3%

### Examples
- One fast "Yes" only: N1% ≈ 4.2, N2% = 20, N3% = 0 → IHS ≈ 9.7
- Balanced 12 "Yes" evenly across domains at moderate speed: N1% ≈ 50, N2% ≈ 100, N3% ≈ 100 → IHS ≈ 80

### Quality rules (server + client)
- Must have 24 responses; >3 NULL timeouts → invalid
- All "No" → invalid; too fast total completion (<5s) → invalid
- Server protections: duplicate session guard; per‑IP rate limit (configurable)

Implementation: see `public/scripts/app.js`, function `calculateIHS`.

## 🌐 Deployment

### Heroku Deployment

1. Create a Heroku app:
```bash
heroku create your-app-name
```

2. Add PostgreSQL addon:
```bash
heroku addons:create heroku-postgresql:mini
```

3. Set environment variables:
```bash
heroku config:set NODE_ENV=production
```

4. Deploy:
```bash
git push heroku main
```

5. Run database migration:
```bash
heroku pg:psql < db/schema.sql
```

### Other Platforms

The app works on any platform supporting Node.js and PostgreSQL:
- **Netlify Functions**: Deploy frontend to Netlify, functions to Netlify Functions
- **Vercel**: Use Vercel Serverless Functions with Vercel Postgres
- **AWS**: Use EC2/ECS with RDS PostgreSQL
- **DigitalOcean**: App Platform with Managed PostgreSQL

## 📱 Embedding

### Basic Iframe
```html
<iframe src="https://your-domain.com/scan.html"
        width="100%" height="650" 
        style="border:0; border-radius:10px;"
        allowfullscreen></iframe>
```

### Responsive Container
```html
<div style="max-width: 450px; margin: 0 auto;">
  <iframe src="https://your-domain.com/scan.html"
          width="100%" height="650"
          style="border:0; border-radius:10px;"
          allowfullscreen></iframe>
</div>
```

### Squarespace Integration
1. Add a **Code Block** to your page
2. Paste the iframe code above
3. Adjust styling as needed

## 🔒 CORS & Security

The server is configured to:
- Allow iframe embedding from any origin
- Remove X-Frame-Options headers
- Enable CORS for API endpoints
- Validate all input data
- Use parameterized queries to prevent SQL injection

## 📈 Future Enhancements

- [ ] **Real-time benchmarks**: Display percentile on results page
- [ ] **Adaptive testing**: Reduce cards using IRT-based selection
- [ ] **Demographics**: Optional user metadata for group norms
- [ ] **Analytics dashboard**: Admin UI for response trends
- [ ] **A/B testing**: Multiple scoring algorithms
- [ ] **API authentication**: Rate limiting and API keys
- [ ] **Data export**: CSV/JSON exports for researchers

## 🛠️ Development

### Running Tests
```bash
npm test
```

### Code Formatting
```bash
npm run format
```

### Database Migrations
Add new migration files to `db/migrations/` and run:
```bash
psql $DATABASE_URL -f db/migrations/001_new_feature.sql
```

### Separate research database

The server can write WHO‑5 and SWLS submissions to a dedicated research database, separate from the main scan responses DB.

1. Provision a Postgres database (local or Supabase) for research.
2. Set the environment variable in `server/.env` or your hosting provider:

```
RESEARCH_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/happiness_research
```

If the `research_entries` table does not exist, the server will create it automatically on the first write or when calling `GET /api/research-results`.

Schema used:

```sql
CREATE TABLE IF NOT EXISTS research_entries (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  who5 INTEGER[] NOT NULL,
  swls INTEGER[] NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### Research results dashboard

Visit `/research-results.html` to see quick distributions and the latest entries. Data is fetched from `GET /api/research-results` (supports `?limit=200&from=...&to=...`).

## 📝 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## 📞 Support

For questions or issues:
- Create an issue on GitHub
- Email: support@23plusone.com
- Documentation: https://docs.23plusone.com
