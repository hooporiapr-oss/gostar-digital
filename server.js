const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ PLATFORM VERSION ============
const PLATFORM_VERSION = '1.0.0';
const PLATFORM_VERSION_NAME = 'GoTrotter - The Cognitive Sport';

// Admin credentials (legacy Basic Auth)
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'GoStar2026';

// Admin PIN (new dashboard auth)
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

// ============ SESSION LOCKOUT SYSTEM ============
const activeSessions = new Map();
const SESSION_TIMEOUT_MS = 2 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 30 * 1000;

// ============ STRIPE SETUP ============
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRICES = {
    individual_monthly: process.env.STRIPE_PRICE_INDIVIDUAL_MONTHLY,
    individual_annual: process.env.STRIPE_PRICE_INDIVIDUAL_ANNUAL
};

let stripe = null;
if (STRIPE_SECRET_KEY) {
    stripe = require('stripe')(STRIPE_SECRET_KEY);
    console.log('Stripe initialized');
} else {
    console.log('Stripe not configured - set STRIPE_SECRET_KEY');
}

// Data file paths
const DATA_DIR = path.join(__dirname, 'data');
const LICENSES_FILE = path.join(DATA_DIR, 'licenses.json');
const CODES_FILE = path.join(DATA_DIR, 'codes.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');
const SUBSCRIBERS_FILE = path.join(DATA_DIR, 'subscribers.json');
const TRIAL_PINS_FILE = path.join(DATA_DIR, 'trial-pins.json');
const NOTIFICATIONS_FILE = path.join(DATA_DIR, 'notifications.json');

// Ensure data directory and files exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(LICENSES_FILE)) fs.writeFileSync(LICENSES_FILE, '[]');
if (!fs.existsSync(CODES_FILE)) fs.writeFileSync(CODES_FILE, '[]');
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(ACTIVITY_FILE)) fs.writeFileSync(ACTIVITY_FILE, '[]');
if (!fs.existsSync(SUBSCRIBERS_FILE)) fs.writeFileSync(SUBSCRIBERS_FILE, '[]');
if (!fs.existsSync(TRIAL_PINS_FILE)) fs.writeFileSync(TRIAL_PINS_FILE, '[]');
if (!fs.existsSync(NOTIFICATIONS_FILE)) fs.writeFileSync(NOTIFICATIONS_FILE, '[]');

// ============ STRIPE WEBHOOK ============
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), function(req, res) {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        return res.status(400).send('Webhook Error: ' + err.message);
    }
    switch (event.type) {
        case 'checkout.session.completed': handleCheckoutComplete(event.data.object); break;
        case 'customer.subscription.updated': handleSubscriptionUpdate(event.data.object); break;
        case 'customer.subscription.deleted': handleSubscriptionCanceled(event.data.object); break;
        case 'invoice.payment_failed': handlePaymentFailed(event.data.object); break;
    }
    res.json({ received: true });
});

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Helper functions
function readJSON(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return []; } }
function writeJSON(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2)); }

function logActivity(type, username, facility, details, extra) {
    var activities = readJSON(ACTIVITY_FILE);
    var activity = { id: 'act_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6), timestamp: new Date().toISOString(), type: type, username: username || null, facility: facility || null, details: details || null };
    if (extra) { Object.assign(activity, extra); }
    activities.unshift(activity);
    if (activities.length > 500) activities = activities.slice(0, 500);
    writeJSON(ACTIVITY_FILE, activities);
}

function generateUserPin() {
    var users = readJSON(USERS_FILE);
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    var trialPins = readJSON(TRIAL_PINS_FILE);
    var existingPins = users.map(u => u.pin).concat(subscribers.map(s => s.pin)).concat(trialPins.map(t => t.pin)).filter(p => p);
    var pin, attempts = 0;
    do { pin = String(1000 + Math.floor(Math.random() * 9000)); attempts++; } while (existingPins.indexOf(pin) !== -1 && attempts < 100);
    return pin;
}

function generateToken() { return Buffer.from(Date.now() + '-' + Math.random().toString(36).substring(2, 15)).toString('base64'); }
function generateSessionToken() { return 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15); }

// ============ SESSION FUNCTIONS ============
function cleanExpiredSessions(pin) {
    var pinData = activeSessions.get(pin);
    if (!pinData) return;
    var now = Date.now();
    var expired = [];
    pinData.sessions.forEach((session, token) => { if (now - session.lastHeartbeat > SESSION_TIMEOUT_MS) expired.push(token); });
    expired.forEach(token => pinData.sessions.delete(token));
}

function createSession(pin, maxConcurrent) {
    var pinData = activeSessions.get(pin);
    if (!pinData) { pinData = { maxConcurrent: maxConcurrent, sessions: new Map() }; activeSessions.set(pin, pinData); }
    pinData.maxConcurrent = maxConcurrent;
    cleanExpiredSessions(pin);
    if (maxConcurrent === 1) { if (pinData.sessions.size > 0) pinData.sessions.clear(); }
    else { if (pinData.sessions.size >= maxConcurrent) return { error: 'limit_reached', current: pinData.sessions.size, max: maxConcurrent }; }
    var token = generateSessionToken();
    var now = Date.now();
    pinData.sessions.set(token, { createdAt: now, lastHeartbeat: now });
    return { token: token, current: pinData.sessions.size, max: maxConcurrent };
}

function validateSession(pin, token) {
    var pinData = activeSessions.get(pin);
    if (!pinData) return { valid: false, reason: 'no_session' };
    var session = pinData.sessions.get(token);
    if (!session) return { valid: false, reason: 'token_invalid' };
    if (Date.now() - session.lastHeartbeat > SESSION_TIMEOUT_MS) { pinData.sessions.delete(token); return { valid: false, reason: 'expired' }; }
    session.lastHeartbeat = Date.now();
    return { valid: true };
}

function destroySession(pin, token) {
    var pinData = activeSessions.get(pin);
    if (pinData && pinData.sessions.has(token)) { pinData.sessions.delete(token); return true; }
    return false;
}

// ============ SESSION API ============
app.post('/api/session/create', function(req, res) {
    var pin = req.body.pin;
    if (!pin) return res.status(400).json({ success: false, error: 'PIN required' });
    
    var isValidPin = false, userType = null, maxConcurrent = 1, userInfo = {};
    
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
            var isActive = subscribers[i].status === 'active' || subscribers[i].status === 'trialing';
            if (!isActive) return res.status(401).json({ success: false, error: 'Subscription not active' });
            isValidPin = true; userType = 'subscriber'; maxConcurrent = subscribers[i].quantity || 1;
            userInfo = { email: subscribers[i].email, plan: subscribers[i].plan_type };
            break;
        }
    }
    
    if (!isValidPin) {
        var trialPins = readJSON(TRIAL_PINS_FILE);
        for (var k = 0; k < trialPins.length; k++) {
            if (trialPins[k].pin === pin) {
                if (new Date(trialPins[k].expiresAt) < new Date()) return res.status(401).json({ success: false, error: 'Trial expired' });
                isValidPin = true; userType = 'facility_trial'; maxConcurrent = trialPins[k].maxUsers || 50;
                userInfo = { facility: trialPins[k].facility };
                break;
            }
        }
    }
    
    if (!isValidPin) return res.status(401).json({ success: false, error: 'Invalid PIN' });
    
    var result = createSession(pin, maxConcurrent);
    if (result.error === 'limit_reached') {
        logActivity('session_blocked', pin, userInfo.facility || null, 'Session blocked: ' + result.current + '/' + result.max);
        return res.status(403).json({ success: false, error: 'limit_reached', message: 'All ' + result.max + ' seats in use.', current: result.current, max: result.max });
    }
    
    logActivity('session_created', pin, userInfo.facility || null, 'Session started (' + result.current + '/' + result.max + ')');
    res.json({ success: true, token: result.token, userType: userType, maxConcurrent: result.max, activeSessions: result.current });
});

app.post('/api/session/validate', function(req, res) {
    var pin = req.body.pin, token = req.body.token;
    if (!pin || !token) return res.status(400).json({ valid: false, error: 'PIN and token required' });
    var result = validateSession(pin, token);
    if (!result.valid) {
        var message = result.reason === 'token_invalid' ? 'Another device is using this account' : result.reason === 'expired' ? 'Session timed out' : 'Session not found';
        return res.json({ valid: false, reason: result.reason, message: message, action: 'logout' });
    }
    res.json({ valid: true, message: 'Session active' });
});

app.post('/api/session/destroy', function(req, res) {
    var pin = req.body.pin, token = req.body.token;
    if (!pin || !token) return res.status(400).json({ success: false, error: 'PIN and token required' });
    var destroyed = destroySession(pin, token);
    if (destroyed) logActivity('session_destroyed', pin, null, 'User logged out');
    res.json({ success: true, message: destroyed ? 'Session destroyed' : 'Session not found' });
});

// ============ STRIPE HANDLERS ============
function handleCheckoutComplete(session) {
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    var email = session.customer_email || session.customer_details?.email;
    var subIndex = subscribers.findIndex(s => s.email === email);
    var planType = session.metadata?.plan_type || 'individual_monthly';
    var quantity = parseInt(session.metadata?.quantity) || 1;
    
    if (subIndex === -1) {
        subscribers.push({
            email: email, pin: generateUserPin(), stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription, plan_type: planType, status: 'active',
            quantity: quantity, created_at: new Date().toISOString(), current_period_end: null,
            totalScore: 0, streak: 0, circuits: 0, lastActive: null, seenNotifications: [],
            stats: { level: 1, speed: 'slow', bestScore: 0, totalCircuits: 0 }
        });
        logActivity('subscription_created', email, null, 'New subscription', { email: email });
    } else {
        subscribers[subIndex].stripe_customer_id = session.customer;
        subscribers[subIndex].stripe_subscription_id = session.subscription;
        subscribers[subIndex].plan_type = planType;
        subscribers[subIndex].status = 'active';
        subscribers[subIndex].quantity = quantity;
    }
    writeJSON(SUBSCRIBERS_FILE, subscribers);
}

function handleSubscriptionUpdate(subscription) {
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].stripe_subscription_id === subscription.id) {
            subscribers[i].status = subscription.status;
            subscribers[i].current_period_end = new Date(subscription.current_period_end * 1000).toISOString();
            if (subscription.items?.data?.[0]?.quantity) subscribers[i].quantity = subscription.items.data[0].quantity;
            writeJSON(SUBSCRIBERS_FILE, subscribers);
            break;
        }
    }
}

function handleSubscriptionCanceled(subscription) {
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].stripe_subscription_id === subscription.id) {
            subscribers[i].status = 'canceled';
            logActivity('subscription_canceled', subscribers[i].email, null, 'Subscription canceled');
            writeJSON(SUBSCRIBERS_FILE, subscribers);
            break;
        }
    }
}

function handlePaymentFailed(invoice) {
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].stripe_customer_id === invoice.customer) {
            logActivity('payment_failed', subscribers[i].email, null, 'Payment failed');
            break;
        }
    }
}

// ============ STRIPE ROUTES ============
app.post('/api/stripe/checkout', function(req, res) {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
    var planType = req.body.planType || 'individual_monthly';
    var priceId = STRIPE_PRICES[planType];
    if (!priceId) return res.status(400).json({ error: 'Invalid plan type' });
    var baseUrl = process.env.SITE_URL || 'https://gotrotters.com';
    
    stripe.checkout.sessions.create({
        mode: 'subscription', payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1, adjustable_quantity: { enabled: true, minimum: 1, maximum: 50 } }],
        allow_promotion_codes: true,
        success_url: baseUrl + '/?success=true&session_id={CHECKOUT_SESSION_ID}',
        cancel_url: baseUrl + '/?canceled=true',
        metadata: { plan_type: planType }
    }).then(session => res.json({ url: session.url, sessionId: session.id }))
    .catch(err => res.status(500).json({ error: err.message }));
});

app.get('/api/stripe/status-pin/:pin', function(req, res) {
    var pin = req.params.pin;
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
            var isActive = subscribers[i].status === 'active' || subscribers[i].status === 'trialing';
            return res.json({ subscribed: isActive, status: subscribers[i].status, plan_type: subscribers[i].plan_type, quantity: subscribers[i].quantity || 1, email: subscribers[i].email });
        }
    }
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var k = 0; k < trialPins.length; k++) {
        if (trialPins[k].pin === pin) {
            var trial = trialPins[k];
            var isExpired = new Date(trial.expiresAt) < new Date();
            var daysLeft = Math.ceil((new Date(trial.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
            return res.json({ subscribed: !isExpired && trial.status === 'active', status: isExpired ? 'expired' : 'trialing', plan_type: 'facility_trial', email: trial.facility, trialInfo: { facility: trial.facility, expiresAt: trial.expiresAt, daysLeft: Math.max(0, daysLeft), currentUsers: trial.currentUsers || 0, maxUsers: trial.maxUsers } });
        }
    }
    return res.json({ subscribed: false, status: null });
});

app.post('/api/subscriber/login', function(req, res) {
    var pin = req.body.pin;
    if (!pin) return res.status(400).json({ error: 'PIN is required' });
    
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
            var isActive = subscribers[i].status === 'active' || subscribers[i].status === 'trialing';
            if (!isActive) return res.status(401).json({ error: 'Subscription not active' });
            logActivity('subscriber_login', subscribers[i].email, null, 'GoTrotter logged in');
            return res.json({ success: true, email: subscribers[i].email, pin: pin, plan: subscribers[i].plan_type, status: subscribers[i].status, quantity: subscribers[i].quantity || 1 });
        }
    }
    
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var k = 0; k < trialPins.length; k++) {
        if (trialPins[k].pin === pin) {
            var trial = trialPins[k];
            if (new Date(trial.expiresAt) < new Date()) { trial.status = 'expired'; writeJSON(TRIAL_PINS_FILE, trialPins); return res.status(401).json({ error: 'Trial has expired' }); }
            if ((trial.currentUsers || 0) >= trial.maxUsers) return res.status(401).json({ error: 'Trial user limit reached' });
            var deviceId = req.headers['x-device-id'] || req.ip || 'unknown';
            if (!trial.devices) trial.devices = [];
            if (trial.devices.indexOf(deviceId) === -1) { trial.devices.push(deviceId); trial.currentUsers = trial.devices.length; writeJSON(TRIAL_PINS_FILE, trialPins); }
            var daysLeft = Math.ceil((new Date(trial.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
            return res.json({ success: true, email: trial.facility, pin: pin, plan: 'facility_trial', status: 'trialing', is_facility_trial: true, trialInfo: { facility: trial.facility, expiresAt: trial.expiresAt, daysLeft: Math.max(0, daysLeft), currentUsers: trial.currentUsers, maxUsers: trial.maxUsers } });
        }
    }
    return res.status(401).json({ error: 'Invalid PIN' });
});

// ============ ADMIN AUTH ============
var adminTokens = new Set();

function adminTokenAuth(req, res, next) {
    var authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'No token' });
    if (adminTokens.has(authHeader.split(' ')[1])) return next();
    res.status(401).json({ success: false, message: 'Invalid token' });
}

app.post('/api/admin/verify', function(req, res) {
    if (req.body.pin === ADMIN_PIN) {
        var token = generateToken();
        adminTokens.add(token);
        setTimeout(() => adminTokens.delete(token), 24 * 60 * 60 * 1000);
        res.json({ success: true, token: token });
    } else {
        res.status(401).json({ success: false, message: 'Invalid PIN' });
    }
});

app.post('/api/admin/verify-token', (req, res) => res.json({ success: adminTokens.has(req.body.token) }));
app.post('/api/admin/logout', (req, res) => { if (req.body.token) adminTokens.delete(req.body.token); res.json({ success: true }); });

// ============ SPEED ACCESS ============
app.get('/api/user/speed-access/:pin', function(req, res) {
    var pin = req.params.pin;
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
            return res.json({ allSpeeds: subscribers[i].status === 'active', userType: 'subscriber', status: subscribers[i].status, plan: subscribers[i].plan_type });
        }
    }
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var k = 0; k < trialPins.length; k++) {
        if (trialPins[k].pin === pin) {
            var trial = trialPins[k];
            var isExpired = new Date(trial.expiresAt) < new Date();
            var daysLeft = Math.ceil((new Date(trial.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
            return res.json({ allSpeeds: false, userType: 'facility_trial', status: isExpired ? 'expired' : 'trialing', daysLeft: Math.max(0, daysLeft), facility: trial.facility });
        }
    }
    return res.json({ allSpeeds: false, userType: 'guest', status: null });
});

// ============ NOTIFICATIONS ============
app.get('/api/notifications/:pin', function(req, res) {
    var pin = req.params.pin;
    var notifications = readJSON(NOTIFICATIONS_FILE).filter(n => n.status === 'active' && (!n.expiresAt || new Date(n.expiresAt) > new Date()));
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
            var seen = subscribers[i].seenNotifications || [];
            return res.json({ success: true, userType: 'subscriber', notifications: notifications.filter(n => seen.indexOf(n.id) === -1), totalUnseen: notifications.filter(n => seen.indexOf(n.id) === -1).length });
        }
    }
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var k = 0; k < trialPins.length; k++) {
        if (trialPins[k].pin === pin) {
            var seen = trialPins[k].seenNotifications || [];
            return res.json({ success: true, userType: 'facility_trial', notifications: notifications.filter(n => seen.indexOf(n.id) === -1) });
        }
    }
    return res.json({ success: true, userType: 'guest', notifications: notifications });
});

// ============ ADMIN TRIAL PINS ============
app.post('/api/admin/trial-pin', adminTokenAuth, function(req, res) {
    var facility = req.body.facility, maxUsers = parseInt(req.body.maxUsers) || 50, trialDays = parseInt(req.body.trialDays) || 7;
    if (!facility) return res.status(400).json({ success: false, error: 'Facility name required' });
    var trialPins = readJSON(TRIAL_PINS_FILE);
    var pin = generateUserPin();
    var expiresAt = new Date(); expiresAt.setDate(expiresAt.getDate() + trialDays);
    var newTrial = { id: 'trial_' + Date.now(), pin: pin, facility: facility.trim(), maxUsers: maxUsers, currentUsers: 0, devices: [], trialDays: trialDays, status: 'active', notes: req.body.notes || '', createdAt: new Date().toISOString(), expiresAt: expiresAt.toISOString(), seenNotifications: [], bonusDaysReceived: 0 };
    trialPins.push(newTrial);
    writeJSON(TRIAL_PINS_FILE, trialPins);
    logActivity('trial_created', facility, facility, 'Created PIN: ' + pin);
    res.json({ success: true, trial: newTrial });
});

app.get('/api/admin/trial-pins', adminTokenAuth, function(req, res) {
    var trialPins = readJSON(TRIAL_PINS_FILE);
    var now = new Date();
    trialPins.forEach(t => { if (t.status === 'active' && new Date(t.expiresAt) < now) t.status = 'expired'; });
    writeJSON(TRIAL_PINS_FILE, trialPins);
    res.json({ success: true, trials: trialPins });
});

app.post('/api/admin/trial-pin/:id/extend', adminTokenAuth, function(req, res) {
    var extraDays = parseInt(req.body.days) || 7;
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var i = 0; i < trialPins.length; i++) {
        if (trialPins[i].id === req.params.id) {
            var currentExpiry = new Date(trialPins[i].expiresAt);
            var now = new Date();
            var baseDate = currentExpiry < now ? now : currentExpiry;
            baseDate.setDate(baseDate.getDate() + extraDays);
            trialPins[i].expiresAt = baseDate.toISOString();
            trialPins[i].status = 'active';
            trialPins[i].bonusDaysReceived = (trialPins[i].bonusDaysReceived || 0) + extraDays;
            writeJSON(TRIAL_PINS_FILE, trialPins);
            logActivity('trial_extended', trialPins[i].facility, trialPins[i].facility, 'Extended by ' + extraDays + ' days');
            return res.json({ success: true, trial: trialPins[i] });
        }
    }
    res.status(404).json({ success: false, error: 'Trial not found' });
});

app.delete('/api/admin/trial-pin/:id', adminTokenAuth, function(req, res) {
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var i = 0; i < trialPins.length; i++) {
        if (trialPins[i].id === req.params.id) {
            var deleted = trialPins.splice(i, 1)[0];
            writeJSON(TRIAL_PINS_FILE, trialPins);
            return res.json({ success: true });
        }
    }
    res.status(404).json({ success: false, error: 'Trial not found' });
});

// ============ ADMIN SUBSCRIBERS ============
app.get('/api/admin/subscribers', adminTokenAuth, (req, res) => res.json({ success: true, subscribers: readJSON(SUBSCRIBERS_FILE) }));
app.get('/api/admin/activity', adminTokenAuth, (req, res) => res.json({ success: true, activities: readJSON(ACTIVITY_FILE) }));
app.get('/api/admin/sessions', adminTokenAuth, function(req, res) {
    var sessions = [];
    activeSessions.forEach((pinData, pin) => {
        cleanExpiredSessions(pin);
        if (pinData.sessions.size > 0) sessions.push({ pin: pin, maxConcurrent: pinData.maxConcurrent, activeSessions: pinData.sessions.size });
    });
    res.json({ success: true, totalActiveSessions: sessions.reduce((sum, s) => sum + s.activeSessions, 0), pins: sessions });
});

// ============ GAME SESSION ============
app.post('/api/game/session', function(req, res) {
    var pin = req.body.pin, score = req.body.score || 0, level = req.body.level, speed = req.body.speed, circuit = req.body.circuit;
    if (!pin) return res.status(400).json({ error: 'PIN required' });
    
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
            var sub = subscribers[i];
            if (!sub.stats) sub.stats = { level: 1, speed: 'slow', bestScore: 0, totalCircuits: 0 };
            sub.totalScore = (sub.totalScore || 0) + score;
            sub.circuits = (sub.circuits || 0) + 1;
            sub.stats.totalCircuits++;
            if (score > (sub.stats.bestScore || 0)) sub.stats.bestScore = score;
            if (level) sub.stats.level = level;
            if (speed) sub.stats.speed = speed;
            sub.lastActive = new Date().toISOString();
            var today = new Date().toISOString().split('T')[0];
            if (!sub.lastStreakDate) { sub.streak = 1; sub.lastStreakDate = today; }
            else if (sub.lastStreakDate !== today) { var diff = Math.floor((new Date(today) - new Date(sub.lastStreakDate)) / 86400000); sub.streak = diff === 1 ? (sub.streak || 0) + 1 : 1; sub.lastStreakDate = today; }
            writeJSON(SUBSCRIBERS_FILE, subscribers);
            logActivity('game_session', sub.email, null, 'L' + level + ' ' + speed + ' | Score +' + score, { score: score, level: level });
            return res.json({ success: true, streak: sub.streak, circuits: sub.circuits, totalScore: sub.totalScore });
        }
    }
    
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var k = 0; k < trialPins.length; k++) {
        if (trialPins[k].pin === pin) {
            logActivity('game_session', trialPins[k].facility, trialPins[k].facility, 'Trial | L' + level + ' ' + speed, { score: score });
            return res.json({ success: true, streak: 1, circuits: 1, totalScore: score });
        }
    }
    return res.status(404).json({ error: 'User not found' });
});

app.get('/api/game/stats/pin/:pin', function(req, res) {
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === req.params.pin) {
            var sub = subscribers[i];
            return res.json({ success: true, username: sub.email.split('@')[0], stats: { ...(sub.stats || {}), totalScore: sub.totalScore || 0, streak: sub.streak || 0, circuits: sub.circuits || 0 } });
        }
    }
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var k = 0; k < trialPins.length; k++) {
        if (trialPins[k].pin === req.params.pin) return res.json({ success: true, username: trialPins[k].facility, stats: { level: 1, speed: 'slow', bestScore: 0, totalCircuits: 0, totalScore: 0, streak: 0, circuits: 0 } });
    }
    return res.status(404).json({ error: 'Not found' });
});

// ============ ROUTES ============
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin-dashboard', (req, res) => res.sendFile(path.join(__dirname, 'admin-dashboard.html')));
app.get('/play', (req, res) => res.sendFile(path.join(__dirname, 'gotrotter.html')));
app.get('/hub', (req, res) => res.sendFile(path.join(__dirname, 'trotter-hub.html')));
app.get('/health', (req, res) => res.json({ status: 'healthy', timestamp: new Date().toISOString(), version: PLATFORM_VERSION }));
app.get('/api/platform/version', (req, res) => res.json({ version: PLATFORM_VERSION, versionName: PLATFORM_VERSION_NAME, game: 'GOTROTTER', divisions: 15, levels: 5, speeds: ['SLOW', 'MED', 'FAST'] }));

// ============ START ============
app.listen(PORT, () => {
    console.log('🏀 GoTrotter running on port ' + PORT);
    console.log('Platform: ' + PLATFORM_VERSION_NAME);
    console.log('Stripe:', !!stripe ? 'Configured' : 'Not configured');
    console.log('Session lockout: ACTIVE');
    console.log('Routes: / | /hub | /play | /admin-dashboard');
});
