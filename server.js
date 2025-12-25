const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

// Admin credentials (legacy Basic Auth)
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'GoStar2025';

// Admin PIN (new dashboard auth)
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

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
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var key = prefix + '-';
    for (var i = 0; i < length; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
}

function generateToken() {
    return Buffer.from(Date.now() + '-' + Math.random().toString(36).substring(2, 15)).toString('base64');
}

// Basic Auth for Admin (legacy)
function adminAuth(req, res, next) {
    var auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin Dashboard"');
        return res.status(401).send('Admin authentication required');
    }
    var credentials = Buffer.from(auth.split(' ')[1], 'base64').toString();
    var parts = credentials.split(':');
    var user = parts[0];
    var pass = parts.slice(1).join(':');
    if (user === ADMIN_USER && pass === ADMIN_PASS) {
        return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Dashboard"');
    res.status(401).send('Invalid admin credentials');
}

// Store active admin tokens (in production, use Redis or database)
var adminTokens = new Set();

// Health check
app.get('/health', function(req, res) {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Landing page
app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============ ADMIN PIN AUTH (NEW DASHBOARD) ============

// Verify admin PIN
app.post('/api/admin/verify', function(req, res) {
    var pin = req.body.pin;
    
    if (!ADMIN_PIN) {
        console.error('ADMIN_PIN environment variable not set!');
        return res.status(500).json({ 
            success: false, 
            message: 'Server configuration error' 
        });
    }
    
    if (pin === ADMIN_PIN) {
        var token = generateToken();
        adminTokens.add(token);
        
        // Auto-expire token after 24 hours
        setTimeout(function() {
            adminTokens.delete(token);
        }, 24 * 60 * 60 * 1000);
        
        res.json({ 
            success: true, 
            token: token,
            message: 'Access granted'
        });
    } else {
        res.status(401).json({ 
            success: false, 
            message: 'Invalid PIN' 
        });
    }
});

// Verify admin token
app.post('/api/admin/verify-token', function(req, res) {
    var token = req.body.token;
    
    if (token && adminTokens.has(token)) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
});

// Admin logout (invalidate token)
app.post('/api/admin/logout', function(req, res) {
    var token = req.body.token;
    if (token) {
        adminTokens.delete(token);
    }
    res.json({ success: true });
});

// ============ ADMIN ROUTES ============

// New admin dashboard
app.get('/admin-dashboard', function(req, res) {
    res.sendFile(path.join(__dirname, 'admin-dashboard.html'));
});

// Legacy admin (Basic Auth)
app.get('/admin', adminAuth, function(req, res) {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Get all licenses
app.get('/api/admin/licenses', adminAuth, function(req, res) {
    var licenses = readJSON(LICENSES_FILE);
    var codes = readJSON(CODES_FILE);
    
    var enriched = licenses.map(function(lic) {
        var licCodes = codes.filter(function(c) { return c.licenseKey === lic.key; });
        var usedPool = licCodes.reduce(function(sum, c) { return sum + c.userLimit; }, 0);
        var result = {};
        for (var key in lic) {
            result[key] = lic[key];
        }
        result.usedPool = usedPool;
        result.remainingPool = lic.userPool - usedPool;
        return result;
    });
    
    res.json(enriched);
});

// Create license
app.post('/api/admin/licenses', adminAuth, function(req, res) {
    var facilityName = req.body.facilityName;
    var expirationDate = req.body.expirationDate;
    var userPool = req.body.userPool;
    var isTrial = req.body.isTrial;
    var contactName = req.body.contactName;
    var email = req.body.email;
    var phone = req.body.phone;
    
    if (!facilityName || !expirationDate || !userPool) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    var licenses = readJSON(LICENSES_FILE);
    var newLicense = {
        key: generateKey('LIC'),
        facilityName: facilityName,
        expirationDate: expirationDate,
        userPool: parseInt(userPool),
        createdAt: new Date().toISOString(),
        active: true
    };
    
    // Add trial-specific fields if it's a trial
    if (isTrial) {
        newLicense.isTrial = true;
        newLicense.contactName = contactName || '';
        newLicense.email = email || '';
        newLicense.phone = phone || '';
    }
    
    licenses.push(newLicense);
    writeJSON(LICENSES_FILE, licenses);
    
    res.json(newLicense);
});

// Update license
app.put('/api/admin/licenses/:key', adminAuth, function(req, res) {
    var key = req.params.key;
    var facilityName = req.body.facilityName;
    var expirationDate = req.body.expirationDate;
    var userPool = req.body.userPool;
    var active = req.body.active;
    
    var licenses = readJSON(LICENSES_FILE);
    var index = -1;
    for (var i = 0; i < licenses.length; i++) {
        if (licenses[i].key === key) {
            index = i;
            break;
        }
    }
    
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
app.delete('/api/admin/licenses/:key', adminAuth, function(req, res) {
    var key = req.params.key;
    var licenses = readJSON(LICENSES_FILE);
    licenses = licenses.filter(function(l) { return l.key !== key; });
    writeJSON(LICENSES_FILE, licenses);
    
    var codes = readJSON(CODES_FILE);
    var codesToDelete = codes.filter(function(c) { return c.licenseKey === key; }).map(function(c) { return c.code; });
    codes = codes.filter(function(c) { return c.licenseKey !== key; });
    writeJSON(CODES_FILE, codes);
    
    var users = readJSON(USERS_FILE);
    users = users.filter(function(u) { return codesToDelete.indexOf(u.code) === -1; });
    writeJSON(USERS_FILE, users);
    
    res.json({ success: true });
});

// ============ FACILITY ROUTES ============

app.get('/facility', function(req, res) {
    res.sendFile(path.join(__dirname, 'facility-login.html'));
});

app.get('/facility/dashboard', function(req, res) {
    res.sendFile(path.join(__dirname, 'facility.html'));
});

app.post('/api/facility/login', function(req, res) {
    var licenseKey = req.body.licenseKey;
    var licenses = readJSON(LICENSES_FILE);
    var license = null;
    for (var i = 0; i < licenses.length; i++) {
        if (licenses[i].key === licenseKey && licenses[i].active) {
            license = licenses[i];
            break;
        }
    }
    
    if (!license) {
        return res.status(401).json({ error: 'Invalid license key' });
    }
    
    if (new Date(license.expirationDate) < new Date()) {
        return res.status(401).json({ error: 'License expired' });
    }
    
    res.json({ success: true, facilityName: license.facilityName });
});

app.get('/api/facility/:licenseKey', function(req, res) {
    var licenseKey = req.params.licenseKey;
    var licenses = readJSON(LICENSES_FILE);
    var license = null;
    for (var i = 0; i < licenses.length; i++) {
        if (licenses[i].key === licenseKey && licenses[i].active) {
            license = licenses[i];
            break;
        }
    }
    
    if (!license) {
        return res.status(401).json({ error: 'Invalid license key' });
    }
    
    if (new Date(license.expirationDate) < new Date()) {
        return res.status(401).json({ error: 'License expired' });
    }
    
    var allCodes = readJSON(CODES_FILE);
    var codes = allCodes.filter(function(c) { return c.licenseKey === licenseKey; });
    var users = readJSON(USERS_FILE);
    
    var enrichedCodes = codes.map(function(code) {
        var usedCount = users.filter(function(u) { return u.code === code.code; }).length;
        var result = {};
        for (var key in code) {
            result[key] = code[key];
        }
        result.usedCount = usedCount;
        result.remainingUsers = code.userLimit - usedCount;
        return result;
    });
    
    var usedPool = codes.reduce(function(sum, c) { return sum + c.userLimit; }, 0);
    
    res.json({
        facilityName: license.facilityName,
        expirationDate: license.expirationDate,
        userPool: license.userPool,
        usedPool: usedPool,
        remainingPool: license.userPool - usedPool,
        codes: enrichedCodes
    });
});

app.post('/api/facility/:licenseKey/codes', function(req, res) {
    var licenseKey = req.params.licenseKey;
    var userLimit = req.body.userLimit;
    var label = req.body.label;
    
    var licenses = readJSON(LICENSES_FILE);
    var license = null;
    for (var i = 0; i < licenses.length; i++) {
        if (licenses[i].key === licenseKey && licenses[i].active) {
            license = licenses[i];
            break;
        }
    }
    
    if (!license) {
        return res.status(401).json({ error: 'Invalid license key' });
    }
    
    if (new Date(license.expirationDate) < new Date()) {
        return res.status(401).json({ error: 'License expired' });
    }
    
    var codes = readJSON(CODES_FILE);
    var licenseCodes = codes.filter(function(c) { return c.licenseKey === licenseKey; });
    var usedPool = licenseCodes.reduce(function(sum, c) { return sum + c.userLimit; }, 0);
    var remainingPool = license.userPool - usedPool;
    
    if (parseInt(userLimit) > remainingPool) {
        return res.status(400).json({ error: 'Only ' + remainingPool + ' users remaining in pool' });
    }
    
    var newCode = {
        code: generateKey('ACC', 6),
        licenseKey: licenseKey,
        userLimit: parseInt(userLimit),
        label: label || '',
        createdAt: new Date().toISOString(),
        active: true
    };
    
    codes.push(newCode);
    writeJSON(CODES_FILE, codes);
    
    res.json(newCode);
});

app.delete('/api/facility/:licenseKey/codes/:code', function(req, res) {
    var licenseKey = req.params.licenseKey;
    var code = req.params.code;
    
    var codes = readJSON(CODES_FILE);
    var codeObj = null;
    for (var i = 0; i < codes.length; i++) {
        if (codes[i].code === code && codes[i].licenseKey === licenseKey) {
            codeObj = codes[i];
            break;
        }
    }
    
    if (!codeObj) {
        return res.status(404).json({ error: 'Code not found' });
    }
    
    codes = codes.filter(function(c) { return c.code !== code; });
    writeJSON(CODES_FILE, codes);
    
    var users = readJSON(USERS_FILE);
    users = users.filter(function(u) { return u.code !== code; });
    writeJSON(USERS_FILE, users);
    
    res.json({ success: true });
});

// ============ PLAY ROUTES ============

app.get('/play', function(req, res) {
    res.sendFile(path.join(__dirname, 'play.html'));
});

app.get('/game', function(req, res) {
    res.sendFile(path.join(__dirname, 'game.html'));
});

app.post('/api/play/verify', function(req, res) {
    var accessCode = req.body.accessCode;
    
    var codes = readJSON(CODES_FILE);
    var code = null;
    for (var i = 0; i < codes.length; i++) {
        if (codes[i].code === accessCode && codes[i].active) {
            code = codes[i];
            break;
        }
    }
    
    if (!code) {
        return res.status(401).json({ error: 'Invalid access code' });
    }
    
    var licenses = readJSON(LICENSES_FILE);
    var license = null;
    for (var j = 0; j < licenses.length; j++) {
        if (licenses[j].key === code.licenseKey && licenses[j].active) {
            license = licenses[j];
            break;
        }
    }
    
    if (!license) {
        return res.status(401).json({ error: 'License not found' });
    }
    
    if (new Date(license.expirationDate) < new Date()) {
        return res.status(401).json({ error: 'Access expired' });
    }
    
    var users = readJSON(USERS_FILE);
    var codeUsers = users.filter(function(u) { return u.code === accessCode; });
    var usedCount = codeUsers.length;
    var spotsLeft = code.userLimit - usedCount;
    
    res.json({ 
        success: true, 
        facilityName: license.facilityName,
        spotsLeft: spotsLeft,
        hasSpots: spotsLeft > 0
    });
});

app.post('/api/play/register', function(req, res) {
    var accessCode = req.body.accessCode;
    var username = req.body.username;
    var password = req.body.password;
    
    if (!accessCode || !username || !password) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    var codes = readJSON(CODES_FILE);
    var code = null;
    for (var i = 0; i < codes.length; i++) {
        if (codes[i].code === accessCode && codes[i].active) {
            code = codes[i];
            break;
        }
    }
    
    if (!code) {
        return res.status(401).json({ error: 'Invalid access code' });
    }
    
    var licenses = readJSON(LICENSES_FILE);
    var license = null;
    for (var j = 0; j < licenses.length; j++) {
        if (licenses[j].key === code.licenseKey && licenses[j].active) {
            license = licenses[j];
            break;
        }
    }
    
    if (!license || new Date(license.expirationDate) < new Date()) {
        return res.status(401).json({ error: 'Access expired' });
    }
    
    var users = readJSON(USERS_FILE);
    
    var existingUser = null;
    for (var k = 0; k < users.length; k++) {
        if (users[k].code === accessCode && users[k].username.toLowerCase() === username.toLowerCase()) {
            existingUser = users[k];
            break;
        }
    }
    if (existingUser) {
        return res.status(400).json({ error: 'Username already taken' });
    }
    
    var usedCount = users.filter(function(u) { return u.code === accessCode; }).length;
    if (usedCount >= code.userLimit) {
        return res.status(400).json({ error: 'User limit reached for this code' });
    }
    
    var hashedPassword = bcrypt.hashSync(password, 10);
    
    users.push({
        code: accessCode,
        username: username,
        password: hashedPassword,
        createdAt: new Date().toISOString()
    });
    writeJSON(USERS_FILE, users);
    
    res.json({ success: true, username: username });
});

app.post('/api/play/login', function(req, res) {
    var accessCode = req.body.accessCode;
    var username = req.body.username;
    var password = req.body.password;
    
    if (!accessCode || !username || !password) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    var codes = readJSON(CODES_FILE);
    var code = null;
    for (var i = 0; i < codes.length; i++) {
        if (codes[i].code === accessCode && codes[i].active) {
            code = codes[i];
            break;
        }
    }
    
    if (!code) {
        return res.status(401).json({ error: 'Invalid access code' });
    }
    
    var licenses = readJSON(LICENSES_FILE);
    var license = null;
    for (var j = 0; j < licenses.length; j++) {
        if (licenses[j].key === code.licenseKey && licenses[j].active) {
            license = licenses[j];
            break;
        }
    }
    
    if (!license || new Date(license.expirationDate) < new Date()) {
        return res.status(401).json({ error: 'Access expired' });
    }
    
    var users = readJSON(USERS_FILE);
    var user = null;
    for (var k = 0; k < users.length; k++) {
        if (users[k].code === accessCode && users[k].username.toLowerCase() === username.toLowerCase()) {
            user = users[k];
            break;
        }
    }
    
    if (!user) {
        return res.status(401).json({ error: 'User not found' });
    }
    
    if (!bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'Invalid password' });
    }
    
    res.json({ success: true, username: user.username });
});

// ============ TRIAL ROUTES ============

app.get('/trial', function(req, res) {
    res.sendFile(path.join(__dirname, 'trial.html'));
});

app.post('/api/trial/register', function(req, res) {
    var facilityName = req.body.facilityName;
    var contactName = req.body.contactName;
    var email = req.body.email;
    var phone = req.body.phone;
    
    if (!facilityName || !contactName || !email) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    var licenses = readJSON(LICENSES_FILE);
    
    // Check if email already used for trial
    var existingTrial = null;
    for (var i = 0; i < licenses.length; i++) {
        if (licenses[i].email === email && licenses[i].isTrial) {
            existingTrial = licenses[i];
            break;
        }
    }
    if (existingTrial) {
        return res.status(400).json({ error: 'Email already used for a free trial' });
    }
    
    // Generate license key
    var licenseKey = generateKey('LIC');
    
    // Set expiration to 7 days from now
    var expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + 7);
    
    var newLicense = {
        key: licenseKey,
        facilityName: facilityName,
        contactName: contactName,
        email: email,
        phone: phone || '',
        expirationDate: expirationDate.toISOString().split('T')[0],
        userPool: 10,
        createdAt: new Date().toISOString(),
        active: true,
        isTrial: true
    };
    
    licenses.push(newLicense);
    writeJSON(LICENSES_FILE, licenses);
    
    res.json({ 
        success: true, 
        licenseKey: licenseKey,
        expirationDate: newLicense.expirationDate
    });
});

// ============ START SERVER ============

app.listen(PORT, function() {
    console.log('GoStar Digital running on port ' + PORT);
    console.log('Admin Dashboard: /admin-dashboard');
    console.log('Legacy Admin: /admin');
});
