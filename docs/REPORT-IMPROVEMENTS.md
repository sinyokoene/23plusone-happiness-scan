# Report Text Generation Improvements

## Executive Summary

We've completely overhauled how the 23plusone Happiness Scan generates personalized report text. The new system moves from generic, domain-score-based narratives to card-aware, pattern-detecting, response-time-weighted insights that feel genuinely personal to each user.

---

## Problems with the Old Report

### 1. Generic Domain-Based Text
The old system only looked at aggregate domain scores (Low/Mid/High bands):
- **Same text for everyone** with similar domain scores
- "You're fueled by Self-development" told users nothing specific
- No reference to the actual cards/values they selected

### 2. No Pattern Recognition
- Users who selected complementary cards (e.g., Creativity + Discovery = explorer mindset) got no acknowledgment of this meaningful combination
- Rich behavioral patterns were invisible in the output

### 3. Arbitrary Insights
- The "insight" was just a generic sentence per domain band
- Example: High Ambition always showed "Achievement and recognition fuel your fire — you're built to succeed."
- No variation, no personalization, felt robotic after multiple takes

### 4. No Use of Response Time Data
- We collect precise response times (users have 4 seconds per card)
- Fast responses = strong gut reactions = high-confidence signals
- Old system completely ignored this valuable data

### 5. Coach Tips Were Generic
- Same tip for everyone in the same band
- "Do one small thing for someone else this week" doesn't reference what the user actually values

---

## The Plan (Implemented)

### Architecture Changes

1. **New Data File: `card-insights.json`**
   - Per-card metadata: value names, traits, short insights, coach tips
   - Pattern definitions: 12 meaningful card combinations
   - Domain summaries with 3 text variations per band
   - Phrase libraries for openings, transitions, closings

2. **Enhanced `buildPersonalizedInsight()` in `app.js`**
   - Receives actual card selections, not just aggregate scores
   - Detects patterns from card combinations
   - Uses fastest response times as confidence signals
   - Picks from variation arrays to avoid repetition

3. **Card-Aware PDF Report (`report.html`)**
   - Receives `selectedCardIds` and `answers` in payload
   - Generates card-specific narratives per domain
   - Pattern detection with intelligent sorting
   - Card-specific coach recommendations

---

## Improvements in Detail

### 1. Card-Specific Insights

**Before:**
> "You're fueled by Self-development. You're driven by growth and self-expression — a true lifelong learner."

**After:**
> "Your quick responses to Creativity and Discovery reveal what truly drives you. You approach life with an open and questioning mind. Your curiosity and imagination work hand in hand. You tend to feel most alive when you can explore, learn and try out new possibilities."

The new text references the specific values (Creativity, Discovery) the user actually selected.

### 2. Pattern Detection (17 Archetypes)

We now detect meaningful card combinations (including cross-domain patterns):

| Pattern | Required Cards | Insight |
|---------|---------------|---------|
| The Explorer | Creativity + Discovery | Curiosity and imagination work together |
| The Nurturer | Connection + Warmth | Care and connection at their core |
| The Achiever | Capability + Achievement + Challenge | Driven by mastery and progress |
| The Free Spirit | Relaxation + Play + Freedom | Values ease, play, room to move |
| The Grounded Leader | Order + Safety + Influence | Stability with direction |
| Holistic Wellness | Fitness + Health + Beauty | Multi-dimensional wellbeing |
| The Visionary Idealist | Idealism + Creativity + Achievement | Big ideas meet action |
| Authentic Expression | Creativity + Individuality | Self-expression through creation |
| The Status Builder | Pride + Appreciation + Standing | Recognition fuels motivation |
| The Sensory Connoisseur | Beauty + Sensuality | Life through refined senses |
| The Balance Seeker (cross-domain) | Safety + Relaxation + Fitness | Active harmony between stability and vitality |
| The Creative Achiever (cross-domain) | Creativity + Achievement | Creating with impact |
| The Connector-Achiever (cross-domain) | Connection + Achievement | Achievement through relationships |
| The Mindful Performer (cross-domain) | Health + Challenge | Push hard, recover well |
| The Creative Nurturer (cross-domain) | Creativity + Warmth | Care expressed through making |
| The Principled Visionary (cross-domain) | Loyalty + Idealism | Purpose guided by principles |
| The Balanced Striver (cross-domain) | Relaxation + Achievement | Knows when to push and when to pause |

### 3. Intelligent Pattern Sorting

When multiple patterns match, we now pick the **best fit**, not the first defined:

**Sorting Priority:**
1. **Match Count**: 3 matching cards beats 2
2. **Match Percentage**: 2/2 (100%) beats 2/3 (67%)  
3. **Response Time**: Faster responses = stronger gut reaction = wins ties

**Example:** User matches Achiever (3/3, avg 1200ms) and Free Spirit (3/3, avg 800ms)
→ Free Spirit wins because faster responses indicate stronger instinct

### 4. Secondary Pattern Mention

When a second pattern also matches strongly:
> "The Free Spirit: You value ease, play and room to move... **You also show elements of The Achiever.**"

This gives users a richer picture without overwhelming them.

### 5. Response Time Utilization

Fast responses (under 1.5s) are now called out:
> "Your quick responses to **Creativity and Freedom** reveal what truly drives you."

This validates the user's gut reactions as meaningful data.

### 6. Card-Specific Coach Tips (24 unique tips)

**Before (generic):**
> "Do one small thing for someone else this week."

**After (card-specific):**
- Card 1 (Idealism): "Choose one issue you care about and take a small, concrete step for it this week."
- Card 10 (Creativity): "Give yourself twenty minutes to make or shape something, without judging the result."
- Card 21 (Fitness): "Include at least one short moment of movement in your day, such as a walk or a stretch."

### 7. Text Variation System

Each insight type now has 3 variations to avoid repetition:

**High Basics (3 variations):**
1. "You naturally help people feel included and safe."
2. "Being connected to others seems to give you energy."
3. "You are often the person others can rely on."

### 8. Professional Coaching Tone

All text was rewritten with:
- **Observational language**: "You seem to..." instead of "You are..."
- **Permission-giving**: "Allow yourself..." instead of commands
- **Non-judgmental framing**: Even low scores are opportunities, not deficiencies
- **Actionable specificity**: Clear timeframes and concrete actions

### 9. How insights are created now (signals)
- **Scoring:** Single score (N1) only — affirmed cards weighted by a sqrt time curve (faster = stronger, with diminishing returns), normalized to 0–100.
- **Card-aware narratives:** Use selected card ids + domain percentiles to pick headlines/insights and reference the actual cards chosen.
- **Pattern detection:** Uses defined card combinations (incl. cross-domain), ranks by match strength and response-time confidence, and can mention secondary patterns.
- **Engagement signals:** Modality (click vs. timeout/NULL), pace shape (decisive vs. hesitant), and where slowdowns occur; used to steer tone and tie-breaks.

---

## Files Changed

| File | Changes |
|------|---------|
| `public/data/card-insights.json` | NEW - All card metadata, patterns, text variations |
| `public/scripts/app.js` | Enhanced insight generation, pattern detection, payload updates |
| `public/report.html` | Card-aware narratives, improved coach blocks, pattern sorting |

---

## Testing the Changes

To verify the improvements:
1. Complete a scan with varied card selections
2. Check the in-app insight block for card-specific references
3. Request the full PDF report
4. Verify patterns are detected and mentioned
5. Confirm coach tips reference specific values

---

## Future Considerations

- **A/B Testing**: Compare engagement with old vs new text
- **Copywriter Review**: Have team review all 200+ text variations
- **Localization**: Structure supports future translation
- **Analytics**: Track which patterns are most commonly detected

