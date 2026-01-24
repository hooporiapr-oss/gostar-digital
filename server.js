const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ PLATFORM VERSION ============
const PLATFORM_VERSION = '2.2.0';
const PLATFORM_VERSION_NAME = 'LaughCourt™ - Where Joy Meets The Game';

// ============ ADMIN SECRET KEY ============
// Use this for trial PIN management (replaces dashboard)
// Set in environment: ADMIN_SECRET_KEY=your-super-secret-key-here
const ADMIN_SECRET_KEY = process.env.ADMIN_SECRET_KEY || 'LaughCourt2026!';

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
                laughcourt_pin: pin,
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
    
    var baseUrl = process.env.SITE_URL || 'https://laughcourt.com';
    
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

// ============================================================
// UNIFIED LOGIN ENDPOINT (validates PIN + creates session)
// ============================================================
app.post('/api/login', function(req, res) {
    var pin = req.body.pin;
    if (!pin) return res.status(400).json({ success: false, error: 'PIN is required' });
    
    var isValidPin = false;
    var userType = null;
    var maxConcurrent = 1;
    var userInfo = {};
    
    // Check subscribers
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
            var isActive = subscribers[i].status === 'active' || subscribers[i].status === 'trialing';
            if (!isActive) {
                return res.status(401).json({ success: false, error: 'Subscription not active. Please renew.' });
            }
            
            isValidPin = true;
            userType = 'subscriber';
            maxConcurrent = subscribers[i].quantity || 1;
            userInfo = {
                email: subscribers[i].email,
                plan: subscribers[i].plan_type,
                status: subscribers[i].status
            };
            break;
        }
    }
    
    // Check trial PINs
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
                userInfo = {
                    facility: trial.facility,
                    status: 'trialing',
                    daysLeft: Math.max(0, daysLeft)
                };
                break;
            }
        }
    }
    
    if (!isValidPin) {
        logActivity('login_failed', pin, null, 'Invalid PIN attempt');
        return res.status(401).json({ success: false, error: 'Invalid PIN' });
    }
    
    // Create session
    var sessionResult = createSession(pin, maxConcurrent);
    
    if (sessionResult.error === 'limit_reached') {
        logActivity('login_blocked', pin, userInfo.facility || null, 'All seats in use: ' + sessionResult.current + '/' + sessionResult.max);
        return res.status(403).json({
            success: false,
            error: 'All ' + sessionResult.max + ' seats are currently in use. Please try again later.'
        });
    }
    
    logActivity('login_success', userInfo.email || userInfo.facility, userInfo.facility || null, 'Logged in (' + sessionResult.current + '/' + sessionResult.max + ' seats)');
    
    res.json({
        success: true,
        token: sessionResult.token,
        userType: userType,
        userInfo: userInfo,
        activeSessions: sessionResult.current,
        maxSessions: sessionResult.max
    });
});

// ============================================================
// FORGOT PIN ENDPOINT (instant PIN reveal)
// ============================================================
app.post('/api/forgot-pin', function(req, res) {
    var email = req.body.email;
    if (!email || !email.includes('@')) {
        return res.status(400).json({ success: false, error: 'Valid email required' });
    }
    
    email = email.toLowerCase().trim();
    
    // Look up subscriber by email
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
        
        // Check if subscription is active
        var isActive = foundSubscriber.status === 'active' || foundSubscriber.status === 'trialing';
        
        return res.json({
            success: true,
            found: true,
            pin: foundSubscriber.pin,
            email: foundSubscriber.email,
            status: foundSubscriber.status,
            isActive: isActive,
            message: isActive ? 'Welcome back to LaughCourt!' : 'Subscription not active. Please renew.'
        });
    }
    
    // Check trial PINs by facility name (in case they entered facility name as email)
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var k = 0; k < trialPins.length; k++) {
        if (trialPins[k].facility && trialPins[k].facility.toLowerCase() === email) {
            var trial = trialPins[k];
            var isExpired = new Date(trial.expiresAt) < new Date();
            
            console.log('🔑 Trial PIN recovered for facility:', trial.facility);
            logActivity('pin_recovered', trial.facility, trial.facility, 'Trial PIN retrieved');
            
            return res.json({
                success: true,
                found: true,
                pin: trial.pin,
                email: trial.facility,
                status: isExpired ? 'expired' : 'trialing',
                isActive: !isExpired,
                isTrial: true,
                message: isExpired ? 'Trial has expired.' : 'Welcome back!'
            });
        }
    }
    
    // Email not found
    console.log('❌ PIN recovery failed - email not found:', email);
    logActivity('pin_recovery_failed', email, null, 'Email not found');
    
    return res.json({
        success: true,
        found: false,
        message: 'No account found with this email. Start your free trial!'
    });
});

// ============ SUBSCRIBER LOGIN (legacy - kept for compatibility) ============
app.post('/api/subscriber/login', function(req, res) {
    var pin = req.body.pin;
    if (!pin) return res.status(400).json({ error: 'PIN is required' });
    
    // Check subscribers
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
            var isActive = subscribers[i].status === 'active' || subscribers[i].status === 'trialing';
            if (!isActive) return res.status(401).json({ error: 'Subscription not active' });
            
            logActivity('subscriber_login', subscribers[i].email, null, 'LaughCourt user logged in');
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

// ============ NOTIFICATIONS ============
app.get('/api/notifications/:pin', function(req, res) {
    // Placeholder for notification system
    // Can be expanded to pull from a notifications file/database
    res.json({ success: true, notifications: [] });
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

app.get('/how-to-play', function(req, res) {
    res.sendFile(path.join(__dirname, 'how-to-play.html'));
});

app.get('/the-sequence', function(req, res) {
    res.sendFile(path.join(__dirname, 'the-sequence.html'));
});

app.get('/play', function(req, res) {
    res.sendFile(path.join(__dirname, 'play.html'));
});

app.get('/the-match', function(req, res) {
    res.sendFile(path.join(__dirname, 'the-match.html'));
});

app.get('/the-starting-five', function(req, res) {
    res.sendFile(path.join(__dirname, 'the-starting-five.html'));
});

// Legacy route redirect
app.get('/the-gotrotters', function(req, res) {
    res.redirect(301, '/the-starting-five');
});

app.get('/hub', function(req, res) {
    res.sendFile(path.join(__dirname, 'trotter-hub.html'));
});

app.get('/login', function(req, res) {
    res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/faq', function(req, res) {
    res.sendFile(path.join(__dirname, 'faq.html'));
});

// ============ SUCCESS PAGE (Post-Stripe Payment) ============
app.get('/success', function(req, res) {
    var sessionId = req.query.session_id;
    var email = req.query.email;
    
    // Function to render the page
    function renderPage(pin, userEmail, found) {
        var html = '<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'    <meta charset="UTF-8">\n' +
'    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">\n' +
'    <title>Welcome! | LaughCourt</title>\n' +
'    <link rel="preconnect" href="https://fonts.googleapis.com">\n' +
'    <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">\n' +
'    <style>\n' +
'        :root { --gold: #FFD700; --orange: #FF6B35; --teal: #00D9A5; --dark: #0a0a0f; --card: #111118; --text: #FFFFFF; --muted: #8892a0; --border: rgba(255,255,255,0.08); }\n' +
'        * { margin: 0; padding: 0; box-sizing: border-box; }\n' +
'        body { font-family: "Outfit", sans-serif; background: var(--dark); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 20px; }\n' +
'        body.es .lang-en { display: none !important; }\n' +
'        body.en .lang-es { display: none !important; }\n' +
'        .lang-toggle { position: fixed; top: 15px; right: 15px; display: flex; gap: 4px; background: var(--card); padding: 3px; border-radius: 8px; border: 1px solid var(--border); }\n' +
'        .lang-btn { padding: 6px 10px; border: none; background: transparent; color: var(--muted); border-radius: 6px; font-weight: 600; font-size: 0.7rem; cursor: pointer; font-family: "Outfit", sans-serif; transition: all 0.2s; }\n' +
'        .lang-btn.active { background: var(--gold); color: var(--dark); }\n' +
'        .container { width: 100%; max-width: 400px; text-align: center; }\n' +
'        .logo { font-family: "Bebas Neue", sans-serif; font-size: 2.5rem; letter-spacing: 4px; margin-bottom: 5px; }\n' +
'        .logo .laugh { color: var(--gold); }\n' +
'        .logo .court { color: var(--text); }\n' +
'        .tagline { font-size: 0.7rem; color: var(--gold); letter-spacing: 3px; text-transform: uppercase; margin-bottom: 30px; }\n' +
'        .card { background: var(--card); border: 2px solid var(--teal); border-radius: 20px; padding: 40px 30px; box-shadow: 0 10px 40px rgba(0,217,165,0.2); }\n' +
'        .celebration { font-size: 2.5rem; margin-bottom: 15px; animation: bounce 0.6s ease infinite; }\n' +
'        @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }\n' +
'        .card-title { font-family: "Bebas Neue", sans-serif; font-size: 1.8rem; letter-spacing: 3px; margin-bottom: 8px; color: var(--teal); }\n' +
'        .card-subtitle { color: var(--muted); font-size: 0.9rem; margin-bottom: 25px; line-height: 1.5; }\n' +
'        .pin-reveal { background: linear-gradient(135deg, rgba(255,215,0,0.1), rgba(255,107,53,0.1)); border: 3px solid var(--gold); border-radius: 16px; padding: 25px; margin-bottom: 25px; animation: celebrate 0.5s ease-out; }\n' +
'        @keyframes celebrate { 0% { transform: scale(0.8); opacity: 0; } 50% { transform: scale(1.05); } 100% { transform: scale(1); opacity: 1; } }\n' +
'        .pin-label { font-size: 0.8rem; color: var(--muted); text-transform: uppercase; letter-spacing: 2px; margin-bottom: 10px; }\n' +
'        .pin-value { font-family: "Bebas Neue", sans-serif; font-size: 3.5rem; letter-spacing: 12px; color: var(--gold); text-shadow: 0 0 30px rgba(255,215,0,0.5); }\n' +
'        .btn { width: 100%; padding: 18px 30px; border: none; border-radius: 50px; font-family: "Bebas Neue", sans-serif; font-size: 1.3rem; letter-spacing: 3px; cursor: pointer; transition: all 0.3s; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; gap: 10px; background: linear-gradient(135deg, var(--teal), #00CED1); color: var(--dark); box-shadow: 0 8px 30px rgba(0,217,165,0.3); }\n' +
'        .btn:hover { transform: translateY(-3px); box-shadow: 0 12px 40px rgba(0,217,165,0.4); }\n' +
'        .btn:disabled { opacity: 0.5; cursor: not-allowed; transform: none !important; }\n' +
'        .countdown { font-size: 0.85rem; color: var(--muted); margin-top: 15px; }\n' +
'        .countdown span { color: var(--teal); font-weight: 700; }\n' +
'        .error-card { border-color: #FF1744; }\n' +
'        .error-card .card-title { color: #FF1744; }\n' +
'        .btn-primary { background: linear-gradient(135deg, var(--gold), var(--orange)); box-shadow: 0 8px 30px rgba(255,107,53,0.3); }\n' +
'        .footer { margin-top: 40px; text-align: center; }\n' +
'        .footer-logo { font-family: "Bebas Neue", sans-serif; font-size: 1.2rem; letter-spacing: 3px; margin-bottom: 8px; }\n' +
'        .footer-logo .laugh { color: var(--gold); }\n' +
'        .footer-company { font-size: 0.7rem; color: var(--muted); }\n' +
'        .footer-company a { color: var(--gold); text-decoration: none; }\n' +
'        @keyframes spin { to { transform: rotate(360deg); } }\n' +
'        @media (max-width: 480px) { .logo { font-size: 2rem; } .card { padding: 30px 20px; } .pin-value { font-size: 2.8rem; letter-spacing: 10px; } .btn { font-size: 1.1rem; padding: 16px 25px; } }\n' +
'    </style>\n' +
'</head>\n' +
'<body class="en">\n' +
'    <div class="lang-toggle">\n' +
'        <button class="lang-btn active" id="btnEn">EN</button>\n' +
'        <button class="lang-btn" id="btnEs">ES</button>\n' +
'    </div>\n' +
'    <div class="container">\n' +
'        <div class="logo">🏀 <span class="laugh">LAUGH</span><span class="court">COURT</span></div>\n' +
'        <div class="tagline">\n' +
'            <span class="lang-en">Where Joy Meets The Game</span>\n' +
'            <span class="lang-es">Donde La Alegría Se Une Al Juego</span>\n' +
'        </div>\n';

        if (found && pin) {
            html += '' +
'        <div class="card" id="successCard">\n' +
'            <div class="celebration">🎉🏀🎉</div>\n' +
'            <h1 class="card-title">\n' +
'                <span class="lang-en">PAYMENT SUCCESSFUL!</span>\n' +
'                <span class="lang-es">¡PAGO EXITOSO!</span>\n' +
'            </h1>\n' +
'            <p class="card-subtitle">\n' +
'                <span class="lang-en">Your 7-day free trial has started. Here\'s your PIN!</span>\n' +
'                <span class="lang-es">Tu prueba gratis de 7 días ha comenzado. ¡Aquí está tu PIN!</span>\n' +
'            </p>\n' +
'            <div class="pin-reveal">\n' +
'                <div class="pin-label">\n' +
'                    <span class="lang-en">YOUR PIN</span>\n' +
'                    <span class="lang-es">TU PIN</span>\n' +
'                </div>\n' +
'                <div class="pin-value">' + pin + '</div>\n' +
'            </div>\n' +
'            <button class="btn" id="playBtn">\n' +
'                <span class="lang-en">🏀 PLAY NOW</span>\n' +
'                <span class="lang-es">🏀 JUGAR AHORA</span>\n' +
'            </button>\n' +
'            <div class="countdown">\n' +
'                <span class="lang-en">Auto-login in <span id="countEn">5</span> seconds...</span>\n' +
'                <span class="lang-es">Ingreso automático en <span id="countEs">5</span> segundos...</span>\n' +
'            </div>\n' +
'        </div>\n';
        } else {
            html += '' +
'        <div class="card error-card">\n' +
'            <div class="celebration">😕</div>\n' +
'            <h1 class="card-title">\n' +
'                <span class="lang-en">ALMOST THERE!</span>\n' +
'                <span class="lang-es">¡CASI LISTO!</span>\n' +
'            </h1>\n' +
'            <p class="card-subtitle">\n' +
'                <span class="lang-en">Use "Forgot PIN" with your email to get access.</span>\n' +
'                <span class="lang-es">Usa "Olvidé mi PIN" con tu correo para obtener acceso.</span>\n' +
'            </p>\n' +
'            <a href="/login" class="btn btn-primary">\n' +
'                <span class="lang-en">GO TO LOGIN</span>\n' +
'                <span class="lang-es">IR A LOGIN</span>\n' +
'            </a>\n' +
'        </div>\n';
        }

        html += '' +
'        <footer class="footer">\n' +
'            <div class="footer-logo">🏀 <span class="laugh">LAUGH</span><span class="court">COURT</span></div>\n' +
'            <div class="footer-company">by <a href="https://gostar.digital">GoStar Digital LLC</a> 🇵🇷</div>\n' +
'        </footer>\n' +
'    </div>\n' +
'    <script>\n' +
'        (function() {\n' +
'            var lang = localStorage.getItem("laughcourt_lang") || "en";\n' +
'            document.body.className = lang;\n' +
'            document.getElementById("btnEn").className = lang === "en" ? "lang-btn active" : "lang-btn";\n' +
'            document.getElementById("btnEs").className = lang === "es" ? "lang-btn active" : "lang-btn";\n' +
'            document.getElementById("btnEn").onclick = function() { localStorage.setItem("laughcourt_lang", "en"); document.body.className = "en"; this.className = "lang-btn active"; document.getElementById("btnEs").className = "lang-btn"; };\n' +
'            document.getElementById("btnEs").onclick = function() { localStorage.setItem("laughcourt_lang", "es"); document.body.className = "es"; this.className = "lang-btn active"; document.getElementById("btnEn").className = "lang-btn"; };\n';

        if (found && pin) {
            html += '' +
'            var pin = "' + pin + '";\n' +
'            var countdown = 5;\n' +
'            var interval = setInterval(function() {\n' +
'                countdown--;\n' +
'                var cEn = document.getElementById("countEn");\n' +
'                var cEs = document.getElementById("countEs");\n' +
'                if (cEn) cEn.textContent = countdown;\n' +
'                if (cEs) cEs.textContent = countdown;\n' +
'                if (countdown <= 0) { clearInterval(interval); doLogin(); }\n' +
'            }, 1000);\n' +
'            function doLogin() {\n' +
'                var btn = document.getElementById("playBtn");\n' +
'                if (btn) btn.disabled = true;\n' +
'                fetch("/api/login", {\n' +
'                    method: "POST",\n' +
'                    headers: { "Content-Type": "application/json" },\n' +
'                    body: JSON.stringify({ pin: pin })\n' +
'                })\n' +
'                .then(function(r) { return r.json(); })\n' +
'                .then(function(data) {\n' +
'                    if (data.success) {\n' +
'                        localStorage.setItem("lc-user", JSON.stringify({ pin: pin }));\n' +
'                        sessionStorage.setItem("lc-pin", pin);\n' +
'                        sessionStorage.setItem("lc-token", data.token);\n' +
'                        localStorage.setItem("lc-terms-accepted", new Date().toISOString());\n' +
'                        window.location.href = "/play";\n' +
'                    } else {\n' +
'                        window.location.href = "/login";\n' +
'                    }\n' +
'                })\n' +
'                .catch(function() { window.location.href = "/login"; });\n' +
'            }\n' +
'            var playBtn = document.getElementById("playBtn");\n' +
'            if (playBtn) playBtn.onclick = function() { clearInterval(interval); doLogin(); };\n';
        }

        html += '' +
'        })();\n' +
'    </script>\n' +
'</body>\n' +
'</html>';

        res.send(html);
    }
    
    // Function to lookup PIN by email
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
    
    // If we have session_id, fetch from Stripe
    if (sessionId && stripe) {
        stripe.checkout.sessions.retrieve(sessionId)
            .then(function(session) {
                var customerEmail = session.customer_email || 
                    (session.customer_details && session.customer_details.email);
                console.log('📧 Stripe session email:', customerEmail);
                
                if (customerEmail) {
                    var result = lookupByEmail(customerEmail);
                    renderPage(result.pin, customerEmail, result.found);
                } else {
                    renderPage(null, null, false);
                }
            })
            .catch(function(err) {
                console.log('⚠️ Stripe session lookup error:', err.message);
                renderPage(null, null, false);
            });
    } else if (email) {
        // Fallback to email param
        var result = lookupByEmail(email);
        renderPage(result.pin, email, result.found);
    } else {
        // No session_id or email
        renderPage(null, null, false);
    }
});

// ============ SUCCESS PAGE (Post-Stripe Payment) ============

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
        game: 'LAUGHCOURT',
        divisions: 15,
        levels: 5,
        speeds: ['SLOW', 'MED', 'FAST']
    });
});

// ============ START SERVER ============
app.listen(PORT, function() {
    console.log('');
    console.log('🏀 ========================================');
    console.log('   LAUGHCOURT SERVER v' + PLATFORM_VERSION);
    console.log('   ' + PLATFORM_VERSION_NAME);
    console.log('==========================================');
    console.log('');
    console.log('📍 Port:', PORT);
    console.log('💳 Stripe:', stripe ? '✅ Configured' : '❌ Not configured');
    console.log('🔐 Admin Key:', ADMIN_SECRET_KEY ? '✅ Set' : '⚠️ Using default');
    console.log('');
    console.log('🎯 ROUTES:');
    console.log('   /                 → Landing page');
    console.log('   /login            → PIN Login');
    console.log('   /success          → Post-payment (session_id lookup)');
    console.log('   /play             → Game choice screen');
    console.log('   /the-match        → THE MATCH game');
    console.log('   /the-sequence     → THE SEQUENCE game');
    console.log('');
    console.log('🏀 Ready to play!');
    console.log('');
});
