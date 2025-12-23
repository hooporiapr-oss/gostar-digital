// ============ PLAY ROUTES ============

app.get('/play', (req, res) => {
    res.sendFile(path.join(__dirname, 'play.html'));
});

app.get('/game', (req, res) => {
    res.sendFile(path.join(__dirname, 'game.html'));
});

// Verify access code - check if valid and if user exists
app.post('/api/play/verify', (req, res) => {
    const { accessCode } = req.body;
    
    const codes = readJSON(CODES_FILE);
    const code = codes.find(c => c.code === accessCode && c.active);
    
    if (!code) {
        return res.status(401).json({ error: 'Invalid access code' });
    }
    
    // Check license
    const licenses = readJSON(LICENSES_FILE);
    const license = licenses.find(l => l.key === code.licenseKey && l.active);
    
    if (!license) {
        return res.status(401).json({ error: 'License not found' });
    }
    
    if (new Date(license.expirationDate) < new Date()) {
        return res.status(401).json({ error: 'Access expired' });
    }
    
    // Check how many users registered with this code
    const users = readJSON(USERS_FILE);
    const codeUsers = users.filter(u => u.code === accessCode);
    const usedCount = codeUsers.length;
    const spotsLeft = code.userLimit - usedCount;
    
    res.json({ 
        success: true, 
        facilityName: license.facilityName,
        spotsLeft: spotsLeft,
        hasSpots: spotsLeft > 0
    });
});

// Register new user
app.post('/api/play/register', (req, res) => {
    const { accessCode, username, password } = req.body;
    
    if (!accessCode || !username || !password) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const codes = readJSON(CODES_FILE);
    const code = codes.find(c => c.code === accessCode && c.active);
    
    if (!code) {
        return res.status(401).json({ error: 'Invalid access code' });
    }
    
    // Check license
    const licenses = readJSON(LICENSES_FILE);
    const license = licenses.find(l => l.key === code.licenseKey && l.active);
    
    if (!license || new Date(license.expirationDate) < new Date()) {
        return res.status(401).json({ error: 'Access expired' });
    }
    
    const users = readJSON(USERS_FILE);
    
    // Check if username already exists for this code
    const existingUser = users.find(u => u.code === accessCode && u.username.toLowerCase() === username.toLowerCase());
    if (existingUser) {
        return res.status(400).json({ error: 'Username already taken' });
    }
    
    // Check user limit
    const usedCount = users.filter(u => u.code === accessCode).length;
    if (usedCount >= code.userLimit) {
        return res.status(400).json({ error: 'User limit reached for this code' });
    }
    
    // Hash password and create user
    const bcrypt = require('bcryptjs');
    const hashedPassword = bcrypt.hashSync(password, 10);
    
    users.push({
        code: accessCode,
        username: username,
        password: hashedPassword,
        createdAt: new Date().toISOString()
    });
    writeJSON(USERS_FILE, users);
    
    res.json({ success: true, username: username });
});

// Login existing user
app.post('/api/play/login', (req, res) => {
    const { accessCode, username, password } = req.body;
    
    if (!accessCode || !username || !password) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const codes = readJSON(CODES_FILE);
    const code = codes.find(c => c.code === accessCode && c.active);
    
    if (!code) {
        return res.status(401).json({ error: 'Invalid access code' });
    }
    
    // Check license
    const licenses = readJSON(LICENSES_FILE);
    const license = licenses.find(l => l.key === code.licenseKey && l.active);
    
    if (!license || new Date(license.expirationDate) < new Date()) {
        return res.status(401).json({ error: 'Access expired' });
    }
    
    const users = readJSON(USERS_FILE);
    const user = users.find(u => u.code === accessCode && u.username.toLowerCase() === username.toLowerCase());
    
    if (!user) {
        return res.status(401).json({ error: 'User not found' });
    }
    
    const bcrypt = require('bcryptjs');
    if (!bcrypt.compareSync(password, user.password)) {
        return res.status(401).json({ error: 'Invalid password' });
    }
    
    res.json({ success: true, username: user.username });
});
