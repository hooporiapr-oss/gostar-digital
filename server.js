const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Credentials from environment variables
const USERNAME = process.env.AUTH_USER || 'admin';
const PASSWORD = process.env.AUTH_PASS || 'GoStar2025';

// Basic Auth middleware
function basicAuth(req, res, next) {
    const auth = req.headers.authorization;
    
    if (!auth || !auth.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="GoStar Digital"');
        return res.status(401).send('Authentication required');
    }
    
    const credentials = Buffer.from(auth.split(' ')[1], 'base64').toString();
    const [user, pass] = credentials.split(':');
    
    if (user === USERNAME && pass === PASSWORD) {
        return next();
    }
    
    res.setHeader('WWW-Authenticate', 'Basic realm="GoStar Digital"');
    res.status(401).send('Invalid credentials');
}

// Health check (unprotected for Render)
app.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
});

// Protect all other routes
app.use(basicAuth);

// Serve static files
app.use(express.static(__dirname));

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/sequence-memory', (req, res) => {
    res.sendFile(path.join(__dirname, 'sequence-memory.html'));
});

app.listen(PORT, () => {
    console.log(`GoStar Digital running on port ${PORT}`);
});
