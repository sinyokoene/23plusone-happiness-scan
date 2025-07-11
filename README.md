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

## 🎯 Scoring Algorithm

The Individual Happiness Score (IHS) combines three components:

### N1: Affirmations + Time (40% weight)
- Sum of (4 × time_multiplier) for all "Yes" responses
- Time multipliers: ≤1s = 1.0, ≤2s = 0.8, ≤3s = 0.6, >3s = 0.4

### N2: Domain Coverage (40% weight)
- Number of unique domains with ≥1 "Yes" × 19.2
- Domains: Basics, Ambition, Self-development, Vitality, Attraction

### N3: Spread Score (20% weight)
- Measures balanced responses across domains
- Formula: (1.6 - Σ|domain_pct - 0.2|) / 1.6 × 100

**Final IHS = 0.4×N1 + 0.4×N2 + 0.2×N3**

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
