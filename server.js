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

// Stripe Price IDs (set these in Render environment variables)
const STRIPE_PRICES = {
    individual_monthly: process.env.STRIPE_PRICE_INDIVIDUAL_MONTHLY,
    individual_annual: process.env.STRIPE_PRICE_INDIVIDUAL_ANNUAL,
    family_monthly: process.env.STRIPE_PRICE_FAMILY_MONTHLY,
    family_annual: process.env.STRIPE_PRICE_FAMILY_ANNUAL
};

// Initialize Stripe (only if key is set)
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

// Ensure data directory and files exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(LICENSES_FILE)) fs.writeFileSync(LICENSES_FILE, '[]');
if (!fs.existsSync(CODES_FILE)) fs.writeFileSync(CODES_FILE, '[]');
if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '[]');
if (!fs.existsSync(ACTIVITY_FILE)) fs.writeFileSync(ACTIVITY_FILE, '[]');
if (!fs.existsSync(SUBSCRIBERS_FILE)) fs.writeFileSync(SUBSCRIBERS_FILE, '[]');

// ============ STRIPE WEBHOOK (must be before JSON parser) ============
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), function(req, res) {
    if (!stripe) {
        return res.status(500).json({ error: 'Stripe not configured' });
    }
    
    const sig = req.headers['stripe-signature'];
    let event;
    
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send('Webhook Error: ' + err.message);
    }
    
    // Handle the event
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
        default:
            console.log('Unhandled event type:', event.type);
    }
    
    res.json({ received: true });
});

// Middleware (after webhook route)
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

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
        id: 'act_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        timestamp: new Date().toISOString(),
        type: type,
        username: username || null,
        facility: facility || null,
        details: details || null
    });
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

function generateUserPin() {
    var users = readJSON(USERS_FILE);
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    var existingPins = users.map(function(u) { return u.pin; }).filter(function(p) { return p; });
    var subscriberPins = subscribers.map(function(s) { return s.pin; }).filter(function(p) { return p; });
    existingPins = existingPins.concat(subscriberPins);
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

// Convert score to shift level (1-10)
function getShiftFromScore(score) {
    if (score >= 10) return 10;
    if (score >= 9) return 9;
    if (score >= 8) return 8;
    if (score >= 7) return 7;
    if (score >= 6) return 6;
    if (score >= 5) return 5;
    if (score >= 4) return 4;
    if (score >= 3) return 3;
    if (score >= 2) return 2;
    return 1;
}

// ============ STRIPE HELPER FUNCTIONS ============

function handleCheckoutComplete(session) {
    console.log('Checkout completed:', session.id);
    
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    var email = session.customer_email || session.customer_details?.email;
    var customerId = session.customer;
    var subscriptionId = session.subscription;
    
    var subIndex = -1;
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].email === email) {
            subIndex = i;
            break;
        }
    }
    
    var planType = session.metadata?.plan_type || 'individual_monthly';
    var userLimit = planType.startsWith('family') ? 5 : 1;
    
    if (subIndex === -1) {
        var newSub = {
            email: email,
            pin: generateUserPin(),
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            plan_type: planType,
            user_limit: userLimit,
            status: 'trialing',
            created_at: new Date().toISOString(),
            current_period_end: null,
            family_members: []
        };
        subscribers.push(newSub);
        logActivity('subscription_created', email, null, 'New ' + planType + ' subscription');
        console.log('New subscriber created:', email, 'PIN:', newSub.pin);
    } else {
        subscribers[subIndex].stripe_customer_id = customerId;
        subscribers[subIndex].stripe_subscription_id = subscriptionId;
        subscribers[subIndex].plan_type = planType;
        subscribers[subIndex].user_limit = userLimit;
        subscribers[subIndex].status = 'trialing';
        logActivity('subscription_updated', email, null, 'Updated to ' + planType);
        console.log('Subscriber updated:', email);
    }
    
    writeJSON(SUBSCRIBERS_FILE, subscribers);
}

function handleSubscriptionUpdate(subscription) {
    console.log('Subscription updated:', subscription.id);
    
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].stripe_subscription_id === subscription.id) {
            subscribers[i].status = subscription.status;
            subscribers[i].current_period_end = new Date(subscription.current_period_end * 1000).toISOString();
            if (subscription.status === 'past_due') {
                logActivity('subscription_past_due', subscribers[i].email, null, 'Payment past due');
            }
            break;
        }
    }
    
    writeJSON(SUBSCRIBERS_FILE, subscribers);
}

function handleSubscriptionCanceled(subscription) {
    console.log('Subscription canceled:', subscription.id);
    
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].stripe_subscription_id === subscription.id) {
            subscribers[i].status = 'canceled';
            logActivity('subscription_canceled', subscribers[i].email, null, 'Subscription canceled');
            break;
        }
    }
    
    writeJSON(SUBSCRIBERS_FILE, subscribers);
}

function handlePaymentFailed(invoice) {
    console.log('Payment failed for invoice:', invoice.id);
    
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    var customerId = invoice.customer;
    
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].stripe_customer_id === customerId) {
            logActivity('payment_failed', subscribers[i].email, null, 'Payment failed');
            break;
        }
    }
}

// ============ STRIPE API ROUTES ============

// Create Checkout Session
app.post('/api/stripe/checkout', function(req, res) {
    if (!stripe) {
        console.error('Stripe not configured');
        return res.status(500).json({ error: 'Stripe not configured' });
    }
    
    // Handle both formats: plan+billing OR planType
    var plan = req.body.plan || 'individual';
    var billing = req.body.billing || 'monthly';
    var planType = req.body.planType || (plan + '_' + billing);
    
    var priceId = STRIPE_PRICES[planType];
    
    console.log('Checkout request:', { plan, billing, planType, priceId });
    console.log('Available prices:', STRIPE_PRICES);
    
    if (!priceId) {
        console.error('Invalid plan type:', planType);
        return res.status(400).json({ error: 'Invalid plan type or price not configured: ' + planType });
    }
    
    var baseUrl = process.env.SITE_URL || process.env.BASE_URL || 'https://gotrotter.ai';
    var successUrl = baseUrl + '/play.html?success=true&session_id={CHECKOUT_SESSION_ID}';
    var cancelUrl = baseUrl + '/play.html?canceled=true';
    
    stripe.checkout.sessions.create({
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{
            price: priceId,
            quantity: 1
        }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        allow_promotion_codes: true,
        subscription_data: {
            trial_period_days: 7,
            metadata: {
                plan_type: planType
            }
        },
        metadata: {
            plan_type: planType
        }
    }).then(function(session) {
        console.log('Checkout session created:', session.id);
        res.json({ url: session.url, sessionId: session.id });
    }).catch(function(err) {
        console.error('Stripe checkout error:', err.message);
        res.status(500).json({ error: 'Failed to create checkout session: ' + err.message });
    });
});

// Check subscription status by email
app.get('/api/stripe/status/:email', function(req, res) {
    var email = decodeURIComponent(req.params.email).toLowerCase();
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    
    var subscriber = null;
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].email.toLowerCase() === email) {
            subscriber = subscribers[i];
            break;
        }
    }
    
    if (!subscriber) {
        return res.json({ subscribed: false, status: null });
    }
    
    var isActive = subscriber.status === 'active' || subscriber.status === 'trialing';
    
    res.json({
        subscribed: isActive,
        status: subscriber.status,
        plan_type: subscriber.plan_type,
        pin: isActive ? subscriber.pin : null,
        current_period_end: subscriber.current_period_end
    });
});

// Check subscription status by PIN
app.get('/api/stripe/status-pin/:pin', function(req, res) {
    var pin = req.params.pin;
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    
    var subscriber = null;
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
            subscriber = subscribers[i];
            break;
        }
        if (subscribers[i].family_members) {
            for (var j = 0; j < subscribers[i].family_members.length; j++) {
                if (subscribers[i].family_members[j].pin === pin) {
                    subscriber = subscribers[i];
                    break;
                }
            }
        }
    }
    
    if (!subscriber) {
        return res.json({ subscribed: false, status: null });
    }
    
    var isActive = subscriber.status === 'active' || subscriber.status === 'trialing';
    
    res.json({
        subscribed: isActive,
        status: subscriber.status,
        plan_type: subscriber.plan_type,
        email: subscriber.email
    });
});

// NEW: Get subscriber info by Stripe session ID (auto-fetch PIN without email typing)
app.get('/api/stripe/session/:sessionId', function(req, res) {
    if (!stripe) {
        return res.status(500).json({ error: 'Stripe not configured' });
    }
    
    var sessionId = req.params.sessionId;
    
    stripe.checkout.sessions.retrieve(sessionId)
        .then(function(session) {
            var email = session.customer_details ? session.customer_details.email : null;
            if (!email) email = session.customer_email;
            
            if (!email) {
                console.log('No email found in session:', sessionId);
                return res.json({ success: false, error: 'No email found in session' });
            }
            
            email = email.toLowerCase();
            console.log('Session lookup - Email:', email);
            
            var subscribers = readJSON(SUBSCRIBERS_FILE);
            var subscriber = null;
            
            for (var i = 0; i < subscribers.length; i++) {
                if (subscribers[i].email.toLowerCase() === email) {
                    subscriber = subscribers[i];
                    break;
                }
            }
            
            if (!subscriber) {
                console.log('No subscriber found for email:', email);
                return res.json({ 
                    success: false, 
                    error: 'Subscriber not found - webhook may still be processing',
                    email: email
                });
            }
            
            var isActive = subscriber.status === 'active' || subscriber.status === 'trialing';
            console.log('Session lookup success - PIN:', subscriber.pin);
            
            res.json({
                success: true,
                email: email,
                subscribed: isActive,
                status: subscriber.status,
                plan_type: subscriber.plan_type,
                pin: isActive ? subscriber.pin : null
            });
        })
        .catch(function(err) {
            console.error('Stripe session retrieve error:', err.message);
            res.status(500).json({ success: false, error: 'Failed to retrieve session: ' + err.message });
        });
});

// Create Customer Portal session
app.post('/api/stripe/portal', function(req, res) {
    if (!stripe) {
        return res.status(500).json({ error: 'Stripe not configured' });
    }
    
    var email = req.body.email;
    if (!email) {
        return res.status(400).json({ error: 'Email required' });
    }
    
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    var subscriber = null;
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].email.toLowerCase() === email.toLowerCase()) {
            subscriber = subscribers[i];
            break;
        }
    }
    
    if (!subscriber || !subscriber.stripe_customer_id) {
        return res.status(404).json({ error: 'No subscription found for this email' });
    }
    
    var baseUrl = process.env.SITE_URL || process.env.BASE_URL || 'https://gotrotter.ai';
    var returnUrl = baseUrl + '/play.html';
    
    stripe.billingPortal.sessions.create({
        customer: subscriber.stripe_customer_id,
        return_url: returnUrl
    }).then(function(session) {
        res.json({ url: session.url });
    }).catch(function(err) {
        console.error('Portal session error:', err);
        res.status(500).json({ error: 'Failed to create portal session' });
    });
});

// Login with subscriber PIN
app.post('/api/subscriber/login', function(req, res) {
    var pin = req.body.pin;
    
    if (!pin) {
        return res.status(400).json({ error: 'PIN is required' });
    }
    
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    var subscriber = null;
    var isFamilyMember = false;
    var memberName = null;
    
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
            subscriber = subscribers[i];
            break;
        }
        if (subscribers[i].family_members) {
            for (var j = 0; j < subscribers[i].family_members.length; j++) {
                if (subscribers[i].family_members[j].pin === pin) {
                    subscriber = subscribers[i];
                    isFamilyMember = true;
                    memberName = subscribers[i].family_members[j].name;
                    break;
                }
            }
        }
    }
    
    if (!subscriber) {
        return res.status(401).json({ error: 'Invalid PIN' });
    }
    
    var isActive = subscriber.status === 'active' || subscriber.status === 'trialing';
    if (!isActive) {
        return res.status(401).json({ error: 'Subscription is not active. Please renew at gotrotter.ai' });
    }
    
    logActivity('subscriber_login', isFamilyMember ? memberName : subscriber.email, null, 'Subscriber logged in');
    
    res.json({ 
        success: true, 
        email: subscriber.email,
        pin: pin,
        plan: subscriber.plan_type,
        status: subscriber.status,
        is_family_member: isFamilyMember,
        name: memberName
    });
});

// Add family member
app.post('/api/subscriber/family/add', function(req, res) {
    var ownerPin = req.body.owner_pin;
    var memberName = req.body.name;
    
    if (!ownerPin || !memberName) {
        return res.status(400).json({ error: 'Owner PIN and member name required' });
    }
    
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    var subIndex = -1;
    
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === ownerPin) {
            subIndex = i;
            break;
        }
    }
    
    if (subIndex === -1) {
        return res.status(404).json({ error: 'Subscription not found' });
    }
    
    var subscriber = subscribers[subIndex];
    
    if (!subscriber.plan_type.startsWith('family')) {
        return res.status(400).json({ error: 'Family members only available on Family plans' });
    }
    
    if (!subscriber.family_members) {
        subscriber.family_members = [];
    }
    
    if (subscriber.family_members.length >= 4) {
        return res.status(400).json({ error: 'Family member limit reached (4 additional members)' });
    }
    
    var newMember = {
        name: memberName.trim(),
        pin: generateUserPin(),
        added_at: new Date().toISOString()
    };
    
    subscriber.family_members.push(newMember);
    writeJSON(SUBSCRIBERS_FILE, subscribers);
    
    logActivity('family_member_added', subscriber.email, null, 'Added family member: ' + memberName);
    
    res.json({ 
        success: true, 
        member: newMember,
        total_members: subscriber.family_members.length + 1
    });
});

// Remove family member
app.post('/api/subscriber/family/remove', function(req, res) {
    var ownerPin = req.body.owner_pin;
    var memberPin = req.body.member_pin;
    
    if (!ownerPin || !memberPin) {
        return res.status(400).json({ error: 'Owner PIN and member PIN required' });
    }
    
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    var subIndex = -1;
    
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === ownerPin) {
            subIndex = i;
            break;
        }
    }
    
    if (subIndex === -1) {
        return res.status(404).json({ error: 'Subscription not found' });
    }
    
    var subscriber = subscribers[subIndex];
    
    if (!subscriber.family_members) {
        return res.status(404).json({ error: 'No family members found' });
    }
    
    var memberIndex = -1;
    for (var j = 0; j < subscriber.family_members.length; j++) {
        if (subscriber.family_members[j].pin === memberPin) {
            memberIndex = j;
            break;
        }
    }
    
    if (memberIndex === -1) {
        return res.status(404).json({ error: 'Family member not found' });
    }
    
    var removedName = subscriber.family_members[memberIndex].name;
    subscriber.family_members.splice(memberIndex, 1);
    writeJSON(SUBSCRIBERS_FILE, subscribers);
    
    logActivity('family_member_removed', subscriber.email, null, 'Removed family member: ' + removedName);
    
    res.json({ success: true });
});

// Get family members
app.get('/api/subscriber/family/:ownerPin', function(req, res) {
    var ownerPin = req.params.ownerPin;
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    
    var subscriber = null;
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === ownerPin) {
            subscriber = subscribers[i];
            break;
        }
    }
    
    if (!subscriber) {
        return res.status(404).json({ error: 'Subscription not found' });
    }
    
    res.json({
        plan_type: subscriber.plan_type,
        family_members: subscriber.family_members || [],
        slots_remaining: subscriber.plan_type.startsWith('family') ? 4 - (subscriber.family_members?.length || 0) : 0
    });
});

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

// Store active admin tokens
var adminTokens = new Set();

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

// Get all subscribers (admin)
app.get('/api/admin/subscribers', adminTokenAuth, function(req, res) {
    try {
        var subscribers = readJSON(SUBSCRIBERS_FILE);
        var result = subscribers.map(function(sub) {
            return {
                email: sub.email,
                pin: sub.pin,
                plan_type: sub.plan_type,
                status: sub.status,
                created_at: sub.created_at,
                current_period_end: sub.current_period_end,
                family_members_count: sub.family_members ? sub.family_members.length : 0,
                sessions: sub.sessions || {},
                best: sub.best || {},
                streak: sub.streak || 0,
                lastActive: sub.lastActive || null,
                family_members: sub.family_members || []
            };
        });
        res.json({ success: true, subscribers: result });
    } catch (err) {
        console.error('Error fetching subscribers:', err);
        res.json({ success: true, subscribers: [] });
    }
});

// Get single subscriber details (admin)
app.get('/api/admin/subscriber/:pin', adminTokenAuth, function(req, res) {
    try {
        var pin = req.params.pin;
        var subscribers = readJSON(SUBSCRIBERS_FILE);
        var subscriber = null;
        var isFamilyMember = false;
        var parentSubscriber = null;
        
        for (var i = 0; i < subscribers.length; i++) {
            if (subscribers[i].pin === pin) {
                subscriber = subscribers[i];
                break;
            }
            if (subscribers[i].family_members) {
                for (var j = 0; j < subscribers[i].family_members.length; j++) {
                    if (subscribers[i].family_members[j].pin === pin) {
                        subscriber = subscribers[i].family_members[j];
                        isFamilyMember = true;
                        parentSubscriber = subscribers[i];
                        break;
                    }
                }
            }
        }
        
        if (!subscriber) {
            return res.status(404).json({ success: false, error: 'Subscriber not found' });
        }
        
        // Calculate total sessions
        var sessions = subscriber.sessions || {};
        var totalSessions = Object.values(sessions).reduce(function(sum, val) { return sum + val; }, 0);
        
        // Calculate best scores with shift levels
        var best = subscriber.best || {};
        var bestWithShifts = {};
        for (var game in best) {
            bestWithShifts[game] = {
                score: best[game],
                shift: getShiftFromScore(best[game])
            };
        }
        
        res.json({
            success: true,
            subscriber: {
                email: isFamilyMember ? parentSubscriber.email : subscriber.email,
                name: isFamilyMember ? subscriber.name : (subscriber.email ? subscriber.email.split('@')[0] : 'Unknown'),
                pin: subscriber.pin,
                plan_type: isFamilyMember ? parentSubscriber.plan_type : subscriber.plan_type,
                status: isFamilyMember ? parentSubscriber.status : subscriber.status,
                is_family_member: isFamilyMember,
                sessions: sessions,
                totalSessions: totalSessions,
                best: bestWithShifts,
                streak: subscriber.streak || 0,
                lastActive: subscriber.lastActive || null,
                created_at: subscriber.added_at || subscriber.created_at
            }
        });
    } catch (err) {
        console.error('Error fetching subscriber:', err);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Edit subscriber (admin)
app.put('/api/admin/subscriber/:pin', adminTokenAuth, function(req, res) {
    try {
        var pin = req.params.pin;
        var subscribers = readJSON(SUBSCRIBERS_FILE);
        var found = false;
        
        for (var i = 0; i < subscribers.length; i++) {
            if (subscribers[i].pin === pin) {
                // Update main subscriber
                if (req.body.email) subscribers[i].email = req.body.email;
                if (req.body.status) subscribers[i].status = req.body.status;
                if (req.body.plan_type) subscribers[i].plan_type = req.body.plan_type;
                if (req.body.pin && req.body.pin !== pin) {
                    // Check if new PIN is unique
                    var pinExists = subscribers.some(function(s) { return s.pin === req.body.pin; });
                    if (!pinExists) {
                        subscribers[i].pin = req.body.pin;
                    }
                }
                found = true;
                logActivity('subscriber_updated', subscribers[i].email, null, 'Subscriber updated by admin');
                break;
            }
            // Check family members
            if (subscribers[i].family_members) {
                for (var j = 0; j < subscribers[i].family_members.length; j++) {
                    if (subscribers[i].family_members[j].pin === pin) {
                        if (req.body.name) subscribers[i].family_members[j].name = req.body.name;
                        if (req.body.pin && req.body.pin !== pin) {
                            var pinExists = subscribers.some(function(s) { 
                                return s.pin === req.body.pin || (s.family_members && s.family_members.some(function(m) { return m.pin === req.body.pin; }));
                            });
                            if (!pinExists) {
                                subscribers[i].family_members[j].pin = req.body.pin;
                            }
                        }
                        found = true;
                        logActivity('family_member_updated', subscribers[i].family_members[j].name, null, 'Family member updated by admin');
                        break;
                    }
                }
            }
        }
        
        if (!found) {
            return res.status(404).json({ success: false, error: 'Subscriber not found' });
        }
        
        writeJSON(SUBSCRIBERS_FILE, subscribers);
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating subscriber:', err);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Delete subscriber (admin)
app.delete('/api/admin/subscriber/:pin', adminTokenAuth, function(req, res) {
    try {
        var pin = req.params.pin;
        var subscribers = readJSON(SUBSCRIBERS_FILE);
        var found = false;
        var deletedEmail = null;
        
        for (var i = 0; i < subscribers.length; i++) {
            if (subscribers[i].pin === pin) {
                deletedEmail = subscribers[i].email;
                subscribers.splice(i, 1);
                found = true;
                logActivity('subscriber_deleted', deletedEmail, null, 'Subscriber deleted by admin');
                break;
            }
            // Check family members
            if (subscribers[i].family_members) {
                for (var j = 0; j < subscribers[i].family_members.length; j++) {
                    if (subscribers[i].family_members[j].pin === pin) {
                        var deletedName = subscribers[i].family_members[j].name;
                        subscribers[i].family_members.splice(j, 1);
                        found = true;
                        logActivity('family_member_deleted', deletedName, null, 'Family member deleted by admin');
                        break;
                    }
                }
            }
        }
        
        if (!found) {
            return res.status(404).json({ success: false, error: 'Subscriber not found' });
        }
        
        writeJSON(SUBSCRIBERS_FILE, subscribers);
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting subscriber:', err);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

// Health check
app.get('/health', function(req, res) {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Landing page
app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// ============ ADMIN PIN AUTH ============

app.post('/api/admin/verify', function(req, res) {
    var pin = req.body.pin;
    
    if (!ADMIN_PIN) {
        console.error('ADMIN_PIN environment variable not set!');
        return res.status(500).json({ success: false, message: 'Server configuration error' });
    }
    
    if (pin === ADMIN_PIN) {
        var token = generateToken();
        adminTokens.add(token);
        setTimeout(function() { adminTokens.delete(token); }, 24 * 60 * 60 * 1000);
        res.json({ success: true, token: token, message: 'Access granted' });
    } else {
        res.status(401).json({ success: false, message: 'Invalid PIN' });
    }
});

app.post('/api/admin/verify-token', function(req, res) {
    var token = req.body.token;
    if (token && adminTokens.has(token)) {
        res.json({ success: true });
    } else {
        res.status(401).json({ success: false, message: 'Invalid or expired token' });
    }
});

app.post('/api/admin/logout', function(req, res) {
    var token = req.body.token;
    if (token) { adminTokens.delete(token); }
    res.json({ success: true });
});

// ============ ADMIN DASHBOARD API ============

app.get('/api/admin/facilities', adminTokenAuth, function(req, res) {
    try {
        var licenses = readJSON(LICENSES_FILE);
        var codes = readJSON(CODES_FILE);
        var users = readJSON(USERS_FILE);
        
        var facilities = licenses.map(function(lic) {
            var facilityCodes = codes.filter(function(c) { return c.licenseKey === lic.key; });
            var facilityCodeIds = facilityCodes.map(function(c) { return c.code; });
            var facilityUsers = users.filter(function(u) { return facilityCodeIds.indexOf(u.code) !== -1; });
            var totalSessions = facilityUsers.reduce(function(sum, u) {
                return sum + (u.sessions_sequence || 0) + (u.sessions_startrail || 0) + (u.sessions_duo || 0) + (u.sessions_gonogo || 0);
            }, 0);
            var today = new Date();
            var expiry = new Date(lic.expirationDate);
            var daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
            
            return {
                id: lic.key, name: lic.facilityName, location: lic.location || 'N/A',
                license_key: lic.key, license_type: lic.isTrial ? 'trial' : 'standard',
                user_count: facilityUsers.length, user_limit: lic.userPool, total_sessions: totalSessions,
                status: lic.active ? (daysLeft > 0 ? 'active' : 'expired') : 'inactive',
                created_at: lic.createdAt, expires_at: lic.expirationDate, days_left: Math.max(0, daysLeft),
                contact_name: lic.contactName || '', email: lic.email || '', phone: lic.phone || ''
            };
        });
        res.json({ success: true, facilities: facilities });
    } catch (err) {
        console.error('Error fetching facilities:', err);
        res.json({ success: true, facilities: [] });
    }
});

app.put('/api/admin/facilities/:id', adminTokenAuth, function(req, res) {
    var id = req.params.id;
    var licenses = readJSON(LICENSES_FILE);
    var index = -1;
    for (var i = 0; i < licenses.length; i++) {
        if (licenses[i].key === id) { index = i; break; }
    }
    if (index === -1) return res.status(404).json({ success: false, message: 'Facility not found' });
    if (req.body.name) licenses[index].facilityName = req.body.name;
    if (req.body.location) licenses[index].location = req.body.location;
    if (req.body.expires_at) licenses[index].expirationDate = req.body.expires_at;
    if (typeof req.body.active === 'boolean') licenses[index].active = req.body.active;
    writeJSON(LICENSES_FILE, licenses);
    res.json({ success: true });
});

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

app.get('/api/admin/licenses-list', adminTokenAuth, function(req, res) {
    try {
        var licenses = readJSON(LICENSES_FILE);
        var result = licenses.map(function(lic) {
            var today = new Date();
            var expiry = new Date(lic.expirationDate);
            var daysLeft = Math.ceil((expiry - today) / (1000 * 60 * 60 * 24));
            return {
                key: lic.key, license_key: lic.key, license_type: lic.isTrial ? 'trial' : 'standard',
                facility_name: lic.facilityName, created_at: lic.createdAt, expires_at: lic.expirationDate,
                status: lic.active ? (daysLeft > 0 ? 'active' : 'expired') : 'inactive'
            };
        });
        res.json({ success: true, licenses: result });
    } catch (err) {
        console.error('Error fetching licenses:', err);
        res.json({ success: true, licenses: [] });
    }
});

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

app.get('/api/admin/users', adminTokenAuth, function(req, res) {
    try {
        var users = readJSON(USERS_FILE);
        var codes = readJSON(CODES_FILE);
        var licenses = readJSON(LICENSES_FILE);
        var result = users.map(function(u, index) {
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
                id: index, username: u.username, pin: u.pin || null, facility_name: facilityName,
                sessions_sequence: u.sessions_sequence || 0, sessions_startrail: u.sessions_startrail || 0,
                sessions_duo: u.sessions_duo || 0, best_sequence: u.best_sequence || 0,
                best_startrail: u.best_startrail || 0, best_duo: u.best_duo || 0,
                streak: u.streak || 0, last_active: u.lastActive || u.createdAt, created_at: u.createdAt
            };
        });
        res.json({ success: true, users: result });
    } catch (err) {
        console.error('Error fetching users:', err);
        res.json({ success: true, users: [] });
    }
});

app.put('/api/admin/users/:id', adminTokenAuth, function(req, res) {
    var id = parseInt(req.params.id);
    var users = readJSON(USERS_FILE);
    if (id < 0 || id >= users.length) return res.status(404).json({ success: false, message: 'User not found' });
    if (req.body.username) users[id].username = req.body.username;
    if (typeof req.body.streak === 'number') users[id].streak = req.body.streak;
    writeJSON(USERS_FILE, users);
    res.json({ success: true });
});

app.delete('/api/admin/users/:id', adminTokenAuth, function(req, res) {
    var id = parseInt(req.params.id);
    var users = readJSON(USERS_FILE);
    if (id < 0 || id >= users.length) return res.status(404).json({ success: false, message: 'User not found' });
    users.splice(id, 1);
    writeJSON(USERS_FILE, users);
    res.json({ success: true });
});

app.get('/api/admin/activity', adminTokenAuth, function(req, res) {
    try {
        var activities = readJSON(ACTIVITY_FILE);
        res.json({ success: true, activities: activities });
    } catch (err) {
        console.error('Error fetching activities:', err);
        res.json({ success: true, activities: [] });
    }
});

// Delete ALL activities
app.delete('/api/admin/activity/all', adminTokenAuth, function(req, res) {
    try {
        writeJSON(ACTIVITY_FILE, []);
        console.log('Deleted ALL activities');
        res.json({ success: true, deleted: 'all' });
    } catch (err) {
        console.error('Error deleting all activities:', err);
        res.status(500).json({ success: false, error: 'Delete failed' });
    }
});

// Delete all activities by date (MUST come before :id route)
app.delete('/api/admin/activity/by-date/:date', adminTokenAuth, function(req, res) {
    try {
        var dateKey = req.params.date;
        var activities = readJSON(ACTIVITY_FILE);
        var originalCount = activities.length;
        
        var newActivities = activities.filter(function(act) {
            if (!act.timestamp) return true;
            var actDate = new Date(act.timestamp).toISOString().split('T')[0];
            return actDate !== dateKey;
        });
        
        var deletedCount = originalCount - newActivities.length;
        writeJSON(ACTIVITY_FILE, newActivities);
        console.log('Deleted', deletedCount, 'activities for date:', dateKey);
        res.json({ success: true, deleted: deletedCount });
    } catch (err) {
        console.error('Error deleting activities by date:', err);
        res.status(500).json({ success: false, error: 'Delete failed' });
    }
});

// Delete activities by user and date (MUST come before :id route)
app.delete('/api/admin/activity/by-user-date/:username/:date', adminTokenAuth, function(req, res) {
    try {
        var username = decodeURIComponent(req.params.username);
        var dateKey = req.params.date;
        var activities = readJSON(ACTIVITY_FILE);
        var originalCount = activities.length;
        
        var newActivities = activities.filter(function(act) {
            if (!act.timestamp || act.username !== username) return true;
            var actDate = new Date(act.timestamp).toISOString().split('T')[0];
            return actDate !== dateKey || act.type !== 'game_session';
        });
        
        var deletedCount = originalCount - newActivities.length;
        writeJSON(ACTIVITY_FILE, newActivities);
        console.log('Deleted', deletedCount, 'sessions for user:', username, 'on date:', dateKey);
        res.json({ success: true, deleted: deletedCount });
    } catch (err) {
        console.error('Error deleting activities by user/date:', err);
        res.status(500).json({ success: false, error: 'Delete failed' });
    }
});

// Delete by index (for activities without IDs)
app.delete('/api/admin/activity/by-index/:index', adminTokenAuth, function(req, res) {
    try {
        var index = parseInt(req.params.index);
        var activities = readJSON(ACTIVITY_FILE);
        
        if (index < 0 || index >= activities.length) {
            return res.status(404).json({ success: false, error: 'Activity not found' });
        }
        
        activities.splice(index, 1);
        writeJSON(ACTIVITY_FILE, activities);
        console.log('Deleted activity at index:', index);
        res.json({ success: true, deleted: 1 });
    } catch (err) {
        console.error('Error deleting activity by index:', err);
        res.status(500).json({ success: false, error: 'Delete failed' });
    }
});

// Delete single activity by ID (MUST come LAST)
app.delete('/api/admin/activity/:id', adminTokenAuth, function(req, res) {
    try {
        var actId = req.params.id;
        var activities = readJSON(ACTIVITY_FILE);
        var newActivities = activities.filter(function(act) { return act.id !== actId; });
        
        if (newActivities.length === activities.length) {
            return res.status(404).json({ success: false, error: 'Activity not found' });
        }
        
        writeJSON(ACTIVITY_FILE, newActivities);
        console.log('Deleted activity:', actId);
        res.json({ success: true, deleted: 1 });
    } catch (err) {
        console.error('Error deleting activity:', err);
        res.status(500).json({ success: false, error: 'Delete failed' });
    }
});

// ============ ADMIN ROUTES ============

app.get('/admin-dashboard', function(req, res) {
    res.sendFile(path.join(__dirname, 'admin-dashboard.html'));
});

app.get('/admin', adminAuth, function(req, res) {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/api/admin/licenses', adminAuth, function(req, res) {
    var licenses = readJSON(LICENSES_FILE);
    var codes = readJSON(CODES_FILE);
    var enriched = licenses.map(function(lic) {
        var licCodes = codes.filter(function(c) { return c.licenseKey === lic.key; });
        var usedPool = licCodes.reduce(function(sum, c) { return sum + c.userLimit; }, 0);
        var result = {};
        for (var key in lic) { result[key] = lic[key]; }
        result.usedPool = usedPool;
        result.remainingPool = lic.userPool - usedPool;
        return result;
    });
    res.json(enriched);
});

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
        key: generateLicensePin(), facilityName: facilityName, expirationDate: expirationDate,
        userPool: parseInt(userPool), createdAt: new Date().toISOString(), active: true
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

app.put('/api/admin/licenses/:key', adminAuth, function(req, res) {
    var key = req.params.key;
    var licenses = readJSON(LICENSES_FILE);
    var index = -1;
    for (var i = 0; i < licenses.length; i++) {
        if (licenses[i].key === key) { index = i; break; }
    }
    if (index === -1) return res.status(404).json({ error: 'License not found' });
    if (req.body.facilityName) licenses[index].facilityName = req.body.facilityName;
    if (req.body.expirationDate) licenses[index].expirationDate = req.body.expirationDate;
    if (req.body.userPool) licenses[index].userPool = parseInt(req.body.userPool);
    if (typeof req.body.active === 'boolean') licenses[index].active = req.body.active;
    writeJSON(LICENSES_FILE, licenses);
    res.json(licenses[index]);
});

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
        if (licenses[i].key === licenseKey && licenses[i].active) { license = licenses[i]; break; }
    }
    if (!license) return res.status(401).json({ error: 'Invalid license key' });
    if (new Date(license.expirationDate) < new Date()) return res.status(401).json({ error: 'License expired' });
    logActivity('facility_login', null, license.facilityName, 'Facility dashboard accessed');
    res.json({ success: true, facilityName: license.facilityName });
});

app.get('/api/facility/:licenseKey', function(req, res) {
    var licenseKey = req.params.licenseKey;
    var licenses = readJSON(LICENSES_FILE);
    var license = null;
    for (var i = 0; i < licenses.length; i++) {
        if (licenses[i].key === licenseKey && licenses[i].active) { license = licenses[i]; break; }
    }
    if (!license) return res.status(401).json({ error: 'Invalid license key' });
    if (new Date(license.expirationDate) < new Date()) return res.status(401).json({ error: 'License expired' });
    
    var allCodes = readJSON(CODES_FILE);
    var codes = allCodes.filter(function(c) { return c.licenseKey === licenseKey; });
    var users = readJSON(USERS_FILE);
    
    var enrichedCodes = codes.map(function(code) {
        var codeUsers = users.filter(function(u) { return u.code === code.code; });
        var usedCount = codeUsers.length;
        var totalSessions = codeUsers.reduce(function(sum, u) {
            return sum + (u.sessions_sequence || 0) + (u.sessions_startrail || 0) + (u.sessions_duo || 0) + (u.sessions_gonogo || 0);
        }, 0);
        var result = {};
        for (var key in code) { result[key] = code[key]; }
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
            username: u.username, pin: u.pin || null, code: u.code,
            sessions_sequence: u.sessions_sequence || 0, sessions_startrail: u.sessions_startrail || 0,
            sessions_duo: u.sessions_duo || 0, sessions_gonogo: u.sessions_gonogo || 0,
            best_sequence: u.best_sequence || 0, best_startrail: u.best_startrail || 0,
            best_duo: u.best_duo || 0, best_gonogo: u.best_gonogo || 0,
            totalSessions: (u.sessions_sequence || 0) + (u.sessions_startrail || 0) + (u.sessions_duo || 0) + (u.sessions_gonogo || 0),
            streak: u.streak || 0, lastActive: u.lastActive || u.createdAt, createdAt: u.createdAt,
            best_rt: u.best_rt || null, latest_rt: u.latest_rt || null, rt_history: u.rt_history || []
        };
    });
    
    res.json({
        facilityName: license.facilityName, expirationDate: license.expirationDate,
        userPool: license.userPool, usedPool: usedPool, remainingPool: license.userPool - usedPool,
        codes: enrichedCodes, users: enrichedUsers
    });
});

app.post('/api/facility/:licenseKey/codes', function(req, res) {
    var licenseKey = req.params.licenseKey;
    var userLimit = req.body.userLimit;
    var label = req.body.label;
    var licenses = readJSON(LICENSES_FILE);
    var license = null;
    for (var i = 0; i < licenses.length; i++) {
        if (licenses[i].key === licenseKey && licenses[i].active) { license = licenses[i]; break; }
    }
    if (!license) return res.status(401).json({ error: 'Invalid license key' });
    if (new Date(license.expirationDate) < new Date()) return res.status(401).json({ error: 'License expired' });
    var codes = readJSON(CODES_FILE);
    var licenseCodes = codes.filter(function(c) { return c.licenseKey === licenseKey; });
    var usedPool = licenseCodes.reduce(function(sum, c) { return sum + c.userLimit; }, 0);
    var remainingPool = license.userPool - usedPool;
    if (parseInt(userLimit) > remainingPool) {
        return res.status(400).json({ error: 'Only ' + remainingPool + ' users remaining in pool' });
    }
    var newCode = {
        code: generateKey('ACC', 6), licenseKey: licenseKey, userLimit: parseInt(userLimit),
        label: label || '', createdAt: new Date().toISOString(), active: true
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
        if (codes[i].code === code && codes[i].licenseKey === licenseKey) { codeObj = codes[i]; break; }
    }
    if (!codeObj) return res.status(404).json({ error: 'Code not found' });
    codes = codes.filter(function(c) { return c.code !== code; });
    writeJSON(CODES_FILE, codes);
    var users = readJSON(USERS_FILE);
    users = users.filter(function(u) { return u.code !== code; });
    writeJSON(USERS_FILE, users);
    res.json({ success: true });
});

// ============ PLAY ROUTES ============

app.get('/play', function(req, res) { res.sendFile(path.join(__dirname, 'play.html')); });
app.get('/game', function(req, res) { res.sendFile(path.join(__dirname, 'game.html')); });
app.get('/trailtrotter', function(req, res) { res.sendFile(path.join(__dirname, 'trailtrotter.html')); });
app.get('/gotrotters', function(req, res) { res.sendFile(path.join(__dirname, 'gotrotters.html')); });
app.get('/go-nogo-trail', function(req, res) { res.sendFile(path.join(__dirname, 'go-nogo-trail.html')); });

app.post('/api/play/verify', function(req, res) {
    var accessCode = req.body.accessCode;
    var codes = readJSON(CODES_FILE);
    var code = null;
    for (var i = 0; i < codes.length; i++) {
        if (codes[i].code === accessCode && codes[i].active) { code = codes[i]; break; }
    }
    if (!code) return res.status(401).json({ error: 'Invalid access code' });
    var licenses = readJSON(LICENSES_FILE);
    var license = null;
    for (var j = 0; j < licenses.length; j++) {
        if (licenses[j].key === code.licenseKey && licenses[j].active) { license = licenses[j]; break; }
    }
    if (!license) return res.status(401).json({ error: 'License not found' });
    if (new Date(license.expirationDate) < new Date()) return res.status(401).json({ error: 'Access expired' });
    var users = readJSON(USERS_FILE);
    var codeUsers = users.filter(function(u) { return u.code === accessCode; });
    var usedCount = codeUsers.length;
    var spotsLeft = code.userLimit - usedCount;
    res.json({ success: true, facilityName: license.facilityName, spotsLeft: spotsLeft, hasSpots: spotsLeft > 0 });
});

app.post('/api/play/register', function(req, res) {
    var accessCode = req.body.accessCode;
    var username = req.body.username;
    if (!accessCode || !username) return res.status(400).json({ error: 'Missing required fields' });
    var codes = readJSON(CODES_FILE);
    var code = null;
    for (var i = 0; i < codes.length; i++) {
        if (codes[i].code === accessCode && codes[i].active) { code = codes[i]; break; }
    }
    if (!code) return res.status(401).json({ error: 'Invalid access code' });
    var licenses = readJSON(LICENSES_FILE);
    var license = null;
    for (var j = 0; j < licenses.length; j++) {
        if (licenses[j].key === code.licenseKey && licenses[j].active) { license = licenses[j]; break; }
    }
    if (!license || new Date(license.expirationDate) < new Date()) return res.status(401).json({ error: 'Access expired' });
    var users = readJSON(USERS_FILE);
    var usedCount = users.filter(function(u) { return u.code === accessCode; }).length;
    if (usedCount >= code.userLimit) return res.status(400).json({ error: 'User limit reached for this code' });
    var userPin = generateUserPin();
    users.push({
        code: accessCode, username: username.trim(), pin: userPin, createdAt: new Date().toISOString(),
        sessions_sequence: 0, sessions_startrail: 0, sessions_duo: 0, sessions_gonogo: 0, streak: 0
    });
    writeJSON(USERS_FILE, users);
    logActivity('user_register', username, license.facilityName, 'New user registered with PIN');
    res.json({ success: true, username: username.trim(), pin: userPin });
});

app.post('/api/play/login', function(req, res) {
    var pin = req.body.pin;
    if (!pin) return res.status(400).json({ error: 'PIN is required' });
    
    var users = readJSON(USERS_FILE);
    var user = null;
    for (var i = 0; i < users.length; i++) {
        if (users[i].pin === pin) { user = users[i]; break; }
    }
    
    if (user) {
        var codes = readJSON(CODES_FILE);
        var code = null;
        for (var j = 0; j < codes.length; j++) {
            if (codes[j].code === user.code) { code = codes[j]; break; }
        }
        var facilityName = 'Unknown';
        if (code) {
            var licenses = readJSON(LICENSES_FILE);
            for (var k = 0; k < licenses.length; k++) {
                if (licenses[k].key === code.licenseKey) { facilityName = licenses[k].facilityName; break; }
            }
        }
        logActivity('user_login', user.username, facilityName, 'User logged in with PIN');
        return res.json({ success: true, username: user.username, pin: user.pin, accessCode: user.code, userType: 'facility' });
    }
    
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    var subscriber = null;
    var isFamilyMember = false;
    var memberName = null;
    
    for (var s = 0; s < subscribers.length; s++) {
        if (subscribers[s].pin === pin) { subscriber = subscribers[s]; break; }
        if (subscribers[s].family_members) {
            for (var m = 0; m < subscribers[s].family_members.length; m++) {
                if (subscribers[s].family_members[m].pin === pin) {
                    subscriber = subscribers[s];
                    isFamilyMember = true;
                    memberName = subscribers[s].family_members[m].name;
                    break;
                }
            }
        }
    }
    
    if (subscriber) {
        var isActive = subscriber.status === 'active' || subscriber.status === 'trialing';
        if (!isActive) return res.status(401).json({ error: 'Subscription is not active. Please renew at gotrotter.ai' });
        logActivity('subscriber_login', isFamilyMember ? memberName : subscriber.email, null, 'Subscriber logged in');
        return res.json({ 
            success: true, 
            username: isFamilyMember ? memberName : subscriber.email.split('@')[0],
            pin: pin, userType: 'subscriber', plan_type: subscriber.plan_type, is_family_member: isFamilyMember
        });
    }
    
    return res.status(401).json({ error: 'Invalid PIN' });
});

// ============ GAME SESSION TRACKING ============

app.post('/api/game/session', function(req, res) {
    var pin = req.body.pin;
    var accessCode = req.body.accessCode;
    var username = req.body.username;
    var game = req.body.game;
    var score = req.body.score;
    if (!game) return res.status(400).json({ error: 'Missing game type' });
    var validGames = ['sequence', 'startrail', 'duo', 'gonogo', 'startrotters', 'trailtrotter', 'gotrotters'];
    if (validGames.indexOf(game) === -1) return res.status(400).json({ error: 'Invalid game type' });
    
    var users = readJSON(USERS_FILE);
    var userIndex = -1;
    var isSubscriber = false;
    var subscriberEmail = null;
    
    // First check facility users
    if (pin) {
        for (var i = 0; i < users.length; i++) {
            if (users[i].pin === pin) { userIndex = i; break; }
        }
    } else if (accessCode && username) {
        for (var j = 0; j < users.length; j++) {
            if (users[j].code === accessCode && users[j].username.toLowerCase() === username.toLowerCase()) {
                userIndex = j; break;
            }
        }
    }
    
    // If not found in facility users, check subscribers
    if (userIndex === -1 && pin) {
        var subscribers = readJSON(SUBSCRIBERS_FILE);
        for (var s = 0; s < subscribers.length; s++) {
            if (subscribers[s].pin === pin) {
                isSubscriber = true;
                subscriberEmail = subscribers[s].email;
                
                // Initialize session tracking for subscriber if needed
                if (!subscribers[s].sessions) subscribers[s].sessions = {};
                if (!subscribers[s].sessions[game]) subscribers[s].sessions[game] = 0;
                subscribers[s].sessions[game]++;
                subscribers[s].lastActive = new Date().toISOString();
                
                // Track best scores
                if (score !== undefined) {
                    if (!subscribers[s].best) subscribers[s].best = {};
                    if (!subscribers[s].best[game] || score > subscribers[s].best[game]) {
                        subscribers[s].best[game] = score;
                    }
                }
                
                // Track streak
                var today = new Date().toISOString().split('T')[0];
                if (!subscribers[s].lastStreakDate) {
                    subscribers[s].streak = 1;
                    subscribers[s].lastStreakDate = today;
                } else if (subscribers[s].lastStreakDate !== today) {
                    var lastDate = new Date(subscribers[s].lastStreakDate);
                    var todayDate = new Date(today);
                    var diffDays = Math.floor((todayDate - lastDate) / (1000 * 60 * 60 * 24));
                    if (diffDays === 1) {
                        subscribers[s].streak = (subscribers[s].streak || 0) + 1;
                    } else if (diffDays > 1) {
                        subscribers[s].streak = 1;
                    }
                    subscribers[s].lastStreakDate = today;
                }
                
                writeJSON(SUBSCRIBERS_FILE, subscribers);
                
                var gameNames = { sequence: 'Sequence Memory', startrail: 'StarTrail', duo: 'Pattern Duo', gonogo: 'Go/No-Go' };
                var gameName = gameNames[game] || game;
                var scoreText = score !== undefined ? ' | Score: ' + score : '';
                var shiftLevel = score !== undefined ? getShiftFromScore(score) : null;
                var shiftText = shiftLevel ? ' | Shift ' + shiftLevel : '';
                logActivity('game_session', subscriberEmail, null, gameName + scoreText + shiftText);
                
                return res.json({ 
                    success: true, 
                    sessions: subscribers[s].sessions[game],
                    streak: subscribers[s].streak || 1,
                    personalBest: subscribers[s].best ? subscribers[s].best[game] : score
                });
            }
            
            // Check family members
            if (subscribers[s].family_members) {
                for (var m = 0; m < subscribers[s].family_members.length; m++) {
                    if (subscribers[s].family_members[m].pin === pin) {
                        isSubscriber = true;
                        var memberName = subscribers[s].family_members[m].name;
                        
                        // Initialize session tracking for family member
                        if (!subscribers[s].family_members[m].sessions) subscribers[s].family_members[m].sessions = {};
                        if (!subscribers[s].family_members[m].sessions[game]) subscribers[s].family_members[m].sessions[game] = 0;
                        subscribers[s].family_members[m].sessions[game]++;
                        subscribers[s].family_members[m].lastActive = new Date().toISOString();
                        
                        // Track best scores for family member
                        if (score !== undefined) {
                            if (!subscribers[s].family_members[m].best) subscribers[s].family_members[m].best = {};
                            if (!subscribers[s].family_members[m].best[game] || score > subscribers[s].family_members[m].best[game]) {
                                subscribers[s].family_members[m].best[game] = score;
                            }
                        }
                        
                        writeJSON(SUBSCRIBERS_FILE, subscribers);
                        
                        var gameNames2 = { sequence: 'Sequence Memory', startrail: 'StarTrail', duo: 'Pattern Duo', gonogo: 'Go/No-Go' };
                        var gameName2 = gameNames2[game] || game;
                        var scoreText2 = score !== undefined ? ' | Score: ' + score : '';
                        var shiftLevel2 = score !== undefined ? getShiftFromScore(score) : null;
                        var shiftText2 = shiftLevel2 ? ' | Shift ' + shiftLevel2 : '';
                        logActivity('game_session', memberName, null, gameName2 + scoreText2 + shiftText2);
                        
                        return res.json({ 
                            success: true, 
                            sessions: subscribers[s].family_members[m].sessions[game],
                            streak: 1,
                            personalBest: subscribers[s].family_members[m].best ? subscribers[s].family_members[m].best[game] : score
                        });
                    }
                }
            }
        }
    }
    
    if (userIndex === -1 && !isSubscriber) return res.status(404).json({ error: 'User not found' });
    
    // Handle facility user (original logic)
    if (userIndex !== -1) {
        var user = users[userIndex];
        var sessionKey = 'sessions_' + game;
        if (!users[userIndex][sessionKey]) users[userIndex][sessionKey] = 0;
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
        
        if (game === 'gonogo' && req.body.rt) {
            var rt = req.body.rt;
            if (!users[userIndex].rt_history) users[userIndex].rt_history = [];
            users[userIndex].rt_history.push({
                date: new Date().toISOString(), average: rt.average || 0, fastest: rt.fastest || 0,
                slowest: rt.slowest || 0, consistency: rt.consistency || 0, totalTaps: rt.totalTaps || 0,
                accuracy: req.body.accuracy || 0, score: score || 0
            });
            if (users[userIndex].rt_history.length > 50) {
                users[userIndex].rt_history = users[userIndex].rt_history.slice(-50);
            }
            if (!users[userIndex].best_rt || (rt.average > 0 && rt.average < users[userIndex].best_rt)) {
                users[userIndex].best_rt = rt.average;
            }
            users[userIndex].latest_rt = { average: rt.average, fastest: rt.fastest, consistency: rt.consistency };
        }
        
        writeJSON(USERS_FILE, users);
        
        var codes = readJSON(CODES_FILE);
        var licenses = readJSON(LICENSES_FILE);
        var facilityName = 'Unknown';
        for (var c = 0; c < codes.length; c++) {
            if (codes[c].code === user.code) {
                for (var l = 0; l < licenses.length; l++) {
                    if (licenses[l].key === codes[c].licenseKey) { facilityName = licenses[l].facilityName; break; }
                }
                break;
            }
        }
        
        var gameNames = { sequence: 'Sequence Memory', startrail: 'StarTrail', duo: 'Pattern Duo' };
        var gameName = gameNames[game] || game;
        var scoreText = score !== undefined ? ' | Score: ' + score : '';
        var shiftLevel = score !== undefined ? getShiftFromScore(score) : null;
        var shiftText = shiftLevel ? ' | Shift ' + shiftLevel : '';
        logActivity('game_session', user.username, facilityName, gameName + scoreText + shiftText);
        
        res.json({ 
            success: true, 
            sessions: users[userIndex][sessionKey],
            streak: users[userIndex].streak,
            personalBest: users[userIndex]['best_' + game]
        });
    }
});

app.get('/api/game/stats/pin/:pin', function(req, res) {
    var pin = req.params.pin;
    var users = readJSON(USERS_FILE);
    var user = null;
    for (var i = 0; i < users.length; i++) {
        if (users[i].pin === pin) { user = users[i]; break; }
    }
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
        success: true, username: user.username,
        stats: {
            sessions: {
                sequence: user.sessions_sequence || 0, startrail: user.sessions_startrail || 0,
                duo: user.sessions_duo || 0, gonogo: user.sessions_gonogo || 0
            },
            totalSessions: (user.sessions_sequence || 0) + (user.sessions_startrail || 0) + (user.sessions_duo || 0) + (user.sessions_gonogo || 0),
            streak: user.streak || 0,
            personalBests: {
                sequence: user.best_sequence || 0, startrail: user.best_startrail || 0,
                duo: user.best_duo || 0, gonogo: user.best_gonogo || 0
            }
        }
    });
});

app.get('/api/game/stats/:accessCode/:username', function(req, res) {
    var accessCode = req.params.accessCode;
    var username = req.params.username;
    var users = readJSON(USERS_FILE);
    var user = null;
    for (var i = 0; i < users.length; i++) {
        if (users[i].code === accessCode && users[i].username.toLowerCase() === username.toLowerCase()) {
            user = users[i]; break;
        }
    }
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
        success: true,
        stats: {
            sessions: { sequence: user.sessions_sequence || 0, startrail: user.sessions_startrail || 0, duo: user.sessions_duo || 0 },
            totalSessions: (user.sessions_sequence || 0) + (user.sessions_startrail || 0) + (user.sessions_duo || 0),
            streak: user.streak || 0,
            personalBests: { sequence: user.best_sequence || 0, startrail: user.best_startrail || 0, duo: user.best_duo || 0 }
        }
    });
});

// ============ TRIAL ROUTES ============

app.get('/trial', function(req, res) { res.sendFile(path.join(__dirname, 'trial.html')); });

app.post('/api/trial/register', function(req, res) {
    var facilityName = req.body.facilityName;
    var contactName = req.body.contactName;
    var email = req.body.email;
    var phone = req.body.phone;
    if (!facilityName || !contactName || !email) return res.status(400).json({ error: 'Missing required fields' });
    var licenses = readJSON(LICENSES_FILE);
    var existingTrial = null;
    for (var i = 0; i < licenses.length; i++) {
        if (licenses[i].email === email && licenses[i].isTrial) { existingTrial = licenses[i]; break; }
    }
    if (existingTrial) return res.status(400).json({ error: 'Email already used for a free trial' });
    var licenseKey = generateLicensePin();
    var expirationDate = new Date();
    expirationDate.setDate(expirationDate.getDate() + 7);
    var newLicense = {
        key: licenseKey, facilityName: facilityName, contactName: contactName, email: email,
        phone: phone || '', expirationDate: expirationDate.toISOString().split('T')[0],
        userPool: 10, createdAt: new Date().toISOString(), active: true, isTrial: true
    };
    licenses.push(newLicense);
    writeJSON(LICENSES_FILE, licenses);
    res.json({ success: true, licenseKey: licenseKey, expirationDate: newLicense.expirationDate });
});

// ============ START SERVER ============

app.listen(PORT, function() {
    console.log('GoTrotters running on port ' + PORT);
    console.log('Admin Dashboard: /admin-dashboard');
    console.log('Legacy Admin: /admin');
    console.log('Stripe configured:', !!stripe);
    console.log('Price IDs:', STRIPE_PRICES);
});
