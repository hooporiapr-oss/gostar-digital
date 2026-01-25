# 🏀 THE LAUGHCOURT BIBLE
### The Definitive Platform Guide
### Version 1.0 | January 25, 2026

---

## EXECUTIVE SUMMARY

**LaughCourt** is a cognitive fitness gaming platform that trains memory through basketball-themed exercises. Two games, 60 divisions, bilingual English/Spanish, freemium model at $5/month. Built for joy.

**Tagline:** "Where Joy Meets The Game" / "Donde La Alegría Se Une Al Juego"

**Live Site:** https://www.gostardigital.com

---

## COMPANY

| Field | Value |
|-------|-------|
| **Company** | GoStar Digital LLC |
| **Location** | Puerto Rico 🇵🇷 |
| **Founder/CEO** | GoTrotter |
| **Background** | Former professional basketball player, LIU Blackbirds alumnus |
| **Origin of "GoStar"** | Last three letters of founder's surname |

---

## TRADEMARKS & IP

| Trademark | Description |
|-----------|-------------|
| **LaughCourt™** | Platform brand |
| **The Starting Five™** | Character roster |
| **GoStars™** | Achievement/tier system |
| **Ritnome™** | Proprietary rhythm + metronome BPM technology |

---

## THE GAMES

### THE MATCH 🎯
**Type:** Spatial Memory

Cells light up gold **simultaneously** on the 5×5 court. Remember their positions and tap them all to advance.

### THE SEQUENCE 🔢
**Type:** Sequential Memory

Watch the pattern light up **one by one**. Tap it back in the exact order. The longer you go, the harder it gets.

---

## PROGRESSION SYSTEM

### Levels
- **10 Levels** (L1 through L10)
- Difficulty increases with each level

### Speeds (Powered by Ritnome™)
| Speed | Access | BPM |
|-------|--------|-----|
| SLOW | FREE | Longer display time |
| MED | $5/mo | Medium display time |
| FAST | $5/mo | Short display time |

### Total Divisions
**60 Divisions** = 10 Levels × 3 Speeds × 2 Games

### GoStars Achievement System
10 tiers of mastery progression with laugh-based scoring mechanics and celebration animations.

---

## BUSINESS MODEL

### Pricing
| Tier | Price | Access |
|------|-------|--------|
| **Free** | $0 | SLOW speed only, both games |
| **Subscriber** | $5/month | All speeds (SLOW, MED, FAST), both games |

### Puerto Rico Tax (IVU)
- Rate: 11.5%
- Subscriber total: $5.00 + $0.58 = **$5.58/month**

### Trial
- 7-day free trial via Stripe
- Full access to all speeds during trial

---

## THE STARTING FIVE™

The character roster representing the LaughCourt brand. Based on real LIU Blackbirds teammates (the brotherhood story is private IP).

**Characters:**
- CLAUDE
- SKEE
- BRIGS
- DUCE
- EL MAGO
- TEDDY

Each character has a unique personality and basketball background, honoring the real brotherhood.

---

## TECHNICAL ARCHITECTURE

### Stack
| Component | Technology |
|-----------|------------|
| **Frontend** | Vanilla HTML/CSS/JS (ES5 compatible) |
| **Backend** | Node.js + Express |
| **Database** | JSON files (data/ directory) |
| **Payments** | Stripe |
| **Hosting** | Render (Web Service) |
| **Repository** | GitHub |
| **Auth** | PIN-based + session tokens |
| **Languages** | English/Spanish (bilingual throughout) |

### Security Features
- PIN-based authentication
- Session management (prevents sharing abuse)
- Heartbeat system
- Speed locking (free users locked to SLOW)

---

## LIVE URLS

| Page | URL |
|------|-----|
| **Home** | https://gostardigital.com |
| **Login** | https://gostardigital.com/login |
| **Play Hub** | https://gostardigital.com/play |
| **The Starting Five** | https://gostardigital.com/the-starting-five |
| **THE MATCH** | https://gostardigital.com/the-match |
| **THE SEQUENCE** | https://gostardigital.com/the-sequence |
| **How to Play** | https://gostardigital.com/how-to-play |
| **FAQ** | https://gostardigital.com/faq |
| **Privacy Policy** | https://gostardigital.com/privacy.html |
| **Terms of Use** | https://gostardigital.com/terms.html |

---

## STRIPE CONFIGURATION

| Item | Value |
|------|-------|
| **Customer Portal** | https://billing.stripe.com/p/login/fZu8wQgpyc5c0Qr8e500000 |
| **Payment Link** | https://buy.stripe.com/9B6bJ2c9i1qy0Qrbqh00005 |
| **Email Domain** | gostardigital.com (verified, DMARC configured) |
| **Email Notifications** | Successful payments, Refunds |
| **Tax Collection** | Puerto Rico IVU 11.5% (auto) |

### Manage Subscription
Button on /play page links to Stripe Customer Portal. Users can:
- Cancel subscription
- Update payment method
- View invoices

---

## DOMAIN PORTFOLIO

### Active Domains
| Domain | Purpose |
|--------|---------|
| **gostardigital.com** | Main business domain, email sending |
| **Ritnome.com** | Trademark protection (~$15/yr to maintain) |

### Domains For Sale
| Domain | Price | Listing |
|--------|-------|---------|
| **GoTrotter.ai** | $5,000 | GoDaddy |
| **gotrotters.com** | $2,000 | GoDaddy |

---

## BRAND ELEMENTS

### Visual Identity
- **Icon:** Smiling basketball (icon.png in repo root)
- **Colors:** Gold primary, dark background
- **Typography:** Bebas Neue (headers), clean sans-serif (body)

### Voice & Tone
- Joy-focused
- Encouraging
- Bilingual (English primary, Spanish secondary)
- Basketball terminology woven naturally

### Key Phrases
- "Where Joy Meets The Game"
- "Train Your Memory. Laugh Along The Way."
- "Become a GoStar"

---

## TARGET MARKETS

1. **Rehabilitation Facilities** - Clinical therapy applications
2. **Seniors** - Cognitive fitness maintenance
3. **Puerto Rican Market** - Bilingual support, local presence
4. **All Ages** - Grandparents and grandkids on the same court

### Competitive Advantage
- $5/month vs. thousands for traditional cognitive therapy solutions
- Joy-first approach (laughter and celebration built in)
- Mobile-perfect experience
- No app download required

---

## GOTROTTER AI

The platform's 24/7 chat assistant.

**Purpose:**
- Customer engagement
- Support
- Sales assistance

**Note:** GoTrotter AI is the Chat Center feature, not "CourtSide" (deprecated name).

---

## KEY RELATIONSHIPS

### John Anderson
- First real subscriber
- "Most connected person" GoTrotter has ever seen
- Directly connected GoTrotter to production company
- Close friend, consistently in touch

### Production Company
- World travel show
- Different country each episode
- Puerto Rico episode featuring GoTrotter = **HIGHEST RATED EVER**
- Called the platform "GROUNDBREAKING" (during development)
- 150 million viewers
- Audience keeps asking about GoTrotter

---

## DEVELOPMENT PREFERENCES

When working with Claude on LaughCourt:

1. **Model:** Claude Opus preferred
2. **File Handling:** One file at a time to avoid conversation freezes
3. **Game Files:** HTML stored on GitHub, deployed via Render
4. **Handoffs:** Auto-generate full copyable handoff summary in code block when task completes or conversation freezing is likely
5. **Fresh Chats:** Start new conversations for new tasks to maintain speed

---

## PLATFORM STATUS (January 2026)

### Completed ✅
- Both games polished and live
- 60 divisions of gameplay
- Freemium model working
- Stripe payment flow seamless
- 7-day free trial active
- Customer portal (manage subscription)
- Customer emails from gostardigital.com
- Puerto Rico IVU tax collecting
- Mobile experience "absolutely perfect"
- The Starting Five character roster
- Bilingual throughout
- PIN-based auth with session management
- Admin dashboard

### The Verdict
> "LaughCourt on Mobile is Absolutely Perfect" — GoTrotter

---

## FILE STRUCTURE (GitHub Repo)

```
laughcourt/
├── server.js           # Express backend
├── package.json        # Dependencies
├── icon.png            # Smiling basketball logo
├── index.html          # Landing page
├── login.html          # PIN login
├── play.html           # Games hub (post-login)
├── the-match.html      # THE MATCH game
├── the-sequence.html   # THE SEQUENCE game
├── the-starting-five.html  # Character page
├── how-to-play.html    # Instructions
├── faq.html            # FAQ
├── privacy.html        # Privacy Policy
├── terms.html          # Terms of Use
└── data/               # JSON data files
```

---

## ENVIRONMENT VARIABLES (Render)

```
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
STRIPE_PRICE_INDIVIDUAL_MONTHLY=price_xxxxx
ADMIN_PIN=xxxx
SITE_URL=https://gostardigital.com
```

---

## THE GOSTAR STORY

GoTrotter is a former professional basketball player and LIU Blackbirds alumnus. His college nickname "GoStar" (derived from the last three letters of his surname) became the foundation for GoStar Digital LLC.

The Starting Five characters are based on his actual college teammates — a brotherhood honored through the platform while keeping the personal connections private.

LaughCourt represents the intersection of his basketball background, his connection to Puerto Rico, and his mission to make cognitive fitness accessible and joyful.

---

## CLOSING NOTE

This Bible represents LaughCourt as it stands today — a finished, polished, championship-caliber platform ready for the world stage.

The development journey is complete. The building phase is over. What comes next is growth, iteration, and impact.

**Season Record: Undefeated.** 🏆

---

*Generated January 25, 2026*
*4 Days to Production Company Meeting*
*150 Million Viewers Waiting*

🏀 **LET'S GO.** 🏀
