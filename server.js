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
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');

// Ensure data directory and files exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(LICENSES_FILE)) fs.writeFileSync(LICENSES_FILE, '[]');
if (!fs.existsSync(CODES_FILE)) fs.writeFileSync(CODES_FILE, '[]');
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(ACTIVITY_FILE)) fs.writeFileSync(ACTIVITY_FILE, '[]');

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

// Activity logging
function logActivity(type, username, facility, details) {
    var activities = readJSON(ACTIVITY_FILE);
    activities.unshift({
        timestamp: new Date().toISOString(),
        type: type,
        username: username || null,
        facility: facility || null,
        details: details || null
    });
    // Keep only last 500 activities
    if (activities.length > 500) {
        activities = activities.slice(0, 500);
    }
    writeJSON(ACTIVITY_FILE, activities);
}

function generateKey(prefix, length = 8) {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var key = prefix + '-';
    for (var i = 0; i < length; i++) {
        key += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return key;
}

// Generate unique 4-digit PIN for facility license
function generateLicensePin() {
    var licenses = readJSON(LICENSES_FILE);
    var existingPins = licenses.map(function(l) { return l.key; });
    
    var pin;
    var attempts = 0;
    do {
        // Generate 4-digit PIN (1000-9999 to avoid leading zeros)
        pin = String(1000 + Math.floor(Math.random() * 9000));
        attempts++;
    } while (existingPins.indexOf(pin) !== -1 && attempts < 100);
    
    return pin;
}

// Generate unique 4-digit PIN for user login
function generateUserPin() {
    var users = readJSON(USERS_FILE);
    var existingPins = users.map(function(u) { return u.pin; }).filter(function(p) { return p; });
    
    var pin;
    var attempts = 0;
    do {
        pin = String(1000 + Math.floor(Math.random() * 9000));
        attempts++;
    } while (existingPins.indexOf(pin) !== -1 && attempts < 100);
    
    return pin;
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

// Admin token auth middleware
function adminTokenAuth(req, res, next) {
    var authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'No token provided' });
    }
    var token = authHeader.split(' ')[1];
    if (adminTokens.has(token)) {
        return next();
    }
    res.status(401).json({ success: false, message: 'Invalid or expired token' });
}

// ============ ADMIN DASHBOARD API ============

// Get all facilities (from licenses)
app.get('/api/admin/facilities', adminTokenAuth, function(req, res) {
    try {
        var licenses = readJSON(LICENSES_FILE);
        var codes = readJSON(CODES_FILE);
        var users = readJSON(USERS_FILE);
        
        var facilities = licenses.map(function(lic) {
            // Count users for this facility
            var facilityCodes = codes.filter(function(c) { return c.licenseKey === lic.key; });
            var facilityCodeIds = facilityCodes.map(function(c) { return c.code; });
            var facilityUsers = users.filter(function(u) { return facilityCodeIds.indexOf(u.code) !== -1; });
            
            // Calculate total sessions for this facility
            var totalSessions = facilityUsers.reduce(function(sum, u) {
                return sum + (u.sessions_sequence || 0) + (u.sessions_startrail || 0) + (u.sessions_duo || 0);
            }, 0);
            
            // Calculate days left
            var today = new Date();
            var expiry = new Date(lic.expirationDate);
            var daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
            
            return {
                id: lic.key,
                name: lic.facilityName,
                location: lic.location || 'N/A',
                license_key: lic.key,
                license_type: lic.isTrial ? 'trial' : 'standard',
                user_count: facilityUsers.length,
                user_limit: lic.userPool,
                total_sessions: totalSessions,
                status: lic.active ? (daysLeft > 0 ? 'active' : 'expired') : 'inactive',
                created_at: lic.createdAt,
                expires_at: lic.expirationDate,
                days_left: Math.max(0, daysLeft),
                contact_name: lic.contactName || '',
                email: lic.email || '',
                phone: lic.phone || ''
            };
        });
        
        res.json({ success: true, facilities: facilities });
    } catch (err) {
        console.error('Error fetching facilities:', err);
        res.json({ success: true, facilities: [] });
    }
});

// Update facility
app.put('/api/admin/facilities/:id', adminTokenAuth, function(req, res) {
    var id = req.params.id;
    var licenses = readJSON(LICENSES_FILE);
    
    var index = -1;
    for (var i = 0; i < licenses.length; i++) {
        if (licenses[i].key === id) {
            index = i;
            break;
        }
    }
    
    if (index === -1) {
        return res.status(404).json({ success: false, message: 'Facility not found' });
    }
    
    if (req.body.name) licenses[index].facilityName = req.body.name;
    if (req.body.location) licenses[index].location = req.body.location;
    if (req.body.expires_at) licenses[index].expirationDate = req.body.expires_at;
    if (typeof req.body.active === 'boolean') licenses[index].active = req.body.active;
    
    writeJSON(LICENSES_FILE, licenses);
    res.json({ success: true });
});

// Delete facility
app.delete('/api/admin/facilities/:id', adminTokenAuth, function(req, res) {
    var id = req.params.id;
    
    var licenses = readJSON(LICENSES_FILE);
    licenses = licenses.filter(function(l) { return l.key !== id; });
    writeJSON(LICENSES_FILE, licenses);
    
    var codes = readJSON(CODES_FILE);
    var codesToDelete = codes.filter(function(c) { return c.licenseKey === id; }).map(function(c) { return c.code; });
    codes = codes.filter(function(c) { return c.licenseKey !== id; });
    writeJSON(CODES_FILE, codes);
    
    var users = readJSON(USERS_FILE);
    users = users.filter(function(u) { return codesToDelete.indexOf(u.code) === -1; });
    writeJSON(USERS_FILE, users);
    
    res.json({ success: true });
});

// Get all licenses
app.get('/api/admin/licenses-list', adminTokenAuth, function(req, res) {
    try {
        var licenses = readJSON(LICENSES_FILE);
        
        var result = licenses.map(function(lic) {
            var today = new Date();
            var expiry = new Date(lic.expirationDate);
            var daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
            
            return {
                key: lic.key,
                license_key: lic.key,
                license_type: lic.isTrial ? 'trial' : 'standard',
                facility_name: lic.facilityName,
                created_at: lic.createdAt,
                expires_at: lic.expirationDate,
                status: lic.active ? (daysLeft > 0 ? 'active' : 'expired') : 'inactive'
            };
        });
        
        res.json({ success: true, licenses: result });
    } catch (err) {
        console.error('Error fetching licenses:', err);
        res.json({ success: true, licenses: [] });
    }
});

// Delete license
app.delete('/api/admin/licenses-list/:key', adminTokenAuth, function(req, res) {
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

// Get all users with session data
app.get('/api/admin/users', adminTokenAuth, function(req, res) {
    try {
        var users = readJSON(USERS_FILE);
        var codes = readJSON(CODES_FILE);
        var licenses = readJSON(LICENSES_FILE);
        
        var result = users.map(function(u, index) {
            // Find facility name
            var facilityName = 'Unknown';
            for (var i = 0; i < codes.length; i++) {
                if (codes[i].code === u.code) {
                    for (var j = 0; j < licenses.length; j++) {
                        if (licenses[j].key === codes[i].licenseKey) {
                            facilityName = licenses[j].facilityName;
                            break;
                        }
                    }
                    break;
                }
            }
            
            return {
                id: index,
                username: u.username,
                pin: u.pin || null,
                facility_name: facilityName,
                sessions_sequence: u.sessions_sequence || 0,
                sessions_startrail: u.sessions_startrail || 0,
                sessions_duo: u.sessions_duo || 0,
                best_sequence: u.best_sequence || 0,
                best_startrail: u.best_startrail || 0,
                best_duo: u.best_duo || 0,
                streak: u.streak || 0,
                last_active: u.lastActive || u.createdAt,
                created_at: u.createdAt
            };
        });
        
        res.json({ success: true, users: result });
    } catch (err) {
        console.error('Error fetching users:', err);
        res.json({ success: true, users: [] });
    }
});

// Update user
app.put('/api/admin/users/:id', adminTokenAuth, function(req, res) {
    var id = parseInt(req.params.id);
    var users = readJSON(USERS_FILE);
    
    if (id < 0 || id >= users.length) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    if (req.body.username) users[id].username = req.body.username;
    if (typeof req.body.streak === 'number') users[id].streak = req.body.streak;
    
    writeJSON(USERS_FILE, users);
    res.json({ success: true });
});

// Delete user
app.delete('/api/admin/users/:id', adminTokenAuth, function(req, res) {
    var id = parseInt(req.params.id);
    var users = readJSON(USERS_FILE);
    
    if (id < 0 || id >= users.length) {
        return res.status(404).json({ success: false, message: 'User not found' });
    }
    
    users.splice(id, 1);
    writeJSON(USERS_FILE, users);
    res.json({ success: true });
});

// Get activity log
app.get('/api/admin/activity', adminTokenAuth, function(req, res) {
    try {
        var activities = readJSON(ACTIVITY_FILE);
        res.json({ success: true, activities: activities });
    } catch (err) {
        console.error('Error fetching activities:', err);
        res.json({ success: true, activities: [] });
    }
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

// Get all licenses (Basic Auth - for license creation)
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

// Create license (Basic Auth)
app.post('/api/admin/licenses', adminAuth, function(req, res) {
    var facilityName = req.body.facilityName;
    var expirationDate = req.body.expirationDate;
    var userPool = req.body.userPool;
    var isTrial = req.body.isTrial;
    var contactName = req.body.contactName;
    var email = req.body.email;
    var phone = req.body.phone;
    var location = req.body.location;
    
    if (!facilityName || !expirationDate || !userPool) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    var licenses = readJSON(LICENSES_FILE);
    var newLicense = {
        key: generateLicensePin(),
        facilityName: facilityName,
        expirationDate: expirationDate,
        userPool: parseInt(userPool),
        createdAt: new Date().toISOString(),
        active: true
    };
    
    if (location) newLicense.location = location;
    
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
    
    // Log activity
    logActivity('facility_login', null, license.facilityName, 'Facility dashboard accessed');
    
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
        var codeUsers = users.filter(function(u) { return u.code === code.code; });
        var usedCount = codeUsers.length;
        
        var totalSessions = codeUsers.reduce(function(sum, u) {
            return sum + (u.sessions_sequence || 0) + (u.sessions_startrail || 0) + (u.sessions_duo || 0);
        }, 0);
        
        var result = {};
        for (var key in code) {
            result[key] = code[key];
        }
        result.usedCount = usedCount;
        result.remainingUsers = code.userLimit - usedCount;
        result.totalSessions = totalSessions;
        return result;
    });
    
    var usedPool = codes.reduce(function(sum, c) { return sum + c.userLimit; }, 0);
    
    var facilityCodeIds = codes.map(function(c) { return c.code; });
    var facilityUsers = users.filter(function(u) { return facilityCodeIds.indexOf(u.code) !== -1; });
    var enrichedUsers = facilityUsers.map(function(u) {
        return {
            username: u.username,
            pin: u.pin || null,
            code: u.code,
            sessions_sequence: u.sessions_sequence || 0,
            sessions_startrail: u.sessions_startrail || 0,
            sessions_duo: u.sessions_duo || 0,
            best_sequence: u.best_sequence || 0,
            best_startrail: u.best_startrail || 0,
            best_duo: u.best_duo || 0,
            totalSessions: (u.sessions_sequence || 0) + (u.sessions_startrail || 0) + (u.sessions_duo || 0),
            streak: u.streak || 0,
            lastActive: u.lastActive || u.createdAt,
            createdAt: u.createdAt
        };
    });
    
    res.json({
        facilityName: license.facilityName,
        expirationDate: license.expirationDate,
        userPool: license.userPool,
        usedPool: usedPool,
        remainingPool: license.userPool - usedPool,
        codes: enrichedCodes,
        users: enrichedUsers
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
    
    if (!accessCode || !username) {
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
    
    var usedCount = users.filter(function(u) { return u.code === accessCode; }).length;
    if (usedCount >= code.userLimit) {
        return res.status(400).json({ error: 'User limit reached for this code' });
    }
    
    // Generate unique PIN for this user
    var userPin = generateUserPin();
    
    users.push({
        code: accessCode,
        username: username.trim(),
        pin: userPin,
        createdAt: new Date().toISOString(),
        sessions_sequence: 0,
        sessions_startrail: 0,
        sessions_duo: 0,
        streak: 0
    });
    writeJSON(USERS_FILE, users);
    
    // Log activity
    logActivity('user_register', username, license.facilityName, 'New user registered with PIN');
    
    res.json({ success: true, username: username.trim(), pin: userPin });
});

// Login with PIN only
app.post('/api/play/login', function(req, res) {
    var pin = req.body.pin;
    
    if (!pin) {
        return res.status(400).json({ error: 'PIN is required' });
    }
    
    var users = readJSON(USERS_FILE);
    var user = null;
    for (var i = 0; i < users.length; i++) {
        if (users[i].pin === pin) {
            user = users[i];
            break;
        }
    }
    
    if (!user) {
        return res.status(401).json({ error: 'Invalid PIN' });
    }
    
    // Get facility name for logging
    var codes = readJSON(CODES_FILE);
    var code = null;
    for (var j = 0; j < codes.length; j++) {
        if (codes[j].code === user.code) {
            code = codes[j];
            break;
        }
    }
    
    var facilityName = 'Unknown';
    if (code) {
        var licenses = readJSON(LICENSES_FILE);
        for (var k = 0; k < licenses.length; k++) {
            if (licenses[k].key === code.licenseKey) {
                facilityName = licenses[k].facilityName;
                break;
            }
        }
    }
    
    // Log activity
    logActivity('user_login', user.username, facilityName, 'User logged in with PIN');
    
    res.json({ success: true, username: user.username, pin: user.pin, accessCode: user.code });
});

// ============ GAME SESSION TRACKING ============

app.post('/api/game/session', function(req, res) {
    var pin = req.body.pin;
    var accessCode = req.body.accessCode;
    var username = req.body.username;
    var game = req.body.game;
    var score = req.body.score;
    
    if (!game) {
        return res.status(400).json({ error: 'Missing game type' });
    }
    
    var validGames = ['sequence', 'startrail', 'duo'];
    if (validGames.indexOf(game) === -1) {
        return res.status(400).json({ error: 'Invalid game type' });
    }
    
    var users = readJSON(USERS_FILE);
    var userIndex = -1;
    
    // Try PIN first, then accessCode+username
    if (pin) {
        for (var i = 0; i < users.length; i++) {
            if (users[i].pin === pin) {
                userIndex = i;
                break;
            }
        }
    } else if (accessCode && username) {
        for (var j = 0; j < users.length; j++) {
            if (users[j].code === accessCode && users[j].username.toLowerCase() === username.toLowerCase()) {
                userIndex = j;
                break;
            }
        }
    }
    
    if (userIndex === -1) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    var user = users[userIndex];
    var sessionKey = 'sessions_' + game;
    if (!users[userIndex][sessionKey]) {
        users[userIndex][sessionKey] = 0;
    }
    users[userIndex][sessionKey]++;
    
    users[userIndex].lastActive = new Date().toISOString();
    
    var today = new Date().toISOString().split('T')[0];
    var lastStreakDate = users[userIndex].lastStreakDate;
    
    if (!lastStreakDate) {
        users[userIndex].streak = 1;
        users[userIndex].lastStreakDate = today;
    } else if (lastStreakDate !== today) {
        var lastDate = new Date(lastStreakDate);
        var todayDate = new Date(today);
        var diffDays = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));
        
        if (diffDays === 1) {
            users[userIndex].streak = (users[userIndex].streak || 0) + 1;
        } else if (diffDays > 1) {
            users[userIndex].streak = 1;
        }
        users[userIndex].lastStreakDate = today;
    }
    
    if (score !== undefined) {
        var bestKey = 'best_' + game;
        if (!users[userIndex][bestKey] || score > users[userIndex][bestKey]) {
            users[userIndex][bestKey] = score;
        }
    }
    
    writeJSON(USERS_FILE, users);
    
    // Log activity - find facility name
    var codes = readJSON(CODES_FILE);
    var licenses = readJSON(LICENSES_FILE);
    var facilityName = 'Unknown';
    for (var c = 0; c < codes.length; c++) {
        if (codes[c].code === user.code) {
            for (var l = 0; l < licenses.length; l++) {
                if (licenses[l].key === codes[c].licenseKey) {
                    facilityName = licenses[l].facilityName;
                    break;
                }
            }
            break;
        }
    }
    
    var gameNames = { sequence: 'Sequence Memory', startrail: 'StarTrail', duo: 'Pattern Duo' };
    var gameName = gameNames[game] || game;
    var scoreText = score !== undefined ? ' (Score: ' + score + ')' : '';
    logActivity('game_session', user.username, facilityName, gameName + scoreText);
    
    res.json({ 
        success: true, 
        sessions: users[userIndex][sessionKey],
        streak: users[userIndex].streak,
        personalBest: users[userIndex]['best_' + game]
    });
});

// Get stats by PIN
app.get('/api/game/stats/pin/:pin', function(req, res) {
    var pin = req.params.pin;
    
    var users = readJSON(USERS_FILE);
    var user = null;
    for (var i = 0; i < users.length; i++) {
        if (users[i].pin === pin) {
            user = users[i];
            break;
        }
    }
    
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
        success: true,
        username: user.username,
        stats: {
            sessions: {
                sequence: user.sessions_sequence || 0,
                startrail: user.sessions_startrail || 0,
                duo: user.sessions_duo || 0
            },
            totalSessions: (user.sessions_sequence || 0) + (user.sessions_startrail || 0) + (user.sessions_duo || 0),
            streak: user.streak || 0,
            personalBests: {
                sequence: user.best_sequence || 0,
                startrail: user.best_startrail || 0,
                duo: user.best_duo || 0
            }
        }
    });
});

// Get stats by access code + username (legacy)
app.get('/api/game/stats/:accessCode/:username', function(req, res) {
    var accessCode = req.params.accessCode;
    var username = req.params.username;
    
    var users = readJSON(USERS_FILE);
    var user = null;
    for (var i = 0; i < users.length; i++) {
        if (users[i].code === accessCode && users[i].username.toLowerCase() === username.toLowerCase()) {
            user = users[i];
            break;
        }
    }
    
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    
    res.json({
        success: true,
        stats: {
            sessions: {
                sequence: user.sessions_sequence || 0,
                startrail: user.sessions_startrail || 0,
                duo: user.sessions_duo || 0
            },
            totalSessions: (user.sessions_sequence || 0) + (user.sessions_startrail || 0) + (user.sessions_duo || 0),
            streak: user.streak || 0,
            personalBests: {
                sequence: user.best_sequence || 0,
                startrail: user.best_startrail || 0,
                duo: user.best_duo || 0
            }
        }
    });
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
    
    var licenseKey = generateLicensePin();
    
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
