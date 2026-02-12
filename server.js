const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ PLATFORM VERSION ============
const PLATFORM_VERSION = '5.0.0';
const PLATFORM_VERSION_NAME = 'Hey Bori — Tu Compañera Boricua 🇵🇷';

// ============ ADMIN SECRET KEY ============
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || 'Ritnome2026!';

// ============ SESSION LOCKOUT SYSTEM ============
const activeSessions = new Map();
const SESSION_TIMEOUT_MS = 2 * 60 * 1000;

// ============ STRIPE SETUP ============
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRICES = {
    individual_monthly: process.env.STRIPE_PRICE_INDIVIDUAL_MONTHLY,
    plus: process.env.STRIPE_PRICE_PLUS,
    familia: process.env.STRIPE_PRICE_FAMILIA
};

// ============ ANTHROPIC API (BORI AI) ============
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (ANTHROPIC_API_KEY) {
    console.log('✅ Anthropic API configured (Bori AI)');
} else {
    console.log('⚠️ Anthropic API not configured - set ANTHROPIC_API_KEY');
}

let stripe = null;
if (STRIPE_SECRET_KEY) {
    stripe = require('stripe')(STRIPE_SECRET_KEY);
    console.log('✅ Stripe initialized');
} else {
    console.log('⚠️ Stripe not configured - set STRIPE_SECRET_KEY');
}

// ============ DATA FILES ============
const DATA_DIR = path.join(__dirname, 'data');
const SUBSCRIBERS_FILE = path.join(DATA_DIR, 'subscribers.json');
const TRIAL_PINS_FILE = path.join(DATA_DIR, 'trial-pins.json');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');
const FAMILY_FILE = path.join(DATA_DIR, 'family.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(SUBSCRIBERS_FILE)) fs.writeFileSync(SUBSCRIBERS_FILE, '[]');
if (!fs.existsSync(TRIAL_PINS_FILE)) fs.writeFileSync(TRIAL_PINS_FILE, '[]');
if (!fs.existsSync(ACTIVITY_FILE)) fs.writeFileSync(ACTIVITY_FILE, '[]');
if (!fs.existsSync(FAMILY_FILE)) fs.writeFileSync(FAMILY_FILE, '{}');

// ============ HELPER FUNCTIONS ============
function readJSON(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (e) { return []; }
}

function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function generateUserPin() {
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    var trialPins = readJSON(TRIAL_PINS_FILE);
    var existingPins = subscribers.map(function(s) { return s.pin; })
        .concat(trialPins.map(function(t) { return t.pin; }))
        .filter(function(p) { return p; });
    
    var pin, attempts = 0;
    do {
        pin = String(1000 + Math.floor(Math.random() * 9000));
        attempts++;
    } while (existingPins.indexOf(pin) !== -1 && attempts < 100);
    
    return pin;
}

function generateSessionToken() {
    return 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

function logActivity(type, username, facility, details, extra) {
    var activities = readJSON(ACTIVITY_FILE);
    var activity = {
        id: 'act_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        timestamp: new Date().toISOString(),
        type: type,
        username: username || null,
        facility: facility || null,
        details: details || null
    };
    if (extra) Object.assign(activity, extra);
    activities.unshift(activity);
    if (activities.length > 500) activities = activities.slice(0, 500);
    writeJSON(ACTIVITY_FILE, activities);
}

function adminKeyAuth(req, res, next) {
    var key = req.headers['x-admin-key'];
    if (key === ADMIN_SECRET_KEY) return next();
    res.status(401).json({ success: false, error: 'Invalid admin key' });
}

// ============ SESSION FUNCTIONS ============
function cleanExpiredSessions(pin) {
    var pinData = activeSessions.get(pin);
    if (!pinData) return;
    var now = Date.now();
    var expired = [];
    pinData.sessions.forEach(function(session, token) {
        if (now - session.lastHeartbeat > SESSION_TIMEOUT_MS) expired.push(token);
    });
    expired.forEach(function(token) { pinData.sessions.delete(token); });
}

function createSession(pin, maxConcurrent) {
    var pinData = activeSessions.get(pin);
    if (!pinData) {
        pinData = { maxConcurrent: maxConcurrent, sessions: new Map() };
        activeSessions.set(pin, pinData);
    }
    pinData.maxConcurrent = maxConcurrent;
    cleanExpiredSessions(pin);
    
    if (maxConcurrent === 1) {
        if (pinData.sessions.size > 0) pinData.sessions.clear();
    } else {
        if (pinData.sessions.size >= maxConcurrent) {
            return { error: 'limit_reached', current: pinData.sessions.size, max: maxConcurrent };
        }
    }
    
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
    if (Date.now() - session.lastHeartbeat > SESSION_TIMEOUT_MS) {
        pinData.sessions.delete(token);
        return { valid: false, reason: 'expired' };
    }
    session.lastHeartbeat = Date.now();
    return { valid: true };
}

function destroySession(pin, token) {
    var pinData = activeSessions.get(pin);
    if (pinData && pinData.sessions.has(token)) {
        pinData.sessions.delete(token);
        return true;
    }
    return false;
}

// ============ STRIPE WEBHOOK ============
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), function(req, res) {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
    
    var sig = req.headers['stripe-signature'];
    var event;
    
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.log('⚠️ Webhook signature verification failed:', err.message);
        return res.status(400).send('Webhook Error: ' + err.message);
    }
    
    console.log('📨 Stripe event:', event.type);
    
    switch (event.type) {
        case 'checkout.session.completed':
            handleCheckoutComplete(event.data.object);
            break;
        case 'customer.subscription.updated':
            handleSubscriptionUpdate(event.data.object);
            break;
        case 'customer.subscription.deleted':
            handleSubscriptionCanceled(event.data.object);
            break;
        case 'invoice.payment_failed':
            handlePaymentFailed(event.data.object);
            break;
    }
    
    res.json({ received: true });
});

// ============ MIDDLEWARE ============
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// ============ STRIPE HANDLERS ============
function handleCheckoutComplete(session) {
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    var email = session.customer_email || (session.customer_details && session.customer_details.email);
    var planType = (session.metadata && session.metadata.plan_type) || 'individual_monthly';
    var quantity = parseInt((session.metadata && session.metadata.quantity) || 1);
    
    var existingIndex = -1;
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].email === email) {
            existingIndex = i;
            break;
        }
    }
    
    var pin;
    
    if (existingIndex === -1) {
        pin = generateUserPin();
        var newSubscriber = {
            email: email,
            pin: pin,
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            plan_type: planType,
            status: 'active',
            quantity: quantity,
            created_at: new Date().toISOString(),
            current_period_end: null,
            totalScore: 0,
            streak: 0,
            circuits: 0,
            lastActive: null,
            stats: { level: 1, speed: 'slow', bestScore: 0, totalCircuits: 0 }
        };
        subscribers.push(newSubscriber);
        console.log('🆕 New subscriber:', email, '| PIN:', pin);
        logActivity('subscription_created', email, null, 'New subscription | PIN: ' + pin, { email: email, pin: pin });
    } else {
        pin = subscribers[existingIndex].pin;
        subscribers[existingIndex].stripe_customer_id = session.customer;
        subscribers[existingIndex].stripe_subscription_id = session.subscription;
        subscribers[existingIndex].plan_type = planType;
        subscribers[existingIndex].status = 'active';
        subscribers[existingIndex].quantity = quantity;
        console.log('🔄 Returning subscriber reactivated:', email, '| PIN:', pin);
        logActivity('subscription_reactivated', email, null, 'Subscription reactivated | PIN: ' + pin);
    }
    
    writeJSON(SUBSCRIBERS_FILE, subscribers);
    
    if (stripe && session.customer) {
        stripe.customers.update(session.customer, {
            metadata: { ritnome_pin: pin, plan_type: planType, quantity: String(quantity) }
        }).then(function() {
            console.log('✅ PIN saved to Stripe customer metadata:', pin);
        }).catch(function(err) {
            console.log('⚠️ Failed to update Stripe customer metadata:', err.message);
        });
    }
}

function handleSubscriptionUpdate(subscription) {
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].stripe_subscription_id === subscription.id) {
            subscribers[i].status = subscription.status;
            subscribers[i].current_period_end = new Date(subscription.current_period_end * 1000).toISOString();
            if (subscription.items && subscription.items.data && subscription.items.data[0] && subscription.items.data[0].quantity) {
                subscribers[i].quantity = subscription.items.data[0].quantity;
            }
            console.log('📝 Subscription updated:', subscribers[i].email, '| Status:', subscription.status);
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
            console.log('❌ Subscription canceled:', subscribers[i].email);
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
            console.log('⚠️ Payment failed:', subscribers[i].email);
            logActivity('payment_failed', subscribers[i].email, null, 'Payment failed');
            break;
        }
    }
}

// ============ STRIPE CHECKOUT ============
app.post('/api/stripe/checkout', function(req, res) {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
    
    var planType = req.body.planType || 'individual_monthly';
    var priceId = STRIPE_PRICES[planType];
    
    if (!priceId) return res.status(400).json({ error: 'Invalid plan type' });
    
    var baseUrl = process.env.SITE_URL || 'https://heybori.com';
    
    stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{
            price: priceId,
            quantity: 1,
            adjustable_quantity: { enabled: true, minimum: 1, maximum: 50 }
        }],
        allow_promotion_codes: true,
        success_url: baseUrl + '/success?session_id={CHECKOUT_SESSION_ID}',
        cancel_url: baseUrl + '/login?canceled=true',
        metadata: { plan_type: planType }
    }).then(function(session) {
        res.json({ url: session.url, sessionId: session.id });
    }).catch(function(err) {
        res.status(500).json({ error: err.message });
    });
});

// ============ PIN STATUS CHECK ============
app.get('/api/stripe/status-pin/:pin', function(req, res) {
    var pin = req.params.pin;
    
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
            var isActive = subscribers[i].status === 'active' || subscribers[i].status === 'trialing';
            return res.json({
                subscribed: isActive,
                status: subscribers[i].status,
                plan_type: subscribers[i].plan_type,
                quantity: subscribers[i].quantity || 1,
                email: subscribers[i].email
            });
        }
    }
    
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var k = 0; k < trialPins.length; k++) {
        if (trialPins[k].pin === pin) {
            var trial = trialPins[k];
            var isExpired = new Date(trial.expiresAt) < new Date();
            var daysLeft = Math.ceil((new Date(trial.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
            return res.json({
                subscribed: !isExpired && trial.status === 'active',
                status: isExpired ? 'expired' : 'trialing',
                plan_type: 'facility_trial',
                email: trial.facility,
                trialInfo: { facility: trial.facility, expiresAt: trial.expiresAt, daysLeft: Math.max(0, daysLeft), currentUsers: trial.currentUsers || 0, maxUsers: trial.maxUsers }
            });
        }
    }
    
    return res.json({ subscribed: false, status: null });
});

// ============ LOGIN ENDPOINT ============
app.post('/api/login', function(req, res) {
    var pin = req.body.pin;
    if (!pin) return res.status(400).json({ success: false, error: 'PIN is required' });
    
    var isValidPin = false;
    var userType = null;
    var maxConcurrent = 1;
    var userInfo = {};
    
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
            var isActive = subscribers[i].status === 'active' || subscribers[i].status === 'trialing';
            if (!isActive) return res.status(401).json({ success: false, error: 'Subscription not active. Please renew.' });
            isValidPin = true;
            userType = 'subscriber';
            maxConcurrent = subscribers[i].quantity || 1;
            userInfo = { email: subscribers[i].email, plan: subscribers[i].plan_type, status: subscribers[i].status };
            break;
        }
    }
    
    if (!isValidPin) {
        var trialPins = readJSON(TRIAL_PINS_FILE);
        for (var k = 0; k < trialPins.length; k++) {
            if (trialPins[k].pin === pin) {
                var trial = trialPins[k];
                if (new Date(trial.expiresAt) < new Date()) {
                    trial.status = 'expired';
                    writeJSON(TRIAL_PINS_FILE, trialPins);
                    return res.status(401).json({ success: false, error: 'Trial has expired' });
                }
                isValidPin = true;
                userType = 'facility_trial';
                maxConcurrent = trial.maxUsers || 50;
                var daysLeft = Math.ceil((new Date(trial.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
                userInfo = { facility: trial.facility, status: 'trialing', daysLeft: Math.max(0, daysLeft) };
                break;
            }
        }
    }
    
    if (!isValidPin) {
        logActivity('login_failed', pin, null, 'Invalid PIN attempt');
        return res.status(401).json({ success: false, error: 'Invalid PIN' });
    }
    
    var sessionResult = createSession(pin, maxConcurrent);
    
    if (sessionResult.error === 'limit_reached') {
        logActivity('login_blocked', pin, userInfo.facility || null, 'All seats in use: ' + sessionResult.current + '/' + sessionResult.max);
        return res.status(403).json({ success: false, error: 'All ' + sessionResult.max + ' seats are currently in use. Please try again later.' });
    }
    
    logActivity('login_success', userInfo.email || userInfo.facility, userInfo.facility || null, 'Logged in (' + sessionResult.current + '/' + sessionResult.max + ' seats)');
    
    res.json({ success: true, token: sessionResult.token, userType: userType, userInfo: userInfo, activeSessions: sessionResult.current, maxSessions: sessionResult.max });
});

// ============ FORGOT PIN ============
app.post('/api/forgot-pin', function(req, res) {
    var email = req.body.email;
    if (!email || !email.includes('@')) return res.status(400).json({ success: false, error: 'Valid email required' });
    
    email = email.toLowerCase().trim();
    
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    var foundSubscriber = null;
    
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].email && subscribers[i].email.toLowerCase() === email) {
            foundSubscriber = subscribers[i];
            break;
        }
    }
    
    if (foundSubscriber) {
        console.log('🔑 PIN recovered for:', email);
        logActivity('pin_recovered', email, null, 'PIN retrieved successfully');
        var isActive = foundSubscriber.status === 'active' || foundSubscriber.status === 'trialing';
        return res.json({ success: true, found: true, pin: foundSubscriber.pin, email: foundSubscriber.email, status: foundSubscriber.status, isActive: isActive, message: isActive ? 'Welcome back to RITNOME!' : 'Subscription not active. Please renew.' });
    }
    
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var k = 0; k < trialPins.length; k++) {
        if (trialPins[k].facility && trialPins[k].facility.toLowerCase() === email) {
            var trial = trialPins[k];
            var isExpired = new Date(trial.expiresAt) < new Date();
            console.log('🔑 Trial PIN recovered for facility:', trial.facility);
            logActivity('pin_recovered', trial.facility, trial.facility, 'Trial PIN retrieved');
            return res.json({ success: true, found: true, pin: trial.pin, email: trial.facility, status: isExpired ? 'expired' : 'trialing', isActive: !isExpired, isTrial: true, message: isExpired ? 'Trial has expired.' : 'Welcome back!' });
        }
    }
    
    console.log('❌ PIN recovery failed - email not found:', email);
    logActivity('pin_recovery_failed', email, null, 'Email not found');
    return res.json({ success: true, found: false, message: 'No account found with this email. Start your free trial!' });
});

// ============ SESSION API ============
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

// ============ SPEED ACCESS (FIXED) ============
app.get('/api/user/speed-access/:pin', function(req, res) {
    var pin = req.params.pin;
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
            // FIXED: Both 'active' AND 'trialing' subscribers get all speeds
            var isPaid = subscribers[i].status === 'active' || subscribers[i].status === 'trialing';
            return res.json({ 
                allSpeeds: isPaid, 
                userType: 'subscriber', 
                status: subscribers[i].status, 
                plan: subscribers[i].plan_type 
            });
        }
    }
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var k = 0; k < trialPins.length; k++) {
        if (trialPins[k].pin === pin) {
            var trial = trialPins[k];
            var isExpired = new Date(trial.expiresAt) < new Date();
            var daysLeft = Math.ceil((new Date(trial.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
            // Facility trials only get slow speed (60 BPM)
            return res.json({ 
                allSpeeds: false, 
                userType: 'facility_trial', 
                status: isExpired ? 'expired' : 'trialing', 
                daysLeft: Math.max(0, daysLeft), 
                facility: trial.facility 
            });
        }
    }
    return res.json({ allSpeeds: false, userType: 'guest', status: null });
});

// ============ GAME SESSION ============
app.post('/api/game/session', function(req, res) {
    var pin = req.body.pin;
    var score = req.body.score || 0;
    var level = req.body.level;
    var speed = req.body.speed;
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
            else if (sub.lastStreakDate !== today) {
                var diff = Math.floor((new Date(today) - new Date(sub.lastStreakDate)) / 86400000);
                sub.streak = diff === 1 ? (sub.streak || 0) + 1 : 1;
                sub.lastStreakDate = today;
            }
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
    var pin = req.params.pin;
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
            var sub = subscribers[i];
            return res.json({ success: true, username: sub.email.split('@')[0], stats: { level: (sub.stats && sub.stats.level) || 1, speed: (sub.stats && sub.stats.speed) || 'slow', bestScore: (sub.stats && sub.stats.bestScore) || 0, totalCircuits: (sub.stats && sub.stats.totalCircuits) || 0, totalScore: sub.totalScore || 0, streak: sub.streak || 0, circuits: sub.circuits || 0 } });
        }
    }
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var k = 0; k < trialPins.length; k++) {
        if (trialPins[k].pin === pin) {
            return res.json({ success: true, username: trialPins[k].facility, stats: { level: 1, speed: 'slow', bestScore: 0, totalCircuits: 0, totalScore: 0, streak: 0, circuits: 0 } });
        }
    }
    return res.status(404).json({ error: 'Not found' });
});

app.get('/api/notifications/:pin', function(req, res) {
    res.json({ success: true, notifications: [] });
});

// ============ TRIAL PIN MANAGEMENT ============
app.post('/api/trials/create', adminKeyAuth, function(req, res) {
    var facility = req.body.facility;
    var maxUsers = parseInt(req.body.maxUsers) || 50;
    var days = parseInt(req.body.days) || 7;
    var notes = req.body.notes || '';
    if (!facility) return res.status(400).json({ success: false, error: 'Facility name required' });
    
    var trialPins = readJSON(TRIAL_PINS_FILE);
    var pin = generateUserPin();
    var expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);
    
    var newTrial = { id: 'trial_' + Date.now(), pin: pin, facility: facility.trim(), maxUsers: maxUsers, currentUsers: 0, devices: [], status: 'active', notes: notes, createdAt: new Date().toISOString(), expiresAt: expiresAt.toISOString(), bonusDaysReceived: 0 };
    trialPins.push(newTrial);
    writeJSON(TRIAL_PINS_FILE, trialPins);
    console.log('🎫 Trial created:', facility, '| PIN:', pin, '| Users:', maxUsers, '| Days:', days);
    logActivity('trial_created', facility, facility, 'Created PIN: ' + pin + ' | ' + maxUsers + ' users | ' + days + ' days');
    res.json({ success: true, trial: newTrial, message: 'Trial PIN created: ' + pin });
});

app.get('/api/trials/list', adminKeyAuth, function(req, res) {
    var trialPins = readJSON(TRIAL_PINS_FILE);
    var now = new Date();
    trialPins.forEach(function(t) { if (t.status === 'active' && new Date(t.expiresAt) < now) t.status = 'expired'; });
    writeJSON(TRIAL_PINS_FILE, trialPins);
    var active = trialPins.filter(function(t) { return t.status === 'active'; }).length;
    var expired = trialPins.filter(function(t) { return t.status === 'expired'; }).length;
    res.json({ success: true, summary: { total: trialPins.length, active: active, expired: expired }, trials: trialPins });
});

app.post('/api/trials/extend/:id', adminKeyAuth, function(req, res) {
    var trialId = req.params.id;
    var extraDays = parseInt(req.body.days) || 7;
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var i = 0; i < trialPins.length; i++) {
        if (trialPins[i].id === trialId || trialPins[i].pin === trialId) {
            var trial = trialPins[i];
            var currentExpiry = new Date(trial.expiresAt);
            var now = new Date();
            var baseDate = currentExpiry < now ? now : currentExpiry;
            baseDate.setDate(baseDate.getDate() + extraDays);
            trial.expiresAt = baseDate.toISOString();
            trial.status = 'active';
            trial.bonusDaysReceived = (trial.bonusDaysReceived || 0) + extraDays;
            writeJSON(TRIAL_PINS_FILE, trialPins);
            console.log('⏰ Trial extended:', trial.facility, '| +' + extraDays + ' days');
            logActivity('trial_extended', trial.facility, trial.facility, 'Extended by ' + extraDays + ' days');
            return res.json({ success: true, trial: trial, message: 'Extended ' + trial.facility + ' by ' + extraDays + ' days' });
        }
    }
    res.status(404).json({ success: false, error: 'Trial not found' });
});

app.delete('/api/trials/delete/:id', adminKeyAuth, function(req, res) {
    var trialId = req.params.id;
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var i = 0; i < trialPins.length; i++) {
        if (trialPins[i].id === trialId || trialPins[i].pin === trialId) {
            var deleted = trialPins.splice(i, 1)[0];
            writeJSON(TRIAL_PINS_FILE, trialPins);
            console.log('🗑️ Trial deleted:', deleted.facility);
            logActivity('trial_deleted', deleted.facility, deleted.facility, 'Trial deleted');
            return res.json({ success: true, message: 'Deleted trial for ' + deleted.facility });
        }
    }
    res.status(404).json({ success: false, error: 'Trial not found' });
});

app.get('/api/subscribers/list', adminKeyAuth, function(req, res) {
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    var active = subscribers.filter(function(s) { return s.status === 'active'; }).length;
    var canceled = subscribers.filter(function(s) { return s.status === 'canceled'; }).length;
    res.json({ success: true, summary: { total: subscribers.length, active: active, canceled: canceled }, subscribers: subscribers.map(function(s) { return { email: s.email, pin: s.pin, status: s.status, plan_type: s.plan_type, quantity: s.quantity || 1, created_at: s.created_at, totalScore: s.totalScore || 0, streak: s.streak || 0, circuits: s.circuits || 0 }; }) });
});

app.get('/api/activity/list', adminKeyAuth, function(req, res) {
    var limit = parseInt(req.query.limit) || 100;
    var activities = readJSON(ACTIVITY_FILE).slice(0, limit);
    res.json({ success: true, count: activities.length, activities: activities });
});

// ============ STATIC ROUTES ============
app.get('/', function(req, res) { res.sendFile(path.join(__dirname, 'index.html')); });
app.get('/trial-pin', function(req, res) { res.sendFile(path.join(__dirname, 'trial-pin.html')); });
app.get('/how-to-play', function(req, res) { res.sendFile(path.join(__dirname, 'how-to-play.html')); });
app.get('/login', function(req, res) { res.sendFile(path.join(__dirname, 'login.html')); });
app.get('/faq', function(req, res) { res.sendFile(path.join(__dirname, 'faq.html')); });

// Dashboard redirect to home (no separate dashboard page needed)
app.get('/dashboard', function(req, res) { res.redirect(301, '/'); });
app.get('/dashboard.html', function(req, res) { res.redirect(301, '/'); });

// Ritnomes™
app.get('/the-recall', function(req, res) { res.sendFile(path.join(__dirname, 'the-recall.html')); });
app.get('/the-replay', function(req, res) { res.sendFile(path.join(__dirname, 'the-replay.html')); });
app.get('/the-reflex', function(req, res) { res.sendFile(path.join(__dirname, 'the-reflex.html')); });
app.get('/the-react', function(req, res) { res.sendFile(path.join(__dirname, 'the-react.html')); });
app.get('/the-reaction', function(req, res) { res.redirect(301, '/the-react'); });
app.get('/the-rhythm', function(req, res) { res.sendFile(path.join(__dirname, 'the-rhythm.html')); });

// Legacy redirects
app.get('/the-zoo', function(req, res) { res.redirect(301, '/the-rhythm'); });
app.get('/play', function(req, res) { res.redirect(301, '/'); });
app.get('/the-combo', function(req, res) { res.redirect(301, '/'); });
app.get('/the-starting-five', function(req, res) { res.sendFile(path.join(__dirname, 'the-starting-five.html')); });
app.get('/the-gotrotters', function(req, res) { res.redirect(301, '/the-starting-five'); });
app.get('/the-match', function(req, res) { res.redirect(301, '/the-recall'); });
app.get('/the-sequence', function(req, res) { res.redirect(301, '/the-replay'); });
app.get('/the-flash', function(req, res) { res.redirect(301, '/the-reflex'); });
app.get('/the-pocket', function(req, res) { res.redirect(301, '/the-react'); });
app.get('/the-echo', function(req, res) { res.redirect(301, '/the-rhythm'); });
app.get('/hub', function(req, res) { res.redirect(301, '/'); });

// ============ SUCCESS PAGE ============
app.get('/success', function(req, res) {
    var sessionId = req.query.session_id;
    var email = req.query.email;
    
    function renderPage(pin, userEmail, found) {
        var html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no"><title>Welcome! | RITNOME™</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet"><style>:root{--gold:#FFD700;--orange:#FF6B35;--teal:#00D9A5;--dark:#0a0a0f;--card:#111118;--text:#FFFFFF;--muted:#8892a0;--border:rgba(255,255,255,0.08)}*{margin:0;padding:0;box-sizing:border-box}body{font-family:"Outfit",sans-serif;background:var(--dark);color:var(--text);min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:20px}body.es .lang-en{display:none!important}body.en .lang-es{display:none!important}.lang-toggle{position:fixed;top:15px;right:15px;display:flex;gap:4px;background:var(--card);padding:3px;border-radius:8px;border:1px solid var(--border)}.lang-btn{padding:6px 10px;border:none;background:transparent;color:var(--muted);border-radius:6px;font-weight:600;font-size:.7rem;cursor:pointer;font-family:"Outfit",sans-serif;transition:all .2s}.lang-btn.active{background:var(--gold);color:var(--dark)}.container{width:100%;max-width:400px;text-align:center}.logo{font-family:"Bebas Neue",sans-serif;font-size:2.5rem;letter-spacing:4px;margin-bottom:5px}.logo .rit{color:var(--gold)}.logo .nome{color:var(--text)}.tagline{font-size:.7rem;color:var(--gold);letter-spacing:3px;text-transform:uppercase;margin-bottom:30px}.card{background:var(--card);border:2px solid var(--teal);border-radius:20px;padding:40px 30px;box-shadow:0 10px 40px rgba(0,217,165,0.2)}.celebration{font-size:2.5rem;margin-bottom:15px;animation:bounce .6s ease infinite}@keyframes bounce{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}.card-title{font-family:"Bebas Neue",sans-serif;font-size:1.8rem;letter-spacing:3px;margin-bottom:8px;color:var(--teal)}.card-subtitle{color:var(--muted);font-size:.9rem;margin-bottom:25px;line-height:1.5}.pin-reveal{background:linear-gradient(135deg,rgba(255,215,0,0.1),rgba(255,107,53,0.1));border:3px solid var(--gold);border-radius:16px;padding:25px;margin-bottom:25px;animation:celebrate .5s ease-out}@keyframes celebrate{0%{transform:scale(.8);opacity:0}50%{transform:scale(1.05)}100%{transform:scale(1);opacity:1}}.pin-label{font-size:.8rem;color:var(--muted);text-transform:uppercase;letter-spacing:2px;margin-bottom:10px}.pin-value{font-family:"Bebas Neue",sans-serif;font-size:3.5rem;letter-spacing:12px;color:var(--gold);text-shadow:0 0 30px rgba(255,215,0,0.5)}.btn{width:100%;padding:18px 30px;border:none;border-radius:50px;font-family:"Bebas Neue",sans-serif;font-size:1.3rem;letter-spacing:3px;cursor:pointer;transition:all .3s;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:10px;background:linear-gradient(135deg,var(--teal),#00CED1);color:var(--dark);box-shadow:0 8px 30px rgba(0,217,165,0.3)}.btn:hover{transform:translateY(-3px);box-shadow:0 12px 40px rgba(0,217,165,0.4)}.btn:disabled{opacity:.5;cursor:not-allowed;transform:none!important}.countdown{font-size:.85rem;color:var(--muted);margin-top:15px}.countdown span{color:var(--teal);font-weight:700}.error-card{border-color:#FF1744}.error-card .card-title{color:#FF1744}.btn-primary{background:linear-gradient(135deg,var(--gold),var(--orange));box-shadow:0 8px 30px rgba(255,107,53,0.3)}.footer{margin-top:40px;text-align:center}.footer-logo{font-family:"Bebas Neue",sans-serif;font-size:1.2rem;letter-spacing:3px;margin-bottom:8px}.footer-logo .rit{color:var(--gold)}.footer-company{font-size:.7rem;color:var(--muted)}.footer-company a{color:var(--gold);text-decoration:none}@media(max-width:480px){.logo{font-size:2rem}.card{padding:30px 20px}.pin-value{font-size:2.8rem;letter-spacing:10px}.btn{font-size:1.1rem;padding:16px 25px}}</style></head><body class="en"><div class="lang-toggle"><button class="lang-btn active" id="btnEn">EN</button><button class="lang-btn" id="btnEs">ES</button></div><div class="container"><div class="logo">🧠 <span class="rit">RIT</span><span class="nome">NOME</span></div><div class="tagline"><span class="lang-en">Recall · Replay · Reflex · React · Rhythm</span><span class="lang-es">Recuerdo · Repetición · Reflejo · Reacción · Ritmo</span></div>';
        
        if (found && pin) {
            html += '<div class="card" id="successCard"><div class="celebration">🎉🧠🎉</div><h1 class="card-title"><span class="lang-en">PAYMENT SUCCESSFUL!</span><span class="lang-es">¡PAGO EXITOSO!</span></h1><p class="card-subtitle"><span class="lang-en">Welcome to RITNOME! Here\'s your PIN!</span><span class="lang-es">¡Bienvenido a RITNOME! ¡Aquí está tu PIN!</span></p><div class="pin-reveal"><div class="pin-label"><span class="lang-en">YOUR PIN</span><span class="lang-es">TU PIN</span></div><div class="pin-value">' + pin + '</div></div><button class="btn" id="playBtn"><span class="lang-en">🧠 PLAY NOW</span><span class="lang-es">🧠 JUGAR AHORA</span></button><div class="countdown"><span class="lang-en">Auto-login in <span id="countEn">5</span> seconds...</span><span class="lang-es">Ingreso automático en <span id="countEs">5</span> segundos...</span></div></div>';
        } else {
            html += '<div class="card error-card"><div class="celebration">😕</div><h1 class="card-title"><span class="lang-en">ALMOST THERE!</span><span class="lang-es">¡CASI LISTO!</span></h1><p class="card-subtitle"><span class="lang-en">Use "Forgot PIN" with your email to get access.</span><span class="lang-es">Usa "Olvidé mi PIN" con tu correo para obtener acceso.</span></p><a href="/login" class="btn btn-primary"><span class="lang-en">GO TO LOGIN</span><span class="lang-es">IR A LOGIN</span></a></div>';
        }
        
        html += '<footer class="footer"><div class="footer-logo">🧠 <span class="rit">RIT</span><span class="nome">NOME</span></div><div class="footer-company">by <a href="https://gostar.digital">GoStar Digital LLC</a> 🇵🇷</div></footer></div><script>(function(){var lang=localStorage.getItem("lc-lang")||"en";document.body.className=lang;document.getElementById("btnEn").className=lang==="en"?"lang-btn active":"lang-btn";document.getElementById("btnEs").className=lang==="es"?"lang-btn active":"lang-btn";document.getElementById("btnEn").onclick=function(){localStorage.setItem("lc-lang","en");document.body.className="en";this.className="lang-btn active";document.getElementById("btnEs").className="lang-btn";};document.getElementById("btnEs").onclick=function(){localStorage.setItem("lc-lang","es");document.body.className="es";this.className="lang-btn active";document.getElementById("btnEn").className="lang-btn";};';
        
        if (found && pin) {
            html += 'var pin="' + pin + '";var countdown=5;var interval=setInterval(function(){countdown--;var cEn=document.getElementById("countEn");var cEs=document.getElementById("countEs");if(cEn)cEn.textContent=countdown;if(cEs)cEs.textContent=countdown;if(countdown<=0){clearInterval(interval);doLogin();}},1000);function doLogin(){var btn=document.getElementById("playBtn");if(btn)btn.disabled=true;fetch("/api/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({pin:pin})}).then(function(r){return r.json();}).then(function(data){if(data.success){localStorage.setItem("lc-user",JSON.stringify({pin:pin}));sessionStorage.setItem("lc-pin",pin);sessionStorage.setItem("lc-token",data.token);localStorage.setItem("lc-terms-accepted",new Date().toISOString());fetch("/api/user/speed-access/"+pin).then(function(r){return r.json();}).then(function(speedData){localStorage.setItem("lc-speed-access",JSON.stringify(speedData));window.location.href="/";}).catch(function(){window.location.href="/";});}else{window.location.href="/login";}}).catch(function(){window.location.href="/login";});}var playBtn=document.getElementById("playBtn");if(playBtn)playBtn.onclick=function(){clearInterval(interval);doLogin();};';
        }
        
        html += '})();</script></body></html>';
        res.send(html);
    }
    
    function lookupByEmail(email) {
        if (!email) return { found: false };
        email = email.toLowerCase().trim();
        var subscribers = readJSON(SUBSCRIBERS_FILE);
        for (var i = 0; i < subscribers.length; i++) {
            if (subscribers[i].email && subscribers[i].email.toLowerCase() === email) {
                console.log('✅ Success page - Found PIN for:', email);
                logActivity('success_page', email, null, 'Post-payment success page viewed');
                return { found: true, pin: subscribers[i].pin, email: subscribers[i].email };
            }
        }
        return { found: false };
    }
    
    if (sessionId && stripe) {
        stripe.checkout.sessions.retrieve(sessionId).then(function(session) {
            var customerEmail = session.customer_email || (session.customer_details && session.customer_details.email);
            console.log('📧 Stripe session email:', customerEmail);
            if (customerEmail) {
                var result = lookupByEmail(customerEmail);
                renderPage(result.pin, customerEmail, result.found);
            } else {
                renderPage(null, null, false);
            }
        }).catch(function(err) {
            console.log('⚠️ Stripe session lookup error:', err.message);
            renderPage(null, null, false);
        });
    } else if (email) {
        var result = lookupByEmail(email);
        renderPage(result.pin, email, result.found);
    } else {
        renderPage(null, null, false);
    }
});

// ============ HEY BORI: CHAT API (BORI AI) ============
app.post('/api/chat', async function(req, res) {
    if (!ANTHROPIC_API_KEY) {
        return res.status(500).json({ error: 'Bori AI not configured' });
    }
    try {
        const { model, max_tokens, system, messages } = req.body;
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: model || 'claude-sonnet-4-20250514',
                max_tokens: max_tokens || 1000,
                system: system || '',
                messages: messages || []
            })
        });
        const data = await response.json();
        res.json(data);
    } catch (err) {
        console.log('❌ Bori AI error:', err.message);
        res.status(500).json({ error: 'Error de conexión con Bori AI' });
    }
});

// ============ HEY BORI: SUBSCRIPTION ============
app.post('/api/subscribe/:plan', function(req, res) {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
    var plan = req.params.plan;
    var priceId = STRIPE_PRICES[plan];
    if (!priceId) return res.status(400).json({ error: 'Plan inválido' });
    
    var host = req.headers.host || 'heybori.com';
    var protocol = req.headers['x-forwarded-proto'] || 'https';
    var baseUrl = protocol + '://' + host;
    
    stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: baseUrl + '/?payment=success&plan=' + plan,
        cancel_url: baseUrl + '/?payment=cancel',
        allow_promotion_codes: true
    }).then(function(session) {
        res.json({ url: session.url });
    }).catch(function(err) {
        console.log('❌ Stripe error:', err.message);
        res.status(500).json({ error: 'Error creando suscripción' });
    });
});

app.post('/api/subscription/portal', function(req, res) {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
    var phone = (req.body.phone || '').replace(/[^0-9]/g, '');
    if (!phone) return res.status(400).json({ error: 'Número requerido' });
    
    // Look up customer by phone in subscribers or family data
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    var sub = subscribers.find(function(s) { return s.phone === phone; });
    
    if (!sub || !sub.stripeCustomerId) {
        return res.json({ error: 'No se encontró suscripción con este número' });
    }
    
    var host = req.headers.host || 'heybori.com';
    var protocol = req.headers['x-forwarded-proto'] || 'https';
    var baseUrl = protocol + '://' + host;
    
    stripe.billingPortal.sessions.create({
        customer: sub.stripeCustomerId,
        return_url: baseUrl + '/'
    }).then(function(session) {
        res.json({ url: session.url });
    }).catch(function(err) {
        console.log('❌ Portal error:', err.message);
        res.status(500).json({ error: 'Error abriendo portal' });
    });
});

// ============ HEY BORI: ACTIVITY TRACKING ============
app.post('/api/activity', function(req, res) {
    try {
        var activities = readJSON(ACTIVITY_FILE);
        var entry = {
            userId: req.body.userId || 'anon',
            event: req.body.event || 'unknown',
            detail: req.body.detail || {},
            name: req.body.name || '',
            timestamp: new Date().toISOString()
        };
        activities.push(entry);
        // Keep last 10000 entries
        if (activities.length > 10000) activities = activities.slice(-10000);
        writeJSON(ACTIVITY_FILE, activities);
        res.json({ ok: true });
    } catch (err) {
        res.json({ ok: false });
    }
});

// ============ HEY BORI: FAMILY SYSTEM ============
app.post('/api/family/setup', function(req, res) {
    try {
        var families = JSON.parse(fs.readFileSync(FAMILY_FILE, 'utf8'));
        var userId = req.body.userId;
        var name = req.body.name;
        var familyPin = req.body.familyPin;
        
        if (!userId || !name || !familyPin) {
            return res.json({ error: 'Datos incompletos' });
        }
        
        families[userId] = {
            name: name,
            familyPin: familyPin,
            createdAt: new Date().toISOString()
        };
        
        fs.writeFileSync(FAMILY_FILE, JSON.stringify(families, null, 2));
        res.json({ ok: true });
    } catch (err) {
        console.log('❌ Family setup error:', err.message);
        res.json({ error: 'Error guardando configuración' });
    }
});

app.post('/api/family/dashboard', function(req, res) {
    try {
        var families = JSON.parse(fs.readFileSync(FAMILY_FILE, 'utf8'));
        var userId = req.body.userId;
        var familyPin = req.body.familyPin;
        
        var family = families[userId];
        if (!family || family.familyPin !== familyPin) {
            return res.json({ error: 'PIN incorrecto o usuario no encontrado' });
        }
        
        // Get activity data for this user
        var activities = readJSON(ACTIVITY_FILE);
        var userActivities = activities.filter(function(a) { return a.userId === userId; });
        
        var now = new Date();
        var todayStr = now.toISOString().split('T')[0];
        
        // Today's stats
        var todayActs = userActivities.filter(function(a) { return a.timestamp && a.timestamp.startsWith(todayStr); });
        var todayChats = todayActs.filter(function(a) { return a.event === 'chat'; }).length;
        var todayGames = todayActs.filter(function(a) { return a.event === 'game'; }).length;
        var todayBadges = todayActs.filter(function(a) { return a.event === 'badge'; });
        var lastActive = todayActs.length > 0 ? todayActs[todayActs.length - 1].timestamp : null;
        
        // Week data
        var week = [];
        for (var d = 6; d >= 0; d--) {
            var date = new Date(now);
            date.setDate(date.getDate() - d);
            var dateStr = date.toISOString().split('T')[0];
            var dayActs = userActivities.filter(function(a) { return a.timestamp && a.timestamp.startsWith(dateStr); });
            var dayBadges = dayActs.filter(function(a) { return a.event === 'badge'; }).map(function(a) { return a.detail; });
            week.push({
                date: dateStr,
                active: dayActs.length > 0,
                chats: dayActs.filter(function(a) { return a.event === 'chat'; }).length,
                games: dayActs.filter(function(a) { return a.event === 'game'; }).length,
                badges: dayBadges
            });
        }
        
        // Totals
        var totalChats = userActivities.filter(function(a) { return a.event === 'chat'; }).length;
        var totalGames = userActivities.filter(function(a) { return a.event === 'game'; }).length;
        var activeDays = new Set(userActivities.map(function(a) { return a.timestamp ? a.timestamp.split('T')[0] : ''; }));
        activeDays.delete('');
        
        // Streak calculation
        var streak = 0;
        var checkDate = new Date(now);
        while (true) {
            var checkStr = checkDate.toISOString().split('T')[0];
            if (activeDays.has(checkStr)) {
                streak++;
                checkDate.setDate(checkDate.getDate() - 1);
            } else {
                break;
            }
        }
        
        res.json({
            name: family.name,
            today: {
                active: todayActs.length > 0,
                lastActive: lastActive,
                chats: todayChats,
                games: todayGames,
                badges: todayBadges.map(function(b) { return b.detail || {}; })
            },
            week: week,
            streak: streak,
            totals: {
                chats: totalChats,
                games: totalGames,
                daysActive: activeDays.size
            }
        });
    } catch (err) {
        console.log('❌ Family dashboard error:', err.message);
        res.json({ error: 'Error cargando datos' });
    }
});

// ============ HEALTH & VERSION ============
app.get('/health', function(req, res) { res.json({ status: 'healthy', timestamp: new Date().toISOString(), version: PLATFORM_VERSION }); });

app.get('/api/platform/version', function(req, res) { res.json({ version: PLATFORM_VERSION, versionName: PLATFORM_VERSION_NAME, ritnomes: 5, divisions: 150, levels: 10, speeds: ['SLOW', 'MED', 'FAST'] }); });

// ============ START SERVER ============
app.listen(PORT, function() {
    console.log('');
    console.log('🇵🇷 ========================================');
    console.log('   HEY BORI v' + PLATFORM_VERSION);
    console.log('   ' + PLATFORM_VERSION_NAME);
    console.log('==========================================');
    console.log('');
    console.log('📍 Port:', PORT);
    console.log('💳 Stripe:', stripe ? '✅ Configured' : '❌ Not configured');
    console.log('🤖 Bori AI:', ANTHROPIC_API_KEY ? '✅ Configured' : '❌ Not configured');
    console.log('🔐 Admin Key:', ADMIN_SECRET_KEY ? '✅ Set' : '⚠️ Using default');
    console.log('');
    console.log('🏠 HEY BORI:');
    console.log('   /                 → Hey Bori (Home)');
    console.log('   /login            → PIN Login');
    console.log('');
    console.log('🎮 RITNOME™ GAMES:');
    console.log('   /the-recall       → THE RECALL (Memoria)');
    console.log('   /the-replay       → THE REPLAY (Secuencia)');
    console.log('   /the-reflex       → THE REFLEX (Posición)');
    console.log('   /the-react        → THE REACT (Reacción)');
    console.log('   /the-rhythm       → THE RHYTHM (Ritmo)');
    console.log('');
    console.log('🇵🇷 Hey Bori — Tu Compañera Boricua');
    console.log('');
});