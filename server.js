const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;

// Admin credentials
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'GoStar2025';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Data file paths
const DATA_DIR = path.join(__dirname, 'data');
const LICENSES_FILE = path.join(DATA_DIR, 'licenses.json');
const CODES_FILE = path.join(DATA_DIR, 'codes.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');

// Ensure data directory and files exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(LICENSES_FILE)) fs.writeFileSync(LICENSES_FILE, '[]');
if (!fs.existsSync(CODES_FILE)) fs.writeFileSync(CODES_FILE, '[]');
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');

// Helper functions
function readJSON(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        return [];
    }
}

function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function generateKey(prefix, length = 8) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let key = prefix + '-';
    for (let i = 0; i < length; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
}

// Basic Auth for Admin
function adminAuth(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin Dashboard"');
        return res.status(401).send('Admin authentication required');
    }
    const credentials = Buffer.from(auth.split(' ')[1], 'base64').toString();
    const [user, pass] = credentials.split(':');
    if (user === ADMIN_USER && pass === ADMIN_PASS) {
        return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Dashboard"');
    res.status(401).send('Invalid admin credentials');
}

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy' });
});

// Landing page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============ ADMIN ROUTES ============

app.get('/admin', adminAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Get all licenses
app.get('/api/admin/licenses', adminAuth, (req, res) => {
    const licenses = readJSON(LICENSES_FILE);
    const codes = readJSON(CODES_FILE);
    
    // Add used count to each license
    const enriched = licenses.map(lic => {
        const licCodes = codes.filter(c => c.licenseKey === lic.key);
        const usedPool = licCodes.reduce((sum, c) => sum + c.userLimit, 0);
        return { ...lic, usedPool, remainingPool: lic.userPool - usedPool };
    });
    
    res.json(enriched);
});

// Create license
app.post('/api/admin/licenses', adminAuth, (req, res) => {
    const { facilityName, expirationDate, userPool } = req.body;
    
    if (!facilityName || !expirationDate || !userPool) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const licenses = readJSON(LICENSES_FILE);
    const newLicense = {
        key: generateKey('LIC'),
        facilityName,
        expirationDate,
        userPool: parseInt(userPool),
        createdAt: new Date().toISOString(),
        active: true
    };
    
    licenses.push(newLicense);
    writeJSON(LICENSES_FILE, licenses);
    
    res.json(newLicense);
});

// Update license
app.put('/api/admin/licenses/:key', adminAuth, (req, res) => {
    const { key } = req.params;
    const { facilityName, expirationDate, userPool, active } = req.body;
    
    const licenses = readJSON(LICENSES_FILE);
    const index = licenses.findIndex(l => l.key === key);
    
    if (index === -1) {
        return res.status(404).json({ error: 'License not found' });
    }
    
    if (facilityName) licenses[index].facilityName = facilityName;
    if (expirationDate) licenses[index].expirationDate = expirationDate;
    if (userPool) licenses[index].userPool = parseInt(userPool);
    if (typeof active === 'boolean') licenses[index].active = active;
    
    writeJSON(LICENSES_FILE, licenses);
    res.json(licenses[index]);
});

// Delete license
app.delete('/api/admin/licenses/:key', adminAuth, (req, res) => {
    const { key } = req.params;
    let licenses = readJSON(LICENSES_FILE);
    licenses = licenses.filter(l => l.key !== key);
    writeJSON(LICENSES_FILE, licenses);
    
    // Also delete associated codes and users
    let codes = readJSON(CODES_FILE);
    const codesToDelete = codes.filter(c => c.licenseKey === key).map(c => c.code);
    codes = codes.filter(c => c.licenseKey !== key);
    writeJSON(CODES_FILE, codes);
    
    let users = readJSON(USERS_FILE);
    users = users.filter(u => !codesToDelete.includes(u.code));
    writeJSON(USERS_FILE, users);
    
    res.json({ success: true });
});

// ============ FACILITY ROUTES ============

// Facility login page
app.get('/facility', (req, res) => {
    res.sendFile(path.join(__dirname, 'facility-login.html'));
});

// Facility dashboard
app.get('/facility/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'facility.html'));
});

// Verify license and get facility data
app.post('/api/facility/login', (req, res) => {
    const { licenseKey } = req.body;
    const licenses = readJSON(LICENSES_FILE);
    const license = licenses.find(l => l.key === licenseKey && l.active);
    
    if (!license) {
        return res.status(401).json({ error: 'Invalid license key' });
    }
    
    if (new Date(license.expirationDate) < new Date()) {
        return res.status(401).json({ error: 'License expired' });
    }
    
    res.json({ success: true, facilityName: license.facilityName });
});

// Get facility info and codes
app.get('/api/facility/:licenseKey', (req, res) => {
    const { licenseKey } = req.params;
    const licenses = readJSON(LICENSES_FILE);
    const license = licenses.find(l => l.key === licenseKey && l.active);
    
    if (!license) {
        return res.status(401).json({ error: 'Invalid license key' });
    }
    
    if (new Date(license.expirationDate) < new Date()) {
        return res.status(401).json({ error: 'License expired' });
    }
    
    const codes = readJSON(CODES_FILE).filter(c => c.licenseKey === licenseKey);
    const users = readJSON(USERS_FILE);
    
    // Add used count to each code
    const enrichedCodes = codes.map(code => {
        const usedCount = users.filter(u => u.code === code.code).length;
        return { ...code, usedCount, remainingUsers: code.userLimit - usedCount };
    });
    
    const usedPool = codes.reduce((sum, c) => sum + c.userLimit, 0);
    
    res.json({
        facilityName: license.facilityName,
        expirationDate: license.expirationDate,
        userPool: license.userPool,
        usedPool,
        remainingPool: license.userPool - usedPool,
        codes: enrichedCodes
    });
});

// Create access code
app.post('/api/facility/:licenseKey/codes', (req, res) => {
    const { licenseKey } = req.params;
    const { userLimit, label } = req.body;
    
    const licenses = readJSON(LICENSES_FILE);
    const license = licenses.find(l => l.key === licenseKey && l.active);
    
    if (!license) {
        return res.status(401).json({ error: 'Invalid license key' });
    }
    
    if (new Date(license.expirationDate) < new Date()) {
        return res.status(401).json({ error: 'License expired' });
    }
    
    const codes = readJSON(CODES_FILE);
    const usedPool = codes.filter(c => c.licenseKey === licenseKey)
        .reduce((sum, c) => sum + c.userLimit, 0);
    const remainingPool = license.userPool - usedPool;
    
    if (parseInt(userLimit) > remainingPool) {
        return res.status(400).json({ error: `Only ${remainingPool} users remaining in pool` });
    }
    
    const newCode = {
        code: generateKey('ACC', 6),
        licenseKey,
        userLimit: parseInt(userLimit),
        label: label || '',
        createdAt: new Date().toISOString(),
        active: true
    };
    
    codes.push(newCode);
    writeJSON(CODES_FILE, codes);
    
    res.json(newCode);
});

// Delete access code
app.delete('/api/facility/:licenseKey/codes/:code', (req, res) => {
    const { licenseKey, code } = req.params;
    
    let codes = readJSON(CODES_FILE);
    const codeObj = codes.find(c => c.code === code && c.licenseKey === licenseKey);
    
    if (!codeObj) {
        return res.status(404).json({ error: 'Code not found' });
    }
    
    codes = codes.filter(c => c.code !== code);
    writeJSON(CODES_FILE, codes);
    
    // Remove associated users
    let users = readJSON(USERS_FILE);
    users = users.filter(u => u.code !== code);
    writeJSON(USERS_FILE, users);
    
    res.json({ success: true });
});

// ============ PLAY ROUTES ============

app.get('/play', (req, res) => {
    res.sendFile(path.join(__dirname, 'play.html'));
});

app.get('/game', (req, res) => {
    res.sendFile(path.join(__dirname, 'game.html'));
});

// Verify access code
app.post('/api/play/verify', (req, res) => {
    const { accessCode, visitorId } = req.body;
    
    const codes = readJSON(CODES_FILE);
    const code = codes.find(c => c.code === accessCode && c.active);
    
    if (!code) {
        return res.status(401).json({ error: 'Invalid access code' });
    }
    
    // Check license
    const licenses = readJSON(LICENSES_FILE);
    const license = licenses.find(l => l.key === code.licenseKey && l.active);
    
    if (!license) {
        return res.status(401).json({ error: 'License not found' });
    }
    
    if (new Date(license.expirationDate) < new Date()) {
        return res.status(401).json({ error: 'Access expired' });
    }
    
    // Check users
    const users = readJSON(USERS_FILE);
    const existingUser = users.find(u => u.code === accessCode && u.visitorId === visitorId);
    
    if (existingUser) {
        // Returning user - allow access
        return res.json({ success: true, facilityName: license.facilityName });
    }
    
    // New user - check limit
    const usedCount = users.filter(u => u.code === accessCode).length;
    
    if (usedCount >= code.userLimit) {
        return res.status(401).json({ error: 'User limit reached for this code' });
    }
    
    // Register new user
    users.push({
        code: accessCode,
        visitorId,
        createdAt: new Date().toISOString()
    });
    writeJSON(USERS_FILE, users);
    
    res.json({ success: true, facilityName: license.facilityName });
});

app.listen(PORT, () => {
    console.log(`GoStar Digital running on port ${PORT}`);
});
