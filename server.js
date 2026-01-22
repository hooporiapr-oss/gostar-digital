const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ PLATFORM VERSION ============
const PLATFORM_VERSION = '2.0.0';
const PLATFORM_VERSION_NAME = 'GoTrotter - The LaughCourt';

// ============ ADMIN SECRET KEY ============
// Use this for trial PIN management (replaces dashboard)
// Set in environment: ADMIN_SECRET_KEY=your-super-secret-key-here
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || 'GoTrotter2026!';

// ============ SESSION LOCKOUT SYSTEM ============
const activeSessions = new Map();
const SESSION_TIMEOUT_MS = 2 * 60 * 1000;

// ============ STRIPE SETUP ============
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const STRIPE_PRICES = {
    individual_monthly: process.env.STRIPE_PRICE_INDIVIDUAL_MONTHLY
};

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

// Ensure data directory and files exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(SUBSCRIBERS_FILE)) fs.writeFileSync(SUBSCRIBERS_FILE, '[]');
if (!fs.existsSync(TRIAL_PINS_FILE)) fs.writeFileSync(TRIAL_PINS_FILE, '[]');
if (!fs.existsSync(ACTIVITY_FILE)) fs.writeFileSync(ACTIVITY_FILE, '[]');

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

// ============ ADMIN SECRET KEY AUTH ============
function adminKeyAuth(req, res, next) {
    var key = req.headers['x-admin-key'];
    if (key === ADMIN_SECRET_KEY) {
        return next();
    }
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

// ============ STRIPE WEBHOOK (MUST BE BEFORE express.json()) ============
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
    
    // Check if subscriber already exists
    var existingIndex = -1;
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].email === email) {
            existingIndex = i;
            break;
        }
    }
    
    var pin;
    
    if (existingIndex === -1) {
        // NEW SUBSCRIBER
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
        // RETURNING SUBSCRIBER - reactivate
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
    
    // ⭐ SAVE PIN TO STRIPE CUSTOMER METADATA (visible in Stripe Dashboard!)
    if (stripe && session.customer) {
        stripe.customers.update(session.customer, {
            metadata: {
                gotrotter_pin: pin,
                plan_type: planType,
                quantity: String(quantity)
            }
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
    
    var baseUrl = process.env.SITE_URL || 'https://gotrotter.ai';
    
    stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{
            price: priceId,
            quantity: 1,
            adjustable_quantity: { enabled: true, minimum: 1, maximum: 50 }
        }],
        allow_promotion_codes: true,
        success_url: baseUrl + '/?success=true&session_id={CHECKOUT_SESSION_ID}',
        cancel_url: baseUrl + '/?canceled=true',
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
    
    // Check subscribers
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
    
    // Check trial PINs
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
                trialInfo: {
                    facility: trial.facility,
                    expiresAt: trial.expiresAt,
                    daysLeft: Math.max(0, daysLeft),
                    currentUsers: trial.currentUsers || 0,
                    maxUsers: trial.maxUsers
                }
            });
        }
    }
    
    return res.json({ subscribed: false, status: null });
});

// ============ SUBSCRIBER LOGIN ============
app.post('/api/subscriber/login', function(req, res) {
    var pin = req.body.pin;
    if (!pin) return res.status(400).json({ error: 'PIN is required' });
    
    // Check subscribers
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
            var isActive = subscribers[i].status === 'active' || subscribers[i].status === 'trialing';
            if (!isActive) return res.status(401).json({ error: 'Subscription not active' });
            
            logActivity('subscriber_login', subscribers[i].email, null, 'GoTrotter logged in');
            return res.json({
                success: true,
                email: subscribers[i].email,
                pin: pin,
                plan: subscribers[i].plan_type,
                status: subscribers[i].status,
                quantity: subscribers[i].quantity || 1
            });
        }
    }
    
    // Check trial PINs
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var k = 0; k < trialPins.length; k++) {
        if (trialPins[k].pin === pin) {
            var trial = trialPins[k];
            
            if (new Date(trial.expiresAt) < new Date()) {
                trial.status = 'expired';
                writeJSON(TRIAL_PINS_FILE, trialPins);
                return res.status(401).json({ error: 'Trial has expired' });
            }
            
            if ((trial.currentUsers || 0) >= trial.maxUsers) {
                return res.status(401).json({ error: 'Trial user limit reached' });
            }
            
            // Track device
            var deviceId = req.headers['x-device-id'] || req.ip || 'unknown';
            if (!trial.devices) trial.devices = [];
            if (trial.devices.indexOf(deviceId) === -1) {
                trial.devices.push(deviceId);
                trial.currentUsers = trial.devices.length;
                writeJSON(TRIAL_PINS_FILE, trialPins);
            }
            
            var daysLeft = Math.ceil((new Date(trial.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
            
            return res.json({
                success: true,
                email: trial.facility,
                pin: pin,
                plan: 'facility_trial',
                status: 'trialing',
                is_facility_trial: true,
                trialInfo: {
                    facility: trial.facility,
                    expiresAt: trial.expiresAt,
                    daysLeft: Math.max(0, daysLeft),
                    currentUsers: trial.currentUsers,
                    maxUsers: trial.maxUsers
                }
            });
        }
    }
    
    return res.status(401).json({ error: 'Invalid PIN' });
});

// ============ SESSION API ============
app.post('/api/session/create', function(req, res) {
    var pin = req.body.pin;
    if (!pin) return res.status(400).json({ success: false, error: 'PIN required' });
    
    var isValidPin = false, userType = null, maxConcurrent = 1, userInfo = {};
    
    // Check subscribers
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
            var isActive = subscribers[i].status === 'active' || subscribers[i].status === 'trialing';
            if (!isActive) return res.status(401).json({ success: false, error: 'Subscription not active' });
            
            isValidPin = true;
            userType = 'subscriber';
            maxConcurrent = subscribers[i].quantity || 1;
            userInfo = { email: subscribers[i].email, plan: subscribers[i].plan_type };
            break;
        }
    }
    
    // Check trial PINs
    if (!isValidPin) {
        var trialPins = readJSON(TRIAL_PINS_FILE);
        for (var k = 0; k < trialPins.length; k++) {
            if (trialPins[k].pin === pin) {
                if (new Date(trialPins[k].expiresAt) < new Date()) {
                    return res.status(401).json({ success: false, error: 'Trial expired' });
                }
                
                isValidPin = true;
                userType = 'facility_trial';
                maxConcurrent = trialPins[k].maxUsers || 50;
                userInfo = { facility: trialPins[k].facility };
                break;
            }
        }
    }
    
    if (!isValidPin) return res.status(401).json({ success: false, error: 'Invalid PIN' });
    
    var result = createSession(pin, maxConcurrent);
    
    if (result.error === 'limit_reached') {
        logActivity('session_blocked', pin, userInfo.facility || null, 'Session blocked: ' + result.current + '/' + result.max);
        return res.status(403).json({
            success: false,
            error: 'limit_reached',
            message: 'All ' + result.max + ' seats in use.',
            current: result.current,
            max: result.max
        });
    }
    
    logActivity('session_created', pin, userInfo.facility || null, 'Session started (' + result.current + '/' + result.max + ')');
    res.json({
        success: true,
        token: result.token,
        userType: userType,
        maxConcurrent: result.max,
        activeSessions: result.current
    });
});

app.post('/api/session/validate', function(req, res) {
    var pin = req.body.pin, token = req.body.token;
    if (!pin || !token) return res.status(400).json({ valid: false, error: 'PIN and token required' });
    
    var result = validateSession(pin, token);
    
    if (!result.valid) {
        var message = result.reason === 'token_invalid' ? 'Another device is using this account' :
                      result.reason === 'expired' ? 'Session timed out' : 'Session not found';
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

// ============ SPEED ACCESS ============
app.get('/api/user/speed-access/:pin', function(req, res) {
    var pin = req.params.pin;
    
    // Check subscribers - full access
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
            return res.json({
                allSpeeds: subscribers[i].status === 'active',
                userType: 'subscriber',
                status: subscribers[i].status,
                plan: subscribers[i].plan_type
            });
        }
    }
    
    // Check trial PINs - SLOW only
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var k = 0; k < trialPins.length; k++) {
        if (trialPins[k].pin === pin) {
            var trial = trialPins[k];
            var isExpired = new Date(trial.expiresAt) < new Date();
            var daysLeft = Math.ceil((new Date(trial.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
            
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
    
    // Check subscribers
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
            
            // Streak logic
            var today = new Date().toISOString().split('T')[0];
            if (!sub.lastStreakDate) {
                sub.streak = 1;
                sub.lastStreakDate = today;
            } else if (sub.lastStreakDate !== today) {
                var diff = Math.floor((new Date(today) - new Date(sub.lastStreakDate)) / 86400000);
                sub.streak = diff === 1 ? (sub.streak || 0) + 1 : 1;
                sub.lastStreakDate = today;
            }
            
            writeJSON(SUBSCRIBERS_FILE, subscribers);
            logActivity('game_session', sub.email, null, 'L' + level + ' ' + speed + ' | Score +' + score, { score: score, level: level });
            
            return res.json({
                success: true,
                streak: sub.streak,
                circuits: sub.circuits,
                totalScore: sub.totalScore
            });
        }
    }
    
    // Check trial PINs
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
            return res.json({
                success: true,
                username: sub.email.split('@')[0],
                stats: {
                    level: (sub.stats && sub.stats.level) || 1,
                    speed: (sub.stats && sub.stats.speed) || 'slow',
                    bestScore: (sub.stats && sub.stats.bestScore) || 0,
                    totalCircuits: (sub.stats && sub.stats.totalCircuits) || 0,
                    totalScore: sub.totalScore || 0,
                    streak: sub.streak || 0,
                    circuits: sub.circuits || 0
                }
            });
        }
    }
    
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var k = 0; k < trialPins.length; k++) {
        if (trialPins[k].pin === pin) {
            return res.json({
                success: true,
                username: trialPins[k].facility,
                stats: { level: 1, speed: 'slow', bestScore: 0, totalCircuits: 0, totalScore: 0, streak: 0, circuits: 0 }
            });
        }
    }
    
    return res.status(404).json({ error: 'Not found' });
});

// ============================================================
// TRIAL PIN MANAGEMENT (Protected by Admin Secret Key)
// ============================================================

// CREATE TRIAL PIN
// curl -X POST https://yoursite.com/api/trials/create -H "X-Admin-Key: YOUR_KEY" -H "Content-Type: application/json" -d '{"facility":"Rehab Center","maxUsers":50,"days":7}'
app.post('/api/trials/create', adminKeyAuth, function(req, res) {
    var facility = req.body.facility;
    var maxUsers = parseInt(req.body.maxUsers) || 50;
    var days = parseInt(req.body.days) || 7;
    var notes = req.body.notes || '';
    
    if (!facility) {
        return res.status(400).json({ success: false, error: 'Facility name required' });
    }
    
    var trialPins = readJSON(TRIAL_PINS_FILE);
    var pin = generateUserPin();
    
    var expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);
    
    var newTrial = {
        id: 'trial_' + Date.now(),
        pin: pin,
        facility: facility.trim(),
        maxUsers: maxUsers,
        currentUsers: 0,
        devices: [],
        status: 'active',
        notes: notes,
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString(),
        bonusDaysReceived: 0
    };
    
    trialPins.push(newTrial);
    writeJSON(TRIAL_PINS_FILE, trialPins);
    
    console.log('🎫 Trial created:', facility, '| PIN:', pin, '| Users:', maxUsers, '| Days:', days);
    logActivity('trial_created', facility, facility, 'Created PIN: ' + pin + ' | ' + maxUsers + ' users | ' + days + ' days');
    
    res.json({
        success: true,
        trial: newTrial,
        message: 'Trial PIN created: ' + pin
    });
});

// LIST ALL TRIALS
// curl -X GET https://yoursite.com/api/trials/list -H "X-Admin-Key: YOUR_KEY"
app.get('/api/trials/list', adminKeyAuth, function(req, res) {
    var trialPins = readJSON(TRIAL_PINS_FILE);
    var now = new Date();
    
    // Auto-expire trials
    trialPins.forEach(function(t) {
        if (t.status === 'active' && new Date(t.expiresAt) < now) {
            t.status = 'expired';
        }
    });
    writeJSON(TRIAL_PINS_FILE, trialPins);
    
    var active = trialPins.filter(function(t) { return t.status === 'active'; }).length;
    var expired = trialPins.filter(function(t) { return t.status === 'expired'; }).length;
    
    res.json({
        success: true,
        summary: { total: trialPins.length, active: active, expired: expired },
        trials: trialPins
    });
});

// EXTEND TRIAL
// curl -X POST https://yoursite.com/api/trials/extend/trial_123 -H "X-Admin-Key: YOUR_KEY" -H "Content-Type: application/json" -d '{"days":7}'
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
            
            return res.json({
                success: true,
                trial: trial,
                message: 'Extended ' + trial.facility + ' by ' + extraDays + ' days'
            });
        }
    }
    
    res.status(404).json({ success: false, error: 'Trial not found' });
});

// DELETE TRIAL
// curl -X DELETE https://yoursite.com/api/trials/delete/trial_123 -H "X-Admin-Key: YOUR_KEY"
app.delete('/api/trials/delete/:id', adminKeyAuth, function(req, res) {
    var trialId = req.params.id;
    var trialPins = readJSON(TRIAL_PINS_FILE);
    
    for (var i = 0; i < trialPins.length; i++) {
        if (trialPins[i].id === trialId || trialPins[i].pin === trialId) {
            var deleted = trialPins.splice(i, 1)[0];
            writeJSON(TRIAL_PINS_FILE, trialPins);
            
            console.log('🗑️ Trial deleted:', deleted.facility);
            logActivity('trial_deleted', deleted.facility, deleted.facility, 'Trial deleted');
            
            return res.json({
                success: true,
                message: 'Deleted trial for ' + deleted.facility
            });
        }
    }
    
    res.status(404).json({ success: false, error: 'Trial not found' });
});

// ============================================================
// SUBSCRIBER MANAGEMENT (Protected by Admin Secret Key)
// ============================================================

// LIST ALL SUBSCRIBERS
// curl -X GET https://yoursite.com/api/subscribers/list -H "X-Admin-Key: YOUR_KEY"
app.get('/api/subscribers/list', adminKeyAuth, function(req, res) {
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    
    var active = subscribers.filter(function(s) { return s.status === 'active'; }).length;
    var canceled = subscribers.filter(function(s) { return s.status === 'canceled'; }).length;
    
    res.json({
        success: true,
        summary: { total: subscribers.length, active: active, canceled: canceled },
        subscribers: subscribers.map(function(s) {
            return {
                email: s.email,
                pin: s.pin,
                status: s.status,
                plan_type: s.plan_type,
                quantity: s.quantity || 1,
                created_at: s.created_at,
                totalScore: s.totalScore || 0,
                streak: s.streak || 0,
                circuits: s.circuits || 0
            };
        })
    });
});

// GET ACTIVITY LOG
// curl -X GET https://yoursite.com/api/activity/list -H "X-Admin-Key: YOUR_KEY"
app.get('/api/activity/list', adminKeyAuth, function(req, res) {
    var limit = parseInt(req.query.limit) || 100;
    var activities = readJSON(ACTIVITY_FILE).slice(0, limit);
    res.json({ success: true, count: activities.length, activities: activities });
});

// ============ STATIC ROUTES ============
app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/trial-pin', function(req, res) {
    res.sendFile(path.join(__dirname, 'trial-pin.html'));
});

app.get('/play', function(req, res) {
    res.sendFile(path.join(__dirname, 'gotrotter.html'));
});

app.get('/hub', function(req, res) {
    res.sendFile(path.join(__dirname, 'trotter-hub.html'));
});

// ============ HEALTH & VERSION ============
app.get('/health', function(req, res) {
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: PLATFORM_VERSION
    });
});

app.get('/api/platform/version', function(req, res) {
    res.json({
        version: PLATFORM_VERSION,
        versionName: PLATFORM_VERSION_NAME,
        game: 'GOTROTTER',
        divisions: 15,
        levels: 5,
        speeds: ['SLOW', 'MED', 'FAST']
    });
});

// ============ START SERVER ============
app.listen(PORT, function() {
    console.log('');
    console.log('🏀 ========================================');
    console.log('   GOTROTTER SERVER v' + PLATFORM_VERSION);
    console.log('   ' + PLATFORM_VERSION_NAME);
    console.log('==========================================');
    console.log('');
    console.log('📍 Port:', PORT);
    console.log('💳 Stripe:', stripe ? '✅ Configured' : '❌ Not configured');
    console.log('🔐 Admin Key:', ADMIN_SECRET_KEY ? '✅ Set' : '⚠️ Using default');
    console.log('');
    console.log('🎯 ROUTES:');
    console.log('   /           → Landing page');
    console.log('   /hub        → User hub');
    console.log('   /play       → Game');
    console.log('   /trial-pin  → Trial PIN Generator');
    console.log('');
    console.log('🔧 ADMIN ENDPOINTS (use X-Admin-Key header):');
    console.log('   POST /api/trials/create    → Create trial PIN');
    console.log('   GET  /api/trials/list      → List all trials');
    console.log('   POST /api/trials/extend/:id → Extend trial');
    console.log('   DELETE /api/trials/delete/:id → Delete trial');
    console.log('   GET  /api/subscribers/list → List subscribers');
    console.log('   GET  /api/activity/list    → View activity');
    console.log('');
    console.log('🏀 Ready to play!');
    console.log('');
});
