require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'gostar-digital-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));

// In-memory users (replace with database in production)
// Default credentials: admin / gostar2025
const users = [
    {
        id: 1,
        username: 'admin',
        password: bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'gostar2025', 10),
        role: 'admin'
    },
    {
        id: 2,
        username: 'demo',
        password: bcrypt.hashSync(process.env.DEMO_PASSWORD || 'demo123', 10),
        role: 'user'
    }
];

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (req.session && req.session.userId) {
        return next();
    }
    res.redirect('/login');
};

// Routes
app.get('/', (req, res) => {
    if (req.session && req.session.userId) {
        res.redirect('/dashboard');
    } else {
        res.redirect('/login');
    }
});

app.get('/login', (req, res) => {
    if (req.session && req.session.userId) {
        return res.redirect('/dashboard');
    }
    res.sendFile(path.join(__dirname, 'views', 'login.html'));
});

app.post('/login', async (req, res) => {
    const { username, password } = req.body;
    
    const user = users.find(u => u.username === username);
    
    if (user && bcrypt.compareSync(password, user.password)) {
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.role = user.role;
        res.json({ success: true, redirect: '/dashboard' });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        res.redirect('/login');
    });
});

app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

app.get('/game/sequence-memory', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'sequence-memory.html'));
});

// API endpoint to get current user
app.get('/api/user', requireAuth, (req, res) => {
    res.json({
        username: req.session.username,
        role: req.session.role
    });
});

// Health check for deployment
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
    console.log(`🚀 GoStar Digital running on port ${PORT}`);
    console.log(`📍 http://localhost:${PORT}`);
});
