# GoStar Digital

Protected cognitive training platform with authentication.

## Features

- 🔐 Session-based authentication
- 🧠 Sequence Memory game (protected)
- ⭐ Beautiful dark theme with GoStar branding
- 📱 Responsive design
- 🚀 Render-ready deployment

## Quick Start

```bash
# Install dependencies
npm install

# Run locally
npm start

# Visit http://localhost:3000
```

## Default Credentials

| Username | Password    | Role  |
|----------|-------------|-------|
| admin    | gostar2025  | Admin |
| demo     | demo123     | User  |

## Deploy to Render

### Option 1: From GitHub

1. Push this code to a GitHub repository
2. Go to [render.com](https://render.com) and create new **Web Service**
3. Connect your GitHub repo
4. Configure:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
5. Add Environment Variables:
   - `SESSION_SECRET` = (generate a random string)
   - `ADMIN_PASSWORD` = (your secure password)
   - `NODE_ENV` = `production`

### Option 2: Manual Deploy

1. Create new **Web Service** on Render
2. Select "Deploy from a Git repository"
3. Configure same settings as above

## Environment Variables

| Variable        | Description                    | Required |
|-----------------|--------------------------------|----------|
| PORT            | Server port (default: 3000)    | No       |
| SESSION_SECRET  | Secret for session encryption  | Yes      |
| ADMIN_PASSWORD  | Admin user password            | No       |
| DEMO_PASSWORD   | Demo user password             | No       |
| NODE_ENV        | Environment (production/dev)   | No       |

## Domain Setup

After deploying to Render:

1. Go to your service's **Settings** tab
2. Scroll to **Custom Domains**
3. Add your domains:
   - `gostardigital.com`
   - `gostar.digital`
4. Configure DNS at your registrar:
   - Add CNAME record pointing to your Render URL

## File Structure

```
gostar-digital/
├── server.js           # Express server with auth
├── package.json        # Dependencies
├── .env.example        # Environment template
├── views/
│   ├── login.html      # Login page
│   ├── dashboard.html  # Game selection
│   └── sequence-memory.html  # Protected game
└── public/             # Static assets
```

## Adding More Games

1. Create new HTML file in `views/` folder
2. Add route in `server.js`:
   ```javascript
   app.get('/game/your-game', requireAuth, (req, res) => {
       res.sendFile(path.join(__dirname, 'views', 'your-game.html'));
   });
   ```
3. Add card to `dashboard.html`

## License

© 2025 GoStar Digital - All Rights Reserved
