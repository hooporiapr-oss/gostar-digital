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

// Ensure data directory and files exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(LICENSES_FILE)) fs.writeFileSync(LICENSES_FILE, '[]');
if (!fs.existsSync(CODES_FILE)) fs.writeFileSync(CODES_FILE, '[]');
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(ACTIVITY_FILE)) fs.writeFileSync(ACTIVITY_FILE, '[]');
if (!fs.existsSync(SUBSCRIBERS_FILE)) fs.writeFileSync(SUBSCRIBERS_FILE, '[]');
if (!fs.existsSync(TRIAL_PINS_FILE)) fs.writeFileSync(TRIAL_PINS_FILE, '[]');

// ============ STRIPE WEBHOOK (must be before JSON parser) ============
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), function(req, res) {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
    
    const sig = req.headers['stripe-signature'];
    let event;
    
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send('Webhook Error: ' + err.message);
    }
    
    switch (event.type) {
        case 'checkout.session.completed': handleCheckoutComplete(event.data.object); break;
        case 'customer.subscription.updated': handleSubscriptionUpdate(event.data.object); break;
        case 'customer.subscription.deleted': handleSubscriptionCanceled(event.data.object); break;
        case 'invoice.payment_failed': handlePaymentFailed(event.data.object); break;
        default: console.log('Unhandled event type:', event.type);
    }
    
    res.json({ received: true });
});

// Middleware (after webhook route)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

// Helper functions
function readJSON(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } 
    catch (e) { return []; }
}

function writeJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
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
    if (extra) {
        if (extra.game) activity.game = extra.game;
        if (extra.laughs) activity.laughs = extra.laughs;
        if (extra.email) activity.email = extra.email;
        if (extra.tier) activity.tier = extra.tier;
        if (extra.round) activity.round = extra.round;
    }
    activities.unshift(activity);
    if (activities.length > 500) activities = activities.slice(0, 500);
    writeJSON(ACTIVITY_FILE, activities);
}

function generateUserPin() {
    var users = readJSON(USERS_FILE);
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    var trialPins = readJSON(TRIAL_PINS_FILE);
    var existingPins = users.map(function(u) { return u.pin; }).filter(function(p) { return p; });
    var subscriberPins = subscribers.map(function(s) { return s.pin; }).filter(function(p) { return p; });
    var facilityTrialPins = trialPins.map(function(t) { return t.pin; }).filter(function(p) { return p; });
    existingPins = existingPins.concat(subscriberPins).concat(facilityTrialPins);
    var pin;
    var attempts = 0;
    do {
        pin = String(1000 + Math.floor(Math.random() * 9000));
        attempts++;
    } while (existingPins.indexOf(pin) !== -1 && attempts < 100);
    return pin;
}

function generateLicensePin() {
    var licenses = readJSON(LICENSES_FILE);
    var existingPins = licenses.map(function(l) { return l.key; });
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

// ============ STRIPE HELPER FUNCTIONS ============

function handleCheckoutComplete(session) {
    console.log('Checkout completed:', session.id);
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    var email = session.customer_email || session.customer_details?.email;
    var customerId = session.customer;
    var subscriptionId = session.subscription;
    var quantity = session.metadata?.quantity || 1;
    
    var subIndex = -1;
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].email === email) { subIndex = i; break; }
    }
    var planType = session.metadata?.plan_type || 'individual_monthly';
    if (subIndex === -1) {
        var newSub = {
            email: email, pin: generateUserPin(), stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId, plan_type: planType, status: 'active',
            quantity: parseInt(quantity),
            created_at: new Date().toISOString(), current_period_end: null,
            totalLaughs: 0, streak: 0, lastActive: null,
            games: { laughtrail: { sessions: 0, bestRound: 0, laughs: 0 }, laughhunt: { sessions: 0, bestTier: 0, laughs: 0 } }
        };
        subscribers.push(newSub);
        logActivity('subscription_created', email, null, 'New ' + planType + ' subscription (x' + quantity + ')', { email: email });
        console.log('New subscriber created:', email, 'PIN:', newSub.pin, 'Qty:', quantity);
    } else {
        subscribers[subIndex].stripe_customer_id = customerId;
        subscribers[subIndex].stripe_subscription_id = subscriptionId;
        subscribers[subIndex].plan_type = planType;
        subscribers[subIndex].status = 'active';
        subscribers[subIndex].quantity = parseInt(quantity);
        if (!subscribers[subIndex].games) {
            subscribers[subIndex].games = { laughtrail: { sessions: 0, bestRound: 0, laughs: 0 }, laughhunt: { sessions: 0, bestTier: 0, laughs: 0 } };
        }
        if (typeof subscribers[subIndex].totalLaughs === 'undefined') subscribers[subIndex].totalLaughs = 0;
        logActivity('subscription_updated', email, null, 'Updated to ' + planType + ' (x' + quantity + ')', { email: email });
    }
    writeJSON(SUBSCRIBERS_FILE, subscribers);
}

function handleSubscriptionUpdate(subscription) {
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].stripe_subscription_id === subscription.id) {
            subscribers[i].status = subscription.status;
            subscribers[i].current_period_end = new Date(subscription.current_period_end * 1000).toISOString();
            // Update quantity if changed
            if (subscription.items?.data?.[0]?.quantity) {
                subscribers[i].quantity = subscription.items.data[0].quantity;
            }
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

// ============ STRIPE API ROUTES ============

app.post('/api/stripe/checkout', function(req, res) {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
    var plan = req.body.plan || 'individual';
    var billing = req.body.billing || 'monthly';
    var planType = req.body.planType || (plan + '_' + billing);
    var priceId = STRIPE_PRICES[planType];
    if (!priceId) return res.status(400).json({ error: 'Invalid plan type: ' + planType });
    var baseUrl = process.env.SITE_URL || process.env.BASE_URL || 'https://gotrotter.ai';
    
    // $5/user - adjustable quantity, promo codes enabled, NO trial
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
        subscription_data: { metadata: { plan_type: planType } },
        metadata: { plan_type: planType }
    }).then(function(session) { res.json({ url: session.url, sessionId: session.id }); })
    .catch(function(err) { res.status(500).json({ error: err.message }); });
});

app.get('/api/stripe/status/:email', function(req, res) {
    var email = decodeURIComponent(req.params.email).toLowerCase();
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    var subscriber = null;
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].email.toLowerCase() === email) { subscriber = subscribers[i]; break; }
    }
    if (!subscriber) return res.json({ subscribed: false, status: null });
    var isActive = subscriber.status === 'active' || subscriber.status === 'trialing';
    res.json({ subscribed: isActive, status: subscriber.status, plan_type: subscriber.plan_type, quantity: subscriber.quantity || 1, pin: isActive ? subscriber.pin : null });
});

// Check status by PIN - UPDATED to include facility trial PINs
app.get('/api/stripe/status-pin/:pin', function(req, res) {
    var pin = req.params.pin;
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    
    // Check regular subscribers
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
            var isActive = subscribers[i].status === 'active' || subscribers[i].status === 'trialing';
            return res.json({ subscribed: isActive, status: subscribers[i].status, plan_type: subscribers[i].plan_type, quantity: subscribers[i].quantity || 1, email: subscribers[i].email });
        }
        if (subscribers[i].family_members) {
            for (var j = 0; j < subscribers[i].family_members.length; j++) {
                if (subscribers[i].family_members[j].pin === pin) {
                    var isActive = subscribers[i].status === 'active' || subscribers[i].status === 'trialing';
                    return res.json({ subscribed: isActive, status: subscribers[i].status, plan_type: subscribers[i].plan_type, email: subscribers[i].email });
                }
            }
        }
    }
    
    // Check facility trial PINs
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

app.get('/api/stripe/session/:sessionId', function(req, res) {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
    stripe.checkout.sessions.retrieve(req.params.sessionId)
        .then(function(session) {
            var email = (session.customer_details?.email || session.customer_email || '').toLowerCase();
            if (!email) return res.json({ success: false, error: 'No email found' });
            var subscribers = readJSON(SUBSCRIBERS_FILE);
            var subscriber = null;
            for (var i = 0; i < subscribers.length; i++) {
                if (subscribers[i].email.toLowerCase() === email) { subscriber = subscribers[i]; break; }
            }
            if (!subscriber) return res.json({ success: false, error: 'Subscriber not found', email: email });
            var isActive = subscriber.status === 'active' || subscriber.status === 'trialing';
            res.json({ success: true, email: email, subscribed: isActive, status: subscriber.status, quantity: subscriber.quantity || 1, pin: isActive ? subscriber.pin : null });
        })
        .catch(function(err) { res.status(500).json({ success: false, error: err.message }); });
});

app.post('/api/stripe/portal', function(req, res) {
    if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
    var email = req.body.email;
    if (!email) return res.status(400).json({ error: 'Email required' });
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    var subscriber = null;
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].email.toLowerCase() === email.toLowerCase()) { subscriber = subscribers[i]; break; }
    }
    if (!subscriber || !subscriber.stripe_customer_id) return res.status(404).json({ error: 'No subscription found' });
    var baseUrl = process.env.SITE_URL || process.env.BASE_URL || 'https://gotrotter.ai';
    stripe.billingPortal.sessions.create({ customer: subscriber.stripe_customer_id, return_url: baseUrl + '/' })
        .then(function(session) { res.json({ url: session.url }); })
        .catch(function(err) { res.status(500).json({ error: err.message }); });
});

// Login - UPDATED to include facility trial PINs
app.post('/api/subscriber/login', function(req, res) {
    var pin = req.body.pin;
    if (!pin) return res.status(400).json({ error: 'PIN is required' });
    
    // Check regular subscribers
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
            var isActive = subscribers[i].status === 'active' || subscribers[i].status === 'trialing';
            if (!isActive) return res.status(401).json({ error: 'Subscription not active' });
            logActivity('subscriber_login', subscribers[i].email, null, 'Subscriber logged in');
            return res.json({ success: true, email: subscribers[i].email, pin: pin, plan: subscribers[i].plan_type, status: subscribers[i].status, quantity: subscribers[i].quantity || 1 });
        }
        if (subscribers[i].family_members) {
            for (var j = 0; j < subscribers[i].family_members.length; j++) {
                if (subscribers[i].family_members[j].pin === pin) {
                    var isActive = subscribers[i].status === 'active' || subscribers[i].status === 'trialing';
                    if (!isActive) return res.status(401).json({ error: 'Subscription not active' });
                    logActivity('subscriber_login', subscribers[i].family_members[j].name, null, 'Family member logged in');
                    return res.json({ success: true, email: subscribers[i].email, pin: pin, plan: subscribers[i].plan_type, status: subscribers[i].status, is_family_member: true, name: subscribers[i].family_members[j].name });
                }
            }
        }
    }
    
    // Check facility trial PINs
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var k = 0; k < trialPins.length; k++) {
        if (trialPins[k].pin === pin) {
            var trial = trialPins[k];
            
            // Check if expired
            if (new Date(trial.expiresAt) < new Date()) {
                trial.status = 'expired';
                writeJSON(TRIAL_PINS_FILE, trialPins);
                return res.status(401).json({ error: 'Trial has expired' });
            }
            
            // Check max users
            if ((trial.currentUsers || 0) >= trial.maxUsers) {
                return res.status(401).json({ error: 'Trial user limit reached (' + trial.maxUsers + ')' });
            }
            
            // Track unique devices
            var deviceId = req.headers['x-device-id'] || req.ip || 'unknown';
            if (!trial.devices) trial.devices = [];
            if (trial.devices.indexOf(deviceId) === -1) {
                trial.devices.push(deviceId);
                trial.currentUsers = trial.devices.length;
                writeJSON(TRIAL_PINS_FILE, trialPins);
                logActivity('trial_login', trial.facility, trial.facility, 'New device joined trial (' + trial.currentUsers + '/' + trial.maxUsers + ')');
            }
            
            var daysLeft = Math.ceil((new Date(trial.expiresAt) - new Date()) / (1000 * 60 * 60 * 24));
            return res.json({
                success: true, email: trial.facility, pin: pin, plan: 'facility_trial', status: 'trialing',
                is_facility_trial: true,
                trialInfo: { facility: trial.facility, expiresAt: trial.expiresAt, daysLeft: Math.max(0, daysLeft), currentUsers: trial.currentUsers, maxUsers: trial.maxUsers }
            });
        }
    }
    
    return res.status(401).json({ error: 'Invalid PIN' });
});

// Family member routes
app.post('/api/subscriber/family/add', function(req, res) {
    var ownerPin = req.body.owner_pin;
    var memberName = req.body.name;
    if (!ownerPin || !memberName) return res.status(400).json({ error: 'Owner PIN and name required' });
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    var subIndex = -1;
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === ownerPin) { subIndex = i; break; }
    }
    if (subIndex === -1) return res.status(404).json({ error: 'Subscription not found' });
    var subscriber = subscribers[subIndex];
    if (!subscriber.plan_type.startsWith('family')) return res.status(400).json({ error: 'Family plan required' });
    if (!subscriber.family_members) subscriber.family_members = [];
    if (subscriber.family_members.length >= 4) return res.status(400).json({ error: 'Limit reached (4 members)' });
    var newMember = { name: memberName.trim(), pin: generateUserPin(), added_at: new Date().toISOString() };
    subscriber.family_members.push(newMember);
    writeJSON(SUBSCRIBERS_FILE, subscribers);
    res.json({ success: true, member: newMember });
});

app.post('/api/subscriber/family/remove', function(req, res) {
    var ownerPin = req.body.owner_pin;
    var memberPin = req.body.member_pin;
    if (!ownerPin || !memberPin) return res.status(400).json({ error: 'Owner PIN and member PIN required' });
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === ownerPin && subscribers[i].family_members) {
            for (var j = 0; j < subscribers[i].family_members.length; j++) {
                if (subscribers[i].family_members[j].pin === memberPin) {
                    subscribers[i].family_members.splice(j, 1);
                    writeJSON(SUBSCRIBERS_FILE, subscribers);
                    return res.json({ success: true });
                }
            }
        }
    }
    return res.status(404).json({ error: 'Not found' });
});

app.get('/api/subscriber/family/:ownerPin', function(req, res) {
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === req.params.ownerPin) {
            return res.json({ plan_type: subscribers[i].plan_type, family_members: subscribers[i].family_members || [], slots_remaining: subscribers[i].plan_type.startsWith('family') ? 4 - (subscribers[i].family_members?.length || 0) : 0 });
        }
    }
    return res.status(404).json({ error: 'Not found' });
});

// Admin auth
function adminAuth(req, res, next) {
    var auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
        res.setHeader('WWW-Authenticate', 'Basic realm="Admin"');
        return res.status(401).send('Auth required');
    }
    var credentials = Buffer.from(auth.split(' ')[1], 'base64').toString().split(':');
    if (credentials[0] === ADMIN_USER && credentials.slice(1).join(':') === ADMIN_PASS) return next();
    res.status(401).send('Invalid credentials');
}

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
        setTimeout(function() { adminTokens.delete(token); }, 24 * 60 * 60 * 1000);
        res.json({ success: true, token: token });
    } else {
        res.status(401).json({ success: false, message: 'Invalid PIN' });
    }
});

app.post('/api/admin/verify-token', function(req, res) {
    res.json({ success: adminTokens.has(req.body.token) });
});

app.post('/api/admin/logout', function(req, res) {
    if (req.body.token) adminTokens.delete(req.body.token);
    res.json({ success: true });
});

// ============ FACILITY TRIAL PIN MANAGEMENT ============

// Create facility trial PIN
app.post('/api/admin/trial-pin', adminTokenAuth, function(req, res) {
    var facility = req.body.facility;
    var maxUsers = parseInt(req.body.maxUsers) || 50;
    var trialDays = parseInt(req.body.trialDays) || 7;
    var notes = req.body.notes || '';
    
    if (!facility) return res.status(400).json({ success: false, error: 'Facility name required' });
    if (maxUsers < 1 || maxUsers > 100) return res.status(400).json({ success: false, error: 'Max users must be 1-100' });
    
    var trialPins = readJSON(TRIAL_PINS_FILE);
    var pin = generateUserPin();
    var expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + trialDays);
    
    var newTrial = {
        id: 'trial_' + Date.now(),
        pin: pin,
        facility: facility.trim(),
        maxUsers: maxUsers,
        currentUsers: 0,
        devices: [],
        trialDays: trialDays,
        status: 'active',
        notes: notes.trim(),
        createdAt: new Date().toISOString(),
        expiresAt: expiresAt.toISOString()
    };
    
    trialPins.push(newTrial);
    writeJSON(TRIAL_PINS_FILE, trialPins);
    logActivity('trial_created', facility, facility, 'Created facility trial PIN: ' + pin + ' (' + maxUsers + ' users, ' + trialDays + ' days)');
    
    res.json({ success: true, trial: newTrial });
});

// Get all trial PINs
app.get('/api/admin/trial-pins', adminTokenAuth, function(req, res) {
    var trialPins = readJSON(TRIAL_PINS_FILE);
    var now = new Date();
    var updated = false;
    
    for (var i = 0; i < trialPins.length; i++) {
        if (trialPins[i].status === 'active' && new Date(trialPins[i].expiresAt) < now) {
            trialPins[i].status = 'expired';
            updated = true;
        }
    }
    if (updated) writeJSON(TRIAL_PINS_FILE, trialPins);
    
    res.json({ success: true, trials: trialPins });
});

// Update trial PIN
app.put('/api/admin/trial-pin/:id', adminTokenAuth, function(req, res) {
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var i = 0; i < trialPins.length; i++) {
        if (trialPins[i].id === req.params.id) {
            if (req.body.facility) trialPins[i].facility = req.body.facility.trim();
            if (req.body.maxUsers) trialPins[i].maxUsers = parseInt(req.body.maxUsers);
            if (req.body.notes !== undefined) trialPins[i].notes = req.body.notes.trim();
            if (req.body.status) trialPins[i].status = req.body.status;
            writeJSON(TRIAL_PINS_FILE, trialPins);
            return res.json({ success: true, trial: trialPins[i] });
        }
    }
    res.status(404).json({ success: false, error: 'Trial not found' });
});

// Extend trial
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
            writeJSON(TRIAL_PINS_FILE, trialPins);
            logActivity('trial_extended', trialPins[i].facility, trialPins[i].facility, 'Extended by ' + extraDays + ' days');
            return res.json({ success: true, trial: trialPins[i] });
        }
    }
    res.status(404).json({ success: false, error: 'Trial not found' });
});

// Delete trial PIN
app.delete('/api/admin/trial-pin/:id', adminTokenAuth, function(req, res) {
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var i = 0; i < trialPins.length; i++) {
        if (trialPins[i].id === req.params.id) {
            var deleted = trialPins.splice(i, 1)[0];
            writeJSON(TRIAL_PINS_FILE, trialPins);
            logActivity('trial_deleted', deleted.facility, deleted.facility, 'Deleted facility trial PIN');
            return res.json({ success: true });
        }
    }
    res.status(404).json({ success: false, error: 'Trial not found' });
});

// ============ ADMIN SUBSCRIBERS ============

app.get('/api/admin/subscribers', adminTokenAuth, function(req, res) {
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    var result = subscribers.map(function(sub) {
        var games = sub.games || { laughtrail: { sessions: 0, bestRound: 0, laughs: 0 }, laughhunt: { sessions: 0, bestTier: 0, laughs: 0 } };
        return {
            email: sub.email, pin: sub.pin, plan_type: sub.plan_type, status: sub.status,
            quantity: sub.quantity || 1,
            created_at: sub.created_at, totalLaughs: sub.totalLaughs || 0, streak: sub.streak || 0,
            lastActive: sub.lastActive, games: games, family_members: sub.family_members || []
        };
    });
    res.json({ success: true, subscribers: result });
});

app.get('/api/admin/subscriber/:pin', adminTokenAuth, function(req, res) {
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === req.params.pin) {
            return res.json({ success: true, subscriber: subscribers[i] });
        }
    }
    res.status(404).json({ success: false, error: 'Not found' });
});

app.put('/api/admin/subscriber/:pin', adminTokenAuth, function(req, res) {
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === req.params.pin) {
            if (req.body.email) subscribers[i].email = req.body.email;
            if (req.body.status) subscribers[i].status = req.body.status;
            if (req.body.plan_type) subscribers[i].plan_type = req.body.plan_type;
            if (req.body.quantity) subscribers[i].quantity = parseInt(req.body.quantity);
            writeJSON(SUBSCRIBERS_FILE, subscribers);
            return res.json({ success: true });
        }
    }
    res.status(404).json({ success: false, error: 'Not found' });
});

app.delete('/api/admin/subscriber/:pin', adminTokenAuth, function(req, res) {
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === req.params.pin) {
            subscribers.splice(i, 1);
            writeJSON(SUBSCRIBERS_FILE, subscribers);
            return res.json({ success: true });
        }
    }
    res.status(404).json({ success: false, error: 'Not found' });
});

// ============ ADMIN ACTIVITY ============

app.get('/api/admin/activity', adminTokenAuth, function(req, res) {
    res.json({ success: true, activities: readJSON(ACTIVITY_FILE) });
});

app.delete('/api/admin/activity/all', adminTokenAuth, function(req, res) {
    writeJSON(ACTIVITY_FILE, []);
    res.json({ success: true });
});

app.delete('/api/admin/activity/:id', adminTokenAuth, function(req, res) {
    var activities = readJSON(ACTIVITY_FILE);
    var newActivities = activities.filter(function(a) { return a.id !== req.params.id; });
    writeJSON(ACTIVITY_FILE, newActivities);
    res.json({ success: true });
});

// ============ ADMIN FACILITIES/LICENSES/USERS ============

app.get('/api/admin/facilities', adminTokenAuth, function(req, res) {
    var licenses = readJSON(LICENSES_FILE);
    var codes = readJSON(CODES_FILE);
    var users = readJSON(USERS_FILE);
    var facilities = licenses.map(function(lic) {
        var facilityCodes = codes.filter(function(c) { return c.licenseKey === lic.key; });
        var facilityUsers = users.filter(function(u) { return facilityCodes.some(function(c) { return c.code === u.code; }); });
        var daysLeft = Math.ceil((new Date(lic.expirationDate) - new Date()) / (1000 * 60 * 60 * 24));
        return { id: lic.key, name: lic.facilityName, user_count: facilityUsers.length, user_limit: lic.userPool, status: lic.active && daysLeft > 0 ? 'active' : 'expired', days_left: Math.max(0, daysLeft) };
    });
    res.json({ success: true, facilities: facilities });
});

app.get('/api/admin/users', adminTokenAuth, function(req, res) {
    res.json({ success: true, users: readJSON(USERS_FILE) });
});

// ============ GAME ROUTES ============

app.get('/', function(req, res) { res.sendFile(path.join(__dirname, 'index.html')); });
app.get('/admin-dashboard', function(req, res) { res.sendFile(path.join(__dirname, 'admin-dashboard.html')); });
app.get('/admin', adminAuth, function(req, res) { res.sendFile(path.join(__dirname, 'admin.html')); });
app.get('/play', function(req, res) { res.sendFile(path.join(__dirname, 'index.html')); });
app.get('/health', function(req, res) { res.json({ status: 'healthy', timestamp: new Date().toISOString() }); });

// Play login - UPDATED for facility trials
app.post('/api/play/login', function(req, res) {
    var pin = req.body.pin;
    if (!pin) return res.status(400).json({ error: 'PIN required' });
    
    // Check subscribers
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
            var isActive = subscribers[i].status === 'active' || subscribers[i].status === 'trialing';
            if (!isActive) return res.status(401).json({ error: 'Subscription not active' });
            return res.json({ success: true, username: subscribers[i].email.split('@')[0], pin: pin, userType: 'subscriber' });
        }
    }
    
    // Check facility trials
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var k = 0; k < trialPins.length; k++) {
        if (trialPins[k].pin === pin) {
            var trial = trialPins[k];
            if (new Date(trial.expiresAt) < new Date()) return res.status(401).json({ error: 'Trial expired' });
            if ((trial.currentUsers || 0) >= trial.maxUsers) return res.status(401).json({ error: 'Trial limit reached' });
            return res.json({ success: true, username: trial.facility, pin: pin, userType: 'facility_trial' });
        }
    }
    
    return res.status(401).json({ error: 'Invalid PIN' });
});

// Game session - UPDATED for facility trials
app.post('/api/game/session', function(req, res) {
    var pin = req.body.pin;
    var game = req.body.game;
    var laughs = req.body.laughs || 0;
    var round = req.body.round;
    var tier = req.body.tier;
    
    if (!pin || !game) return res.status(400).json({ error: 'PIN and game required' });
    
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
            var sub = subscribers[i];
            if (!sub.games) sub.games = { laughtrail: { sessions: 0, bestRound: 0, laughs: 0 }, laughhunt: { sessions: 0, bestTier: 0, laughs: 0 } };
            if (!sub.games[game]) sub.games[game] = { sessions: 0, bestRound: 0, bestTier: 0, laughs: 0 };
            if (typeof sub.totalLaughs === 'undefined') sub.totalLaughs = 0;
            
            sub.games[game].sessions++;
            sub.games[game].laughs += laughs;
            sub.totalLaughs += laughs;
            if (game === 'laughtrail' && round && round > (sub.games[game].bestRound || 0)) sub.games[game].bestRound = round;
            if (game === 'laughhunt' && tier && tier > (sub.games[game].bestTier || 0)) sub.games[game].bestTier = tier;
            sub.lastActive = new Date().toISOString();
            
            // Streak
            var today = new Date().toISOString().split('T')[0];
            if (!sub.lastStreakDate) { sub.streak = 1; sub.lastStreakDate = today; }
            else if (sub.lastStreakDate !== today) {
                var diff = Math.floor((new Date(today) - new Date(sub.lastStreakDate)) / (1000 * 60 * 60 * 24));
                sub.streak = diff === 1 ? (sub.streak || 0) + 1 : 1;
                sub.lastStreakDate = today;
            }
            
            writeJSON(SUBSCRIBERS_FILE, subscribers);
            
            var details = (game === 'laughtrail' ? 'LAUGH TRAIL' : 'LAUGH HUNT');
            if (round) details += ' | Round ' + round;
            if (tier) details += ' | Tier ' + tier;
            if (laughs) details += ' | 😂 +' + laughs;
            logActivity('game_session', sub.email, null, details, { game: game, laughs: laughs, round: round, tier: tier });
            
            return res.json({ success: true, streak: sub.streak, sessions: sub.games[game].sessions, totalLaughs: sub.totalLaughs });
        }
    }
    
    // Check facility trials
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var k = 0; k < trialPins.length; k++) {
        if (trialPins[k].pin === pin) {
            var trial = trialPins[k];
            var details = (game === 'laughtrail' ? 'LAUGH TRAIL' : 'LAUGH HUNT') + ' (trial)';
            if (round) details += ' | Round ' + round;
            if (tier) details += ' | Tier ' + tier;
            logActivity('game_session', trial.facility, trial.facility, details, { game: game, laughs: laughs });
            return res.json({ success: true, streak: 1, sessions: 1, totalLaughs: laughs, message: 'Trial session' });
        }
    }
    
    return res.status(404).json({ error: 'User not found' });
});

app.get('/api/game/stats/pin/:pin', function(req, res) {
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === req.params.pin) {
            var sub = subscribers[i];
            var games = sub.games || { laughtrail: { sessions: 0, bestRound: 0, laughs: 0 }, laughhunt: { sessions: 0, bestTier: 0, laughs: 0 } };
            return res.json({ success: true, username: sub.email.split('@')[0], stats: { games: games, totalLaughs: sub.totalLaughs || 0, streak: sub.streak || 0 } });
        }
    }
    
    // Check facility trials
    var trialPins = readJSON(TRIAL_PINS_FILE);
    for (var k = 0; k < trialPins.length; k++) {
        if (trialPins[k].pin === req.params.pin) {
            return res.json({ success: true, username: trialPins[k].facility, stats: { games: { laughtrail: { sessions: 0, bestRound: 0, laughs: 0 }, laughhunt: { sessions: 0, bestTier: 0, laughs: 0 } }, totalLaughs: 0, streak: 0 } });
        }
    }
    
    return res.status(404).json({ error: 'Not found' });
});

// ============ START SERVER ============

app.listen(PORT, function() {
    console.log('LaughCourt running on port ' + PORT);
    console.log('Admin Dashboard: /admin-dashboard');
    console.log('Stripe configured:', !!stripe);
});
