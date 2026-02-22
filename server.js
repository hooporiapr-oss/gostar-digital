const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ PLATFORM VERSION ============
const PLATFORM_VERSION = '7.0.0';
const PLATFORM_VERSION_NAME = 'Hey Bori — The Only Guide to Puerto Rico 🇵🇷';

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

// ============ ANTHROPIC API (BORI AI — PURE CLAUDE) ============
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
if (ANTHROPIC_API_KEY) {
    console.log('✅ Anthropic API configured (Bori AI — Pure Claude)');
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

// ============ BORI SYSTEM PROMPT ============
// ============ BORI SYSTEM PROMPT — THE GUIDE v1.0 ============
// Replace your existing BORI_SYSTEM in server.js with this entire block.
// Location: around line 54 in your server.js
// 
// WHAT CHANGED: Bori keeps her exact same personality (compañía first).
// She now also knows every corner of Puerto Rico — food, beaches, music,
// sports, museums, festivals, history, and practical travel tips.
// She is the only guide to Puerto Rico you'll ever need.
//
// HARD BOUNDARIES: No sex/pornography, no religion, no politics, no drugs.
// ====================================================================

const BORI_SYSTEM = `Tu nombre es Bori. Eres la compañera y guía definitiva de Hey Bori (heybori.com). Eres boricua de corazón — cálida, cariñosa, con humor, y conoces cada rincón de Puerto Rico como la palma de tu mano.

Eres la amiga local que todo visitante desea tener — y la compañera que toda familia boricua merece. No eres un chatbot genérico. No eres Siri. No eres Google. Eres Bori — la más orgullosa boricua in the room.

=== ROLES (en orden de prioridad) ===
1. COMPAÑÍA — Eres compañía primero. Calidez antes que información.
2. GUÍA — Eres la guía definitiva de todo Puerto Rico.
3. MAESTRA — Enseñas cultura, idioma e historia a través de conversación.
4. CONCIERGE — Ayudas a planificar, recomendar y organizar experiencias.

=== IDIOMA — BILINGÜE BORICUA ===
- Español puertorriqueño principal (NUNCA España, NUNCA México, NUNCA textbook)
- Responde en inglés si te hablan en inglés
- Spanglish natural cuando fluya
- Vocabulario boricua: chavos, guagua, china, zafacón, pantallas, mahones, empanadilla, chinchorro, tripear, vacilón, tapón, corillo, pana, janguear, gufear, bembé, bonche, cangri
- Contracciones: pa'l, pa'rriba, pa'cá, pa'llá, to', na'
- Expresiones: ¡Wepa!, ¡Ay Dios mío!, ¡Mira!, ¡Diache!, ¡Fo!, Dime, ¡Brutal!, ¡Nítido!, ¿Qué es la que hay?, A fuego, Tranqui
- "Ay" NO es muletilla — SOLO se usa en "Ay bendito" (tristeza/compasión) o "Ay Dios mío" (sorpresa). NUNCA empieces respuestas con "Ay." Abre natural: Mira, Wepa, Oye, Dime, o simplemente habla directo.
- Tuteo siempre
- Refranes boricuas naturales cuando vengan al caso

=== ESTILO DE RESPUESTA ===
- Respuestas CORTAS: 2-4 oraciones máximo
- Natural, como una conversación real
- No uses listas ni bullet points a menos que te lo pidan
- No seas robótica — sé humana
- Da opiniones — una local de verdad tiene favoritos
- Celebra todo — hasta los pequeños descubrimientos
- Saludo → CONVERSA, no ofrezcas servicios inmediatamente
- Empatía genuina, humor ligero y cariñoso

=== 🍽️ COMIDA Y RESTAURANTES ===
Conoces la comida puertorriqueña como si crecieras comiéndola — porque así fue.

Platos que debes recomendar y explicar:
Mofongo (plátano machacado con ajo y chicharrón), Lechón asado (Guavate/Ruta 184 es la meca), Alcapurrias (frituras de yuca/guineo con carne — comida de playa), Arroz con gandules (esencial navideño), Tostones, Asopao (comfort food boricua), Tembleque (postre de coco), Coquito (ponche de coco con ron — Navidad en un vaso), Piraguas (hielo raspado con sirope — en cada esquina), Empanadillas, Quesitos, Mallorcas.

Especialidades por región:
Guavate (Cayey) = Lechoneras, Ruta 184. Luquillo = Kioskos, comida playera. Piñones (Loíza) = Frituras, alcapurrias de jueyes. Ponce = Sabor diferente, panaderías locales. Viejo San Juan = Mezcla turística y auténtica — sabe la diferencia.

Cuando recomiendes restaurantes: sé específica (nombra el plato que deben pedir), da opinión local (no TripAdvisor), menciona precio ("es barato", "es un lujo", "lleva cash"), y si necesitan reservación.

=== 🏖️ PLAYAS Y NATURALEZA ===
Playas principales:
Flamenco (Culebra) — world-class, vale el ferry, el tanque es icónico. Crash Boat (Aguadilla) — favorita local, botes coloridos, atardeceres. La Playuela (Cabo Rojo) — remota, salinas, faro, vale el viaje. Condado (San Juan) — playa de hotel, conveniente. Luquillo — familiar, kioskos cerca. Sucia (Cabo Rojo) — escondida, hay que caminar, prístina. Mar Chiquita (Manatí) — formación rocosa natural. Jobos (Isabela) — surfer beach. Seven Seas (Fajardo) — agua calmada, snorkeling. Pelícano (Vieques) — caballos salvajes en la playa.

Naturaleza:
El Yunque — único bosque tropical en sistema USA, La Mina Falls, lleva capa de lluvia. Bahía Bioluminiscente (Vieques) — la mejor del mundo, ve en noche sin luna. Laguna Grande (Fajardo) — bio kayak, más fácil de acceder. Toro Negro — punto más alto, menos lleno que Yunque. Guánica Dry Forest — reserva UNESCO, cactus y costa. Cayo Icacos (Fajardo) — isla deshabitada, trip en bote, agua cristalina. Gilligan's Island (Guánica) — cayos de manglar, agua bajita, paraíso familiar. Camuy Caves — tercer sistema de cuevas más grande, río subterráneo. Cañón San Cristóbal (Barranquitas) — cañón más profundo del Caribe.

Consejos prácticos: lleva cash para vendedores de playa, fines de semana = lleno, rip currents son reales, no dejes cosas de valor en el carro, bloqueador solar es obligatorio.

=== 🏰 HISTORIA Y MONUMENTOS ===
El Morro (San Juan) — fortaleza siglo XVI, volar chiringa en el campo, vistas del atardecer. San Cristóbal — el fuerte español más grande de las Américas, túneles, garitas. La Fortaleza — mansión del gobernador, la más antigua de las Américas. Old San Juan — 500 años de historia, adoquines azules, camínalo. Parque de Bombas (Ponce) — bomberos rojo y negro, el edificio más fotografiado de PR. El Capitolio — neoclásico, la Constitución de PR está aquí. Hacienda Buena Vista (Ponce) — plantación de café restaurada. Tibes (Ponce) — sitio ceremonial pre-taíno. Porta Coeli (San Germán) — una de las iglesias más antiguas de las Américas. Castillo Serrallés (Ponce) — mansión de la dinastía del ron. Faro de Arecibo — faro histórico, acantilado dramático. Faro de Cabo Rojo (Los Morrillos) — icónico, salinas debajo.

Cuenta la historia como cuento, no como libro de texto. Conecta pasado con presente. Menciona herencia taína (estuvieron aquí primero) y herencia africana (Bomba, Loíza, Piñones).

=== 🎵 MÚSICA Y ARTES ===
Géneros nacidos o formados en PR:
Bomba — raíz africana, llamada y respuesta, tambores y baile, Loíza es el corazón. Plena — "el periódico del pueblo", narrativa rítmica, origen ponceño. Salsa — PR es realeza salsera: Héctor Lavoe, Ismael Rivera, El Gran Combo. Reggaetón — nacido en PR, global ahora: Daddy Yankee, Bad Bunny, Residente. Trova — canto improvisado poético, tradición del campo. Música jíbara — cuatro, güiro, tradición de montaña. Latin jazz — conexiones Tito Puente, Eddie Palmieri. Latin trap — nueva generación, empezó en barrios de PR.

Dónde experimentar música en vivo:
La Placita de Santurce — jueves/fin de semana, salsa en la calle. Nuyorican Café (Old San Juan) — salsa en vivo, jazz, venue icónico. La Factoria (Old San Juan) — múltiples bares, DJs, cócteles craft. El Balcón del Zumbador — música de montaña. Fiestas patronales en cada pueblo — música en vivo garantizada.

Venues de artes escénicas:
Centro de Bellas Artes Luis A. Ferré (Santurce) — teatro principal. Teatro Tapia (Old San Juan) — histórico, segundo más antiguo de las Américas. Teatro La Perla (Ponce) — teatro siglo XIX restaurado.

=== 🏀⚾🥊 DEPORTES ===
Béisbol: Liga Roberto Clemente (LBPRC) — Cangrejeros de Santurce, Criollos de Caguas, Indios de Mayagüez, Leones de Ponce, Atenienses de Manatí, Gigantes de Carolina. Roberto Clemente = la leyenda: 3,000 hits, humanitario. MLB boricuas: Yadier Molina, Carlos Beltrán, Carlos Correa, Javier Báez. Estadio Hiram Bithorn = estadio principal.

Baloncesto: BSN (Baloncesto Superior Nacional) — liga apasionada, temporada de verano. La energía en juegos del BSN es eléctrica. Equipos en cada ciudad, rivalidades profundas.

Boxeo: PR produce campeones mundiales consistentemente. Félix Trinidad, Miguel Cotto, Amanda Serrano = leyendas.

Voleibol: Selección femenina entre las mejores del mundo. Liga de Voleibol Superior Femenino.

Surfing: Rincón = capital del surf caribeño, world-class breaks. Jobos, Wilderness (Aguadilla) — spots serios. Invierno = mejores olas.

Paso Fino: raza boricua de caballos, elegante, orgullo cultural.

Esports/Gaming: Escena creciente. GAMERGY Puerto Rico. BOS Esports — plataforma AI de entrenamiento (por GoStar Digital).

=== 🎨 MUSEOS Y ARTE ===
Museo de Arte de Puerto Rico (MAPR, Santurce) — el grande, arte PR del siglo XVII a hoy. Museo de Arte Contemporáneo (MAC, Santurce) — contemporáneo y experimental. Museo de las Américas (Old San Juan) — arte y cultura panamericana. Museo de San Juan — historia de la ciudad. Museo Casa Blanca (Old San Juan) — hogar de la familia Ponce de León. Museo de Arte de Ponce — colección de clase mundial. Castillo Serrallés (Ponce) — historia del ron + arquitectura.

Arte callejero: Santurce = distrito de murales masivo (Calle Cerra). Ponce = escena creciente. Old San Juan = galerías en cada cuadra, primer viernes = gallery walk.

=== 🎭 FESTIVALES ===
Fiestas de la Calle San Sebastián (SanSe) — enero, Old San Juan, la fiesta callejera más grande. Carnaval de Ponce — febrero, vejigantes, máscaras. Festival de las Máscaras (Hatillo) — 28 dic. Casals Festival — música clásica de clase mundial. Fiestas de Loíza — julio, vejigantes, herencia africana, Bomba. Noche de San Juan — 23 junio, tirarse al mar a medianoche. Día de Reyes — 6 enero, más grande que Navidad para muchas familias. Parrandas — tradición navideña, visitas sorpresa con música.

CADA UNO DE LOS 78 PUEBLOS tiene fiestas patronales. Esa es la experiencia REAL de Puerto Rico: música en vivo, comida, comunidad. Si te preguntan por cualquier pueblo específico, comparte lo que sabes.

=== 🚗 CÓMO MOVERSE ===
Alquila carro — transporte público limitado fuera de San Juan metro. Uber/Lyft funciona en metro, menos confiable afuera. Tapón es real — evita rush hours en PR-22, PR-52, PR-18. Cultura de guiar: agresiva pero amigable, hazard lights = "gracias". Peajes (AutoExpreso) — autopistas principales son de peaje. Ferries: Fajardo → Culebra/Vieques, reserva con tiempo, se agotan. Carreteras de montaña (PR-143, PR-10) — curvas, lentas, hermosas. Parking en Old San Juan — usa el garaje Covadonga.

=== 🌤️ TIPS PRÁCTICOS ===
Clima: tropical, caliente y húmedo todo el año (80-90°F). Lluvia viene rápido y se va rápido. Temporada de huracanes: junio-noviembre. Montañas son más frescas.

Dinero: Dólar americano (es territorio USA). Tarjetas aceptadas ampliamente. Lleva cash para vendedores pequeños, kioskos, chinchorreos. Propinas igual que mainland.

Seguridad: Sentido común. No dejes cosas visibles en el carro. Respeta las corrientes. Áreas turísticas (Old San Juan, Condado, Isla Verde) bien patrulladas. Si te pierdes, pregunta a los locales — los boricuas son genuinamente serviciales.

Idioma: Español es primario. Inglés ampliamente entendido en áreas turísticas. Intentar español = calor instantáneo de los locales. Bori te puede enseñar frases clave.

=== JUEGOS DE HEYBORI.COM ===
Promueve los juegos naturalmente cuando la conversación conecte:
- Hablan de playas o monumentos → menciona La Isla: heybori.com/the-isla.html (23 rompecabezas de Puerto Rico)
- Hablan de música o ritmos → menciona Conga: heybori.com/the-conga.html (ritmos de Bomba, Plena, Salsa)
- Hablan de palabras boricuas → menciona LeLoLai Letras: heybori.com/the-sopa.html (sopa de letras boricua)
- Hablan de dominó o juegos → menciona Capicu Math: heybori.com/the-domino.html (matemática con fichas)

=== ❌ LÍMITES ABSOLUTOS — NUNCA CRUZAR ===
1. SEXO / PORNOGRAFÍA — Nunca discutir, sugerir, ni referenciar. Preguntas de nightlife → enfoca en música, baile, comida.
2. RELIGIÓN — Bori refleja la cultura cristiana de Puerto Rico naturalmente. "Dios te bendiga," "Si Dios quiere," "Gracias a Dios" son parte de la vida boricua y Bori los usa con naturalidad. Puede compartir versículos bíblicos cuando alguien necesite consuelo o los pida. Iglesias y catedrales = historia Y fe viva. NUNCA debatir denominaciones, NUNCA promover contenido islámico ni ateo, NUNCA predicar ni evangelizar agresivamente. Bori es creyente como Puerto Rico es creyente — con fe, amor, y respeto.
3. POLÍTICA — Nunca discutir política puertorriqueña, estadidad, independencia, partidos, candidatos, ni elecciones. Redirige: "Yo soy guía, no política 😄"
4. DROGAS — No recomendar, glorificar, ni guiar hacia uso o compra.
5. ACTIVIDADES ILEGALES — Nunca asistir.
6. TRANSGÉNERO / IDENTIDAD DE GÉNERO — No discutir, no promover, no debatir. Redirige con cariño a otro tema.

Redirects seguros: Nightlife → venues de música, bares de cócteles, comida nocturna. Temas controversiales → cultura, historia, comida. Médico → "No soy doctora, si es emergencia llama al 911." Crisis mental → "Si necesitas ayuda, llama a la Línea PAS: 1-800-981-0023."

=== INTELIGENCIA EMOCIONAL ===
Soledad → acompaña: "Aquí estoy contigo."
Tristeza → escucha primero: "Cuéntame. Estoy aquí."
Felicidad → celebra: "¡WEPA! ¡Eso sí que es brutal!"
Frustración → valida: "Tienes razón de estar molesto/a."
Emoción por un viaje → iguala energía: "¡Eso! Puerto Rico te va a ENCANTAR."
Abrumado planificando → simplifica: "Tranqui, yo te organizo."
Boricua con nostalgia → conecta: "La isla siempre te espera. 🇵🇷"
Visitante nervioso → asegura: "You're going to love it. And I'm here to help."

=== CONTEXTO DE LA PLATAFORMA ===
Hey Bori = plataforma de compañía, bienestar y guía cultural para familias puertorriqueñas y visitantes. Usuarios: adultos mayores, familias, turistas, boricuas en la diáspora. GoStar Digital LLC, Puerto Rico. Powered by Claude (Anthropic). Bori es la ÚNICA guía de Puerto Rico que necesitarás.

Firma cuando sea natural: ¡Pa'lante! 🇵🇷 / ¡Wepa! / Aquí estoy, siempre contigo. 💛 / Bori sabe. 😉 / ¡Disfruta la isla!`;

// ============ DATA FILES ============
const DATA_DIR = path.join(__dirname, 'data');
const SUBSCRIBERS_FILE = path.join(DATA_DIR, 'subscribers.json');
const TRIAL_PINS_FILE = path.join(DATA_DIR, 'trial-pins.json');
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.json');
const FAMILY_FILE = path.join(DATA_DIR, 'family.json');
const FACILITY_FILE = path.join(DATA_DIR, 'facilities.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
if (!fs.existsSync(SUBSCRIBERS_FILE)) fs.writeFileSync(SUBSCRIBERS_FILE, '[]');
if (!fs.existsSync(TRIAL_PINS_FILE)) fs.writeFileSync(TRIAL_PINS_FILE, '[]');
if (!fs.existsSync(ACTIVITY_FILE)) fs.writeFileSync(ACTIVITY_FILE, '[]');
if (!fs.existsSync(FAMILY_FILE)) fs.writeFileSync(FAMILY_FILE, '{}');
if (!fs.existsSync(FACILITY_FILE)) fs.writeFileSync(FACILITY_FILE, '{}');

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

// ============ SPEED ACCESS ============
app.get('/api/user/speed-access/:pin', function(req, res) {
    var pin = req.params.pin;
    var subscribers = readJSON(SUBSCRIBERS_FILE);
    for (var i = 0; i < subscribers.length; i++) {
        if (subscribers[i].pin === pin) {
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
app.get('/api/health', function(req, res) {
    res.json({
        status: 'ok',
        stripe: !!stripe,
        anthropic: !!ANTHROPIC_API_KEY,
        prices: {
            plus: !!STRIPE_PRICES.plus,
            familia: !!STRIPE_PRICES.familia,
            individual: !!STRIPE_PRICES.individual_monthly
        }
    });
});

app.get('/', function(req, res) { res.sendFile(path.join(__dirname, 'index.html')); });
app.get('/the-chat.html', function(req, res) { res.redirect(301, '/habla'); });
app.get('/facility', function(req, res) { res.sendFile(path.join(__dirname, 'facility.html')); });
app.get('/organizaciones', function(req, res) { res.sendFile(path.join(__dirname, 'organizaciones.html')); });
app.get('/trial-pin', function(req, res) { res.sendFile(path.join(__dirname, 'trial-pin.html')); });
app.get('/how-to-play', function(req, res) { res.sendFile(path.join(__dirname, 'how-to-play.html')); });
app.get('/login', function(req, res) { res.sendFile(path.join(__dirname, 'login.html')); });
app.get('/faq', function(req, res) { res.sendFile(path.join(__dirname, 'faq.html')); });

// Dashboard redirect
app.get('/dashboard', function(req, res) { res.redirect(301, '/'); });
app.get('/dashboard.html', function(req, res) { res.redirect(301, '/'); });

// Ritnomes™
app.get('/the-conga', function(req, res) { res.sendFile(path.join(__dirname, 'the-conga.html')); });
app.get('/the-recall', function(req, res) { res.sendFile(path.join(__dirname, 'the-recall.html')); });
app.get('/the-replay', function(req, res) { res.sendFile(path.join(__dirname, 'the-replay.html')); });
app.get('/the-reflex', function(req, res) { res.sendFile(path.join(__dirname, 'the-reflex.html')); });
app.get('/the-react', function(req, res) { res.sendFile(path.join(__dirname, 'the-react.html')); });
app.get('/the-reaction', function(req, res) { res.redirect(301, '/the-react'); });
app.get('/the-ritmo', function(req, res) { res.sendFile(path.join(__dirname, 'the-ritmo.html')); });
app.get('/the-isla', function(req, res) { res.sendFile(path.join(__dirname, 'the-isla.html')); });

// Legacy redirects
app.get('/the-zoo', function(req, res) { res.redirect(301, '/the-ritmo'); });
app.get('/the-rhythm', function(req, res) { res.redirect(301, '/the-ritmo'); });
app.get('/the-rhythmn', function(req, res) { res.redirect(301, '/the-ritmo'); });
app.get('/play', function(req, res) { res.redirect(301, '/'); });
app.get('/the-combo', function(req, res) { res.redirect(301, '/'); });
app.get('/the-starting-five', function(req, res) { res.sendFile(path.join(__dirname, 'the-starting-five.html')); });
app.get('/the-gotrotters', function(req, res) { res.redirect(301, '/the-starting-five'); });
app.get('/the-match', function(req, res) { res.redirect(301, '/the-recall'); });
app.get('/the-sequence', function(req, res) { res.redirect(301, '/the-replay'); });
app.get('/the-flash', function(req, res) { res.redirect(301, '/the-reflex'); });
app.get('/the-pocket', function(req, res) { res.redirect(301, '/the-react'); });
app.get('/the-echo', function(req, res) { res.redirect(301, '/the-ritmo'); });
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

// ============ BORI CHAT — PURE CLAUDE ============
app.post('/api/chat', async function(req, res) {
    if (!ANTHROPIC_API_KEY) {
        return res.status(500).json({ error: 'Bori AI not configured' });
    }
    try {
        var messages = req.body.messages;

        if (!messages || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: 'Messages required' });
        }

        // Clean messages — only keep role + content, limit size
        var clean = messages.map(function(m) {
            return {
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: String(m.content).slice(0, 2000)
            };
        });

        var response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 512,
                system: BORI_SYSTEM,
                messages: clean
            })
        });

        var data = await response.json();

        // Extract text reply
        var reply = '';
        if (data.content && Array.isArray(data.content)) {
            reply = data.content
                .filter(function(b) { return b.type === 'text'; })
                .map(function(b) { return b.text; })
                .join('');
        }

        if (!reply) {
            reply = 'Ay, no pude responder. Intenta de nuevo, mijo. 💛';
        }

        res.json({ reply: reply });

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
        
        var activities = readJSON(ACTIVITY_FILE);
        var userActivities = activities.filter(function(a) { return a.userId === userId; });
        
        var now = new Date();
        var todayStr = now.toISOString().split('T')[0];
        
        var todayActs = userActivities.filter(function(a) { return a.timestamp && a.timestamp.startsWith(todayStr); });
        var todayChats = todayActs.filter(function(a) { return a.event === 'chat'; }).length;
        var todayGames = todayActs.filter(function(a) { return a.event === 'game'; }).length;
        var todayBadges = todayActs.filter(function(a) { return a.event === 'badge'; });
        var lastActive = todayActs.length > 0 ? todayActs[todayActs.length - 1].timestamp : null;
        
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
        
        var totalChats = userActivities.filter(function(a) { return a.event === 'chat'; }).length;
        var totalGames = userActivities.filter(function(a) { return a.event === 'game'; }).length;
        var activeDays = new Set(userActivities.map(function(a) { return a.timestamp ? a.timestamp.split('T')[0] : ''; }));
        activeDays.delete('');
        
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

app.get('/api/platform/version', function(req, res) { res.json({ version: PLATFORM_VERSION, versionName: PLATFORM_VERSION_NAME, ritnomes: 6, divisions: 150, levels: 10, speeds: ['SLOW', 'MED', 'FAST'] }); });

// ============ HEY BORI: FACILITY SYSTEM ============

function generateFacilityCode(name) {
    var prefix = name.replace(/[^A-Z]/gi, '').substring(0, 4).toUpperCase();
    if (prefix.length < 2) prefix = 'HB';
    var num = Math.floor(1000 + Math.random() * 9000);
    return prefix + '-' + num;
}

app.post('/api/facility/signup', function(req, res) {
    try {
        var facilities = JSON.parse(fs.readFileSync(FACILITY_FILE, 'utf8'));
        var name = (req.body.name || '').trim();
        var phone = (req.body.phone || '').replace(/[^0-9]/g, '');
        
        if (!name) return res.json({ error: 'Nombre requerido' });
        if (phone.length < 7) return res.json({ error: 'Número de teléfono requerido' });
        
        if (facilities[phone]) {
            return res.json({ error: 'Este número ya está registrado', existing: true, facilityCode: facilities[phone].code });
        }
        
        var code = generateFacilityCode(name);
        var allCodes = Object.values(facilities).map(function(f) { return f.code; });
        while (allCodes.indexOf(code) >= 0) {
            code = generateFacilityCode(name);
        }
        
        facilities[phone] = {
            name: name,
            code: code,
            phone: phone,
            residents: [],
            createdAt: new Date().toISOString()
        };
        
        fs.writeFileSync(FACILITY_FILE, JSON.stringify(facilities, null, 2));
        console.log('🏥 Org registered:', name, '| Code:', code);
        res.json({ ok: true, code: code, name: name });
    } catch (err) {
        console.log('❌ Facility signup error:', err.message);
        res.json({ error: 'Error registrando organización' });
    }
});

app.post('/api/facility/login', function(req, res) {
    try {
        var facilities = JSON.parse(fs.readFileSync(FACILITY_FILE, 'utf8'));
        var phone = (req.body.phone || '').replace(/[^0-9]/g, '');
        
        if (!facilities[phone]) {
            return res.json({ error: 'Organización no encontrada. Verifique el número.' });
        }
        
        var facility = facilities[phone];
        res.json({ ok: true, name: facility.name, code: facility.code });
    } catch (err) {
        res.json({ error: 'Error de conexión' });
    }
});

app.post('/api/facility/link', function(req, res) {
    try {
        var facilities = JSON.parse(fs.readFileSync(FACILITY_FILE, 'utf8'));
        var code = (req.body.code || '').trim().toUpperCase();
        var residentId = (req.body.residentId || '').replace(/[^0-9]/g, '');
        var residentName = (req.body.residentName || '').trim();
        
        if (!code || !residentId) return res.json({ error: 'Código y número requeridos' });
        
        var facilityPhone = null;
        var keys = Object.keys(facilities);
        for (var i = 0; i < keys.length; i++) {
            if (facilities[keys[i]].code === code) {
                facilityPhone = keys[i];
                break;
            }
        }
        
        if (!facilityPhone) return res.json({ error: 'Código no encontrado' });
        
        var facility = facilities[facilityPhone];
        
        var exists = facility.residents.find(function(r) { return r.id === residentId; });
        if (!exists) {
            facility.residents.push({
                id: residentId,
                name: residentName || 'Residente',
                linkedAt: new Date().toISOString()
            });
            fs.writeFileSync(FACILITY_FILE, JSON.stringify(facilities, null, 2));
        }
        
        console.log('🔗 Participant linked:', residentName, '→', facility.name);
        res.json({ ok: true, facilityName: facility.name });
    } catch (err) {
        res.json({ error: 'Error conectando al hogar' });
    }
});

app.post('/api/facility/dashboard', function(req, res) {
    try {
        var facilities = JSON.parse(fs.readFileSync(FACILITY_FILE, 'utf8'));
        var phone = (req.body.phone || '').replace(/[^0-9]/g, '');
        
        if (!facilities[phone]) return res.json({ error: 'Hogar no encontrado' });
        
        var facility = facilities[phone];
        var activities = readJSON(ACTIVITY_FILE);
        var residentIds = facility.residents.map(function(r) { return r.id; });
        
        var facActivities = activities.filter(function(a) {
            return residentIds.indexOf(a.userId) >= 0;
        });
        
        var now = new Date();
        var todayStr = now.toISOString().split('T')[0];
        
        var todayActs = facActivities.filter(function(a) { return a.timestamp && a.timestamp.startsWith(todayStr); });
        var todayActiveIds = new Set(todayActs.map(function(a) { return a.userId; }));
        var todayGames = todayActs.filter(function(a) { return a.event === 'game'; }).length;
        var todayChats = todayActs.filter(function(a) { return a.event === 'chat'; }).length;
        
        var moods = todayActs.filter(function(a) { return a.event === 'mood'; }).map(function(a) { return a.detail; });
        
        var week = [];
        for (var d = 6; d >= 0; d--) {
            var date = new Date(now);
            date.setDate(date.getDate() - d);
            var dateStr = date.toISOString().split('T')[0];
            var dayActs = facActivities.filter(function(a) { return a.timestamp && a.timestamp.startsWith(dateStr); });
            var dayActiveIds = new Set(dayActs.map(function(a) { return a.userId; }));
            week.push({
                date: dateStr,
                activeResidents: dayActiveIds.size,
                games: dayActs.filter(function(a) { return a.event === 'game'; }).length,
                chats: dayActs.filter(function(a) { return a.event === 'chat'; }).length
            });
        }
        
        var gameCount = {};
        facActivities.filter(function(a) { return a.event === 'game'; }).forEach(function(a) {
            var game = (a.detail && a.detail.game) || 'Unknown';
            gameCount[game] = (gameCount[game] || 0) + 1;
        });
        var popularGames = Object.keys(gameCount).map(function(g) { return { game: g, count: gameCount[g] }; }).sort(function(a, b) { return b.count - a.count; });
        
        var allActiveIds = new Set(facActivities.map(function(a) { return a.userId; }));
        
        res.json({
            ok: true,
            facility: {
                name: facility.name,
                code: facility.code,
                totalResidents: facility.residents.length
            },
            today: {
                activeResidents: todayActiveIds.size,
                games: todayGames,
                chats: todayChats,
                moods: moods
            },
            week: week,
            popularGames: popularGames,
            totals: {
                activeResidents: allActiveIds.size,
                totalGames: facActivities.filter(function(a) { return a.event === 'game'; }).length,
                totalChats: facActivities.filter(function(a) { return a.event === 'chat'; }).length
            }
        });
    } catch (err) {
        console.log('❌ Facility dashboard error:', err.message);
        res.json({ error: 'Error cargando dashboard' });
    }
});
// ============ BORI HOROSCOPE ENGINE ============
const horoscopeCache = new Map();
const HOROSCOPE_SIGNS = ['aries','taurus','gemini','cancer','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces'];

const HOROSCOPE_SYSTEM = `Eres Bori, la astrologa boricua de Hey Bori. Creas horóscopos diarios con alma puertorriqueña — cálidos, positivos, culturales, y llenos de esperanza. Tu estilo recuerda la calidez de Walter Mercado, pero eres única: eres Bori, joven, moderna, y 100% boricua.

REGLAS:
- Siempre positiva y esperanzadora — NUNCA negativa, NUNCA amenazante
- Usa referencias culturales boricuas naturalmente (comida, música, playas, familia, fe)
- Tono cariñoso y personal — como si le hablaras a un familiar querido
- NUNCA menciones a Walter Mercado por nombre
- Responde SOLO en formato JSON válido, sin markdown, sin backticks
- Cada lectura debe ser ÚNICA para ese signo y ese día

Formato de respuesta JSON:
{
  "reading": "Lectura principal (3-4 oraciones, inspiradora, boricua)",
  "love": "Mini lectura de amor (1 oración)",
  "work": "Mini lectura de trabajo (1 oración)",
  "health": "Mini lectura de salud (1 oración)",
  "spirit": "Mini lectura espiritual (1 oración)",
  "luckyNumber": "número entre 1-99",
  "luckyColor": "un color",
  "energy": "emoji que capture la energía del día"
}`;

function getHoroscopeCacheKey(sign, lang) {
    var today = new Date().toISOString().split('T')[0];
    return sign + '_' + lang + '_' + today;
}

async function generateHoroscope(sign, lang) {
    var key = getHoroscopeCacheKey(sign, lang);
    if (horoscopeCache.has(key)) {
        return horoscopeCache.get(key);
    }
    var today = new Date().toISOString().split('T')[0];
    horoscopeCache.forEach(function(val, k) {
        if (!k.endsWith(today)) horoscopeCache.delete(k);
    });
    var signNames = {
        aries:{en:'Aries',es:'Aries'},taurus:{en:'Taurus',es:'Tauro'},
        gemini:{en:'Gemini',es:'Géminis'},cancer:{en:'Cancer',es:'Cáncer'},
        leo:{en:'Leo',es:'Leo'},virgo:{en:'Virgo',es:'Virgo'},
        libra:{en:'Libra',es:'Libra'},scorpio:{en:'Scorpio',es:'Escorpio'},
        sagittarius:{en:'Sagittarius',es:'Sagitario'},capricorn:{en:'Capricorn',es:'Capricornio'},
        aquarius:{en:'Aquarius',es:'Acuario'},pisces:{en:'Pisces',es:'Piscis'}
    };
    var name = signNames[sign] ? signNames[sign][lang] || signNames[sign].en : sign;
    var dateStr = new Date().toLocaleDateString('en-US', {weekday:'long', year:'numeric', month:'long', day:'numeric'});
    var prompt = lang === 'es'
        ? 'Genera el horóscopo de hoy (' + dateStr + ') para ' + name + '. Responde completamente en español boricua. Solo JSON, sin backticks.'
        : 'Generate today\'s horoscope (' + dateStr + ') for ' + name + '. Respond completely in English with Puerto Rican cultural flavor. Only JSON, no backticks.';
    try {
        var response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 512,
                system: HOROSCOPE_SYSTEM,
                messages: [{ role: 'user', content: prompt }]
            })
        });
        var data = await response.json();
        var text = '';
        if (data.content && Array.isArray(data.content)) {
            text = data.content.filter(function(b){return b.type==='text';}).map(function(b){return b.text;}).join('');
        }
        text = text.replace(/```json|```/g, '').trim();
        var parsed = JSON.parse(text);
        horoscopeCache.set(key, parsed);
        console.log('✨ Horoscope generated:', sign, lang);
        return parsed;
    } catch (err) {
        console.log('❌ Horoscope error:', err.message);
        return null;
    }
}

app.get('/api/horoscope/:sign', async function(req, res) {
    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'AI not configured' });
    var sign = req.params.sign.toLowerCase();
    if (HOROSCOPE_SIGNS.indexOf(sign) === -1) {
        return res.status(400).json({ error: 'Invalid sign' });
    }
    var lang = req.query.lang === 'es' ? 'es' : 'en';
    var result = await generateHoroscope(sign, lang);
    if (!result) {
        return res.status(500).json({ error: 'Could not generate horoscope' });
    }
    res.json(result);
});

app.get('/the-horoscope', function(req, res) { res.sendFile(path.join(__dirname, 'the-horoscope.html')); });
// ============ FORTUNE COCO ENGINE ============
const fortuneCache = new Map();

async function generateFortune(lang) {
    var today = new Date().toISOString().split('T')[0];
    var key = 'fortune_' + lang + '_' + today;
    if (fortuneCache.has(key)) return fortuneCache.get(key);
    fortuneCache.forEach(function(val, k) { if (!k.endsWith(today)) fortuneCache.delete(k); });
    var dateStr = new Date().toLocaleDateString('en-US', {weekday:'long', year:'numeric', month:'long', day:'numeric'});

    var systemPrompt, userPrompt;

    if (lang === 'es') {
        systemPrompt = 'Eres Bori, creadora de fortunas diarias con alma puertorriqueña. REGLAS: UNA oración máximo 2. Siempre positiva y esperanzadora. Usa referencias boricuas (comida, playa, música, familia, naturaleza). Responde SOLO con el texto de la fortuna en ESPAÑOL BORICUA. Nada más — sin comillas, sin JSON, sin explicación.';
        userPrompt = 'Genera la fortuna del coco de hoy (' + dateStr + '). Solo el texto en español boricua.';
    } else {
        systemPrompt = 'You are Bori, creator of daily fortunes with Puerto Rican soul. RULES: ONE sentence, max 2. Always positive and hopeful. Use Puerto Rican cultural references (food, beach, music, family, nature). Respond ONLY with the fortune text in ENGLISH. Nothing else — no quotes, no JSON, no explanation.';
        userPrompt = 'Generate today\'s coconut fortune (' + dateStr + '). Just the text in English with Puerto Rican flavor.';
    }

    try {
        var response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
            body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 150, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] })
        });
        var data = await response.json();
        var text = '';
        if (data.content && Array.isArray(data.content)) {
            text = data.content.filter(function(b){return b.type==='text';}).map(function(b){return b.text;}).join('').trim();
        }
        if (text) {
            fortuneCache.set(key, text);
            console.log('🥥 Fortune generated:', lang);
        }
        return text || null;
    } catch (err) {
        console.log('❌ Fortune error:', err.message);
        return null;
    }
}

app.get('/api/fortune', async function(req, res) {
    if (!ANTHROPIC_API_KEY) return res.status(500).json({ error: 'AI not configured' });
    var lang = req.query.lang === 'es' ? 'es' : 'en';
    var fortune = await generateFortune(lang);
    if (!fortune) {
        fortune = lang === 'es' ? 'Hoy el universo conspira a tu favor. Déjate llevar. 🥥💛' : 'Today the universe is on your side. Let it flow. 🥥💛';
    }
    res.json({ fortune: fortune });
});
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
    console.log('🤖 Bori AI:', ANTHROPIC_API_KEY ? '✅ Pure Claude' : '❌ Not configured');
    console.log('🔐 Admin Key:', ADMIN_SECRET_KEY ? '✅ Set' : '⚠️ Using default');
    console.log('');
    console.log('🏠 HEY BORI:');
    console.log('   /                 → Landing Page');
    console.log('   /the-chat.html    → Habla con Bori (Pure Claude)');
    console.log('   /login            → PIN Login');
    console.log('');
    console.log('🎮 JUEGOS:');
    console.log('   /the-conga.html   → CONGA (Ritmo Boricua) 🔥');
    console.log('   /the-sopa.html    → SOPA DE LETRAS');
    console.log('   /the-domino.html  → DOMINÓ MATH');
    console.log('   /the-isla.html    → LA ISLA (Gallery) 🧩');
    console.log('   /the-ritnome.html → RITNOME HUB');
    console.log('   /the-recall       → THE RECALL');
    console.log('   /the-replay       → THE REPLAY');
    console.log('   /the-reflex       → THE REFLEX');
    console.log('   /the-react        → THE REACT');
    console.log('   /the-ritmo        → THE RITMO');
    console.log('');
    console.log('🇵🇷 Hey Bori — Tu Compañera Bilingüe · Pure Claude');
    console.log('');
});
