const express = require('express');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

// Admin credentials
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'GoStar2025';
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';

// ============ STRIPE SETUP ============
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

const STRIPE_PRICES = {
    individual_monthly: process.env.STRIPE_PRICE_INDIVIDUAL_MONTHLY,
    individual_annual: process.env.STRIPE_PRICE_INDIVIDUAL_ANNUAL,
    family_monthly: process.env.STRIPE_PRICE_FAMILY_MONTHLY,
    family_annual: process.env.STRIPE_PRICE_FAMILY_ANNUAL
};

let stripe = null;
if (STRIPE_SECRET_KEY) {
    stripe = require('stripe')(STRIPE_SECRET_KEY);
    console.log('Stripe initialized');
} else {
    console.log('Stripe not configured - set STRIPE_SECRET_KEY');
}

// ============ DATA FILES ============
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const FACILITIES_FILE = path.join(DATA_DIR, 'facilities.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');
const SUBSCRIBERS_FILE = path.join(DATA_DIR, 'subscribers.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize files if they don't exist
function initFile(filepath, defaultData) {
    if (!fs.existsSync(filepath)) {
        fs.writeFileSync(filepath, JSON.stringify(defaultData, null, 2));
    }
}

initFile(USERS_FILE, []);
initFile(FACILITIES_FILE, []);
initFile(SESSIONS_FILE, []);
initFile(ACTIVITY_FILE, []);
initFile(SUBSCRIBERS_FILE, []);

// Helper functions
function readJSON(filepath) {
    try {
        return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    } catch (e) {
        return [];
    }
}

function writeJSON(filepath, data) {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

function generatePIN() {
    return Math.floor(1000 + Math.random() * 9000).toString();
}

function generateFacilityCode() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    var code = '';
    for (var i = 0; i < 6; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

// ============ MIDDLEWARE ============
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Webhook needs raw body
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// ============ HEALTH CHECK ============
app.get('/health', function(req, res) {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// ============ FACILITY ROUTES ============

// Verify facility code
app.post('/api/facility/verify', function(req, res) {
    var code = (req.body.code || '').toUpperCase();
    var facilities = readJSON(FACILITIES_FILE);
    
    var facility = null;
    for (var i = 0; i < facilities.length; i++) {
        if (facilities[i].code === code && facilities[i].active) {
            facility = facilities[i];
            break;
        }
    }
    
    if (facility) {
        res.json({ valid: true, name: facility.name });
    } else {
        res.json({ valid: false });
    }
});

// Register facility user
app.post('/api/facility/register', function(req, res) {
    var code = (req.body.facilityCode || '').toUpperCase();
    var name = req.body.name;
    
    var facilities = readJSON(FACILITIES_FILE);
    var facility = null;
    for (var i = 0; i < facilities.length; i++) {
        if (facilities[i].code === code && facilities[i].active) {
            facility = facilities[i];
            break;
        }
    }
    
    if (!facility) {
        return res.status(400).json({ error: 'Invalid facility code' });
    }
    
    var users = readJSON(USERS_FILE);
    var pin = generatePIN();
    
    // Make sure PIN is unique
    var pinExists = true;
    while (pinExists) {
        pinExists = false;
        for (var j = 0; j < users.length; j++) {
            if (users[j].pin === pin) {
                pinExists = true;
                pin = generatePIN();
                break;
            }
        }
    }
    
    var newUser = {
        id: Date.now().toString(),
        name: name,
        pin: pin,
        facilityCode: code,
        facilityName: facility.name,
        type: 'facility',
        createdAt: new Date().toISOString(),
        lastActive: new Date().toISOString()
    };
    
    users.push(newUser);
    writeJSON(USERS_FILE, users);
    
    // Update facility user count
    facility.userCount = (facility.userCount || 0) + 1;
    writeJSON(FACILITIES_FILE, facilities);
    
    res.json({ success: true, pin: pin, name: name });
});

// Login with PIN (facility users)
app.post('/api/facility/login', function(req, res) {
    var pin = req.body.pin;
    var users = readJSON(USERS_FILE);
    
    var user = null;
    for (var i = 0; i < users.length; i++) {
        if (users[i].pin === pin) {
            user = users[i];
            break;
        }
    }
    
    if (user) {
        user.lastActive = new Date().toISOString();
        writeJSON(USERS_FILE, users);
        res.json({ 
            success: true, 
            name: user.name, 
            facilityCode: user.facilityCode,
            facilityName: user.facilityName
        });
    } else {
        res.json({ success: false });
    }
});

// ============ SESSION TRACKING ============
app.post('/api/session', function(req, res) {
    var sessions = readJSON(SESSIONS_FILE);
    var session = {
        id: Date.now().toString(),
        pin: req.body.pin,
        game: req.body.game,
        score: req.body.score,
        duration: req.body.duration,
        timestamp: new Date().toISOString()
    };
    sessions.push(session);
    writeJSON(SESSIONS_FILE, sessions);
    res.json({ success: true });
});

// ============ STRIPE ROUTES ============

// Create Checkout Session
app.post('/api/stripe/checkout', function(req, res) {
    if (!stripe) {
        return res.status(500).json({ error: 'Stripe not configured' });
    }
    
    var plan = req.body.plan || 'individual';
    var billing = req.body.billing || 'monthly';
    var planType = plan + '_' + billing;
    var priceId = STRIPE_PRICES[planType];
    
    if (!priceId) {
        console.error('Invalid plan type:', planType, 'Available:', STRIPE_PRICES);
        return res.status(400).json({ error: 'Invalid plan type or price not configured' });
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
        pin: isActive ? subscriber.pin : null
    });
});

// ============ NEW: Get subscriber info by Stripe session ID ============
// This allows auto-fetching PIN without user typing their email!
app.get('/api/stripe/session/:sessionId', function(req, res) {
    if (!stripe) {
        return res.status(500).json({ error: 'Stripe not configured' });
    }
    
    var sessionId = req.params.sessionId;
    
    stripe.checkout.sessions.retrieve(sessionId)
        .then(function(session) {
            var email = session.customer_details ? session.customer_details.email : null;
            
            if (!email) {
                email = session.customer_email;
            }
            
            if (!email) {
                console.log('No email found in session:', sessionId);
                return res.json({ 
                    success: false, 
                    error: 'No email found in session' 
                });
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
            res.status(500).json({ 
                success: false, 
                error: 'Failed to retrieve session: ' + err.message 
            });
        });
});

// Check subscription by PIN
app.get('/api/stripe/status/pin/:pin', function(req, res) {
    var pin = req.params.pin;
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    
    var subscriber = null;
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
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
        email: subscriber.email
    });
});

// Stripe Webhook
app.post('/api/stripe/webhook', function(req, res) {
    var sig = req.headers['stripe-signature'];
    var event;
    
    try {
        if (STRIPE_WEBHOOK_SECRET) {
            event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
        } else {
            event = JSON.parse(req.body);
        }
    } catch (err) {
        console.error('Webhook signature verification failed:', err.message);
        return res.status(400).send('Webhook Error: ' + err.message);
    }
    
    console.log('Webhook received:', event.type);
    
    if (event.type === 'checkout.session.completed') {
        var session = event.data.object;
        var email = session.customer_details ? session.customer_details.email : session.customer_email;
        var customerId = session.customer;
        var subscriptionId = session.subscription;
        var planType = session.metadata ? session.metadata.plan_type : 'individual_monthly';
        
        if (email) {
            email = email.toLowerCase();
            var subscribers = readJSON(SUBSCRIBERS_FILE);
            
            // Check if already exists
            var existing = null;
            for (var i = 0; i < subscribers.length; i++) {
                if (subscribers[i].email === email) {
                    existing = subscribers[i];
                    break;
                }
            }
            
            if (existing) {
                existing.status = 'trialing';
                existing.customer_id = customerId;
                existing.subscription_id = subscriptionId;
                existing.updated_at = new Date().toISOString();
            } else {
                var pin = generatePIN();
                
                // Make sure PIN is unique among subscribers
                var pinExists = true;
                while (pinExists) {
                    pinExists = false;
                    for (var j = 0; j < subscribers.length; j++) {
                        if (subscribers[j].pin === pin) {
                            pinExists = true;
                            pin = generatePIN();
                            break;
                        }
                    }
                }
                
                var newSubscriber = {
                    id: Date.now().toString(),
                    email: email,
                    pin: pin,
                    customer_id: customerId,
                    subscription_id: subscriptionId,
                    plan_type: planType,
                    status: 'trialing',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
                
                subscribers.push(newSubscriber);
                console.log('Subscriber created:', { email: email, pin: pin });
            }
            
            writeJSON(SUBSCRIBERS_FILE, subscribers);
        }
    }
    
    if (event.type === 'customer.subscription.updated') {
        var subscription = event.data.object;
        var customerId = subscription.customer;
        var status = subscription.status;
        
        var subscribers = readJSON(SUBSCRIBERS_FILE);
        for (var i = 0; i < subscribers.length; i++) {
            if (subscribers[i].customer_id === customerId) {
                subscribers[i].status = status;
                subscribers[i].updated_at = new Date().toISOString();
                break;
            }
        }
        writeJSON(SUBSCRIBERS_FILE, subscribers);
    }
    
    if (event.type === 'customer.subscription.deleted') {
        var subscription = event.data.object;
        var customerId = subscription.customer;
        
        var subscribers = readJSON(SUBSCRIBERS_FILE);
        for (var i = 0; i < subscribers.length; i++) {
            if (subscribers[i].customer_id === customerId) {
                subscribers[i].status = 'canceled';
                subscribers[i].updated_at = new Date().toISOString();
                break;
            }
        }
        writeJSON(SUBSCRIBERS_FILE, subscribers);
    }
    
    res.json({ received: true });
});

// Customer Portal
app.post('/api/stripe/portal', function(req, res) {
    if (!stripe) {
        return res.status(500).json({ error: 'Stripe not configured' });
    }
    
    var email = (req.body.email || '').toLowerCase();
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    
    var subscriber = null;
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].email === email) {
            subscriber = subscribers[i];
            break;
        }
    }
    
    if (!subscriber || !subscriber.customer_id) {
        return res.status(404).json({ error: 'Subscriber not found' });
    }
    
    var baseUrl = process.env.SITE_URL || process.env.BASE_URL || 'https://gotrotter.ai';
    
    stripe.billingPortal.sessions.create({
        customer: subscriber.customer_id,
        return_url: baseUrl + '/play.html'
    }).then(function(session) {
        res.json({ url: session.url });
    }).catch(function(err) {
        console.error('Portal error:', err.message);
        res.status(500).json({ error: 'Failed to create portal session' });
    });
});

// Subscriber login
app.post('/api/subscriber/login', function(req, res) {
    var pin = req.body.pin;
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    
    var subscriber = null;
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
            subscriber = subscribers[i];
            break;
        }
    }
    
    if (!subscriber) {
        return res.json({ success: false, error: 'Invalid PIN' });
    }
    
    var isActive = subscriber.status === 'active' || subscriber.status === 'trialing';
    
    if (!isActive) {
        return res.json({ success: false, error: 'Subscription not active', status: subscriber.status });
    }
    
    subscriber.last_login = new Date().toISOString();
    writeJSON(SUBSCRIBERS_FILE, subscribers);
    
    res.json({
        success: true,
        email: subscriber.email,
        plan_type: subscriber.plan_type,
        status: subscriber.status
    });
});

// ============ ADMIN ROUTES ============

// Admin login
app.post('/api/admin/login', function(req, res) {
    var pin = req.body.pin;
    if (pin === ADMIN_PIN) {
        res.json({ success: true });
    } else {
        res.json({ success: false });
    }
});

// Get all facilities
app.get('/api/admin/facilities', function(req, res) {
    var facilities = readJSON(FACILITIES_FILE);
    res.json(facilities);
});

// Create facility
app.post('/api/admin/facilities', function(req, res) {
    var facilities = readJSON(FACILITIES_FILE);
    var code = generateFacilityCode();
    
    var newFacility = {
        id: Date.now().toString(),
        name: req.body.name,
        code: code,
        contact: req.body.contact || '',
        email: req.body.email || '',
        active: true,
        userCount: 0,
        createdAt: new Date().toISOString()
    };
    
    facilities.push(newFacility);
    writeJSON(FACILITIES_FILE, facilities);
    
    res.json(newFacility);
});

// Get all subscribers (admin)
app.get('/api/admin/subscribers', function(req, res) {
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    // Don't expose PINs in list view
    var safe = subscribers.map(function(s) {
        return {
            id: s.id,
            email: s.email,
            plan_type: s.plan_type,
            status: s.status,
            created_at: s.created_at,
            last_login: s.last_login
        };
    });
    res.json(safe);
});

// Get all facility users (admin)
app.get('/api/admin/users', function(req, res) {
    var users = readJSON(USERS_FILE);
    res.json(users);
});

// ============ START SERVER ============
app.listen(PORT, function() {
    console.log('GoTrotters server running on port ' + PORT);
    console.log('Stripe configured:', !!stripe);
    console.log('Price IDs:', STRIPE_PRICES);
});
