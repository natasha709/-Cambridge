const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Directories (DATA_DIR / UPLOADS_DIR can point to a persistent volume in production)
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(__dirname, 'uploads');
const PAPERS_FILE = path.join(DATA_DIR, 'papers.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const CLASSES_FILE = path.join(DATA_DIR, 'classes.json');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(PAPERS_FILE)) fs.writeFileSync(PAPERS_FILE, '[]', 'utf8');

// Helper to hash password
function hashPassword(password) {
  return crypto.createHash('sha256').update(password.trim()).digest('hex');
}

// Ensure default users if empty
if (!fs.existsSync(USERS_FILE)) {
  if (process.env.NODE_ENV === 'production') {
    const adminUsername = (process.env.ADMIN_USERNAME || 'admin').trim().toLowerCase();
    const adminPassword = (process.env.ADMIN_PASSWORD || '').trim();

    if (!adminPassword) {
      console.error('ADMIN_PASSWORD is required for the first production start.');
      console.error('Set ADMIN_PASSWORD (and optionally ADMIN_USERNAME / ADMIN_NAME) and restart.');
      process.exit(1);
    }

    const productionAdmin = [{
      id: 'admin-1',
      username: adminUsername,
      passwordHash: hashPassword(adminPassword),
      plainTextNotice: adminPassword,
      role: 'admin',
      name: (process.env.ADMIN_NAME || 'Administrator').trim(),
      assignedSubjects: ['Biology', 'Chemistry'],
      createdAt: new Date().toISOString()
    }];

    fs.writeFileSync(USERS_FILE, JSON.stringify(productionAdmin, null, 2), 'utf8');
    console.log(`Created initial administrator account "${adminUsername}" from environment variables.`);
  } else {
    const defaultUsers = [
      {
        id: 'admin-1',
        username: 'admin',
        passwordHash: hashPassword('admin123'),
        plainTextNotice: 'admin123',
        role: 'admin',
        name: 'Head of Science / Admin',
        assignedSubjects: ['Biology', 'Chemistry'],
        createdAt: new Date().toISOString()
      },
      {
        id: 'teacher-bio-1',
        username: 'bio_teacher',
        passwordHash: hashPassword('teacher123'),
        plainTextNotice: 'teacher123',
        role: 'teacher',
        name: 'Sarah Jenkins (Biology)',
        assignedSubjects: ['Biology'],
        createdAt: new Date().toISOString()
      },
      {
        id: 'teacher-chem-1',
        username: 'chem_teacher',
        passwordHash: hashPassword('teacher123'),
        plainTextNotice: 'teacher123',
        role: 'teacher',
        name: 'David Alistair (Chemistry)',
        assignedSubjects: ['Chemistry'],
        createdAt: new Date().toISOString()
      },
      {
        id: 'student-1',
        username: 'student',
        passwordHash: hashPassword('student123'),
        plainTextNotice: 'student123',
        role: 'student',
        name: 'Student Member',
        assignedSubjects: ['Biology', 'Chemistry'],
        createdAt: new Date().toISOString()
      }
    ];
    fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2), 'utf8');
  }
}

// In-memory active sessions token -> user
const sessions = new Map();

// Helpers for data read/write
function readData(filePath, defaultVal = []) {
  try {
    if (!fs.existsSync(filePath)) return defaultVal;
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content || '[]');
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
    return defaultVal;
  }
}

function writeData(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);
    return false;
  }
}

// Authentication Middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'Authorization token required' });
  }

  const token = authHeader.replace(/^Bearer\s+/, '');
  const user = sessions.get(token);

  if (!user) {
    return res.status(401).json({ error: 'Session expired or invalid. Please login again.' });
  }

  req.user = user;
  next();
}

// Admin only middleware
function adminMiddleware(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Permission denied. Administrator access required.' });
  }
  next();
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, 'paper-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => cb(null, true)
});

// Allowed options
const DEFAULT_CLASSES = [
  'Year 7', 'Year 8', 'Year 9', 'Year 10', 'Year 11', 'Year 12', 'Year 13'
];
const VALID_SUBJECTS = ['Biology', 'Chemistry'];
const VALID_TERMS = ['Term 1', 'Term 2', 'Term 3'];

if (!fs.existsSync(CLASSES_FILE)) {
  fs.writeFileSync(CLASSES_FILE, JSON.stringify(DEFAULT_CLASSES, null, 2), 'utf8');
}

function readClasses() {
  const stored = readData(CLASSES_FILE, []);
  const list = Array.isArray(stored) ? stored.filter(c => typeof c === 'string' && c.trim()) : [];
  return list.length ? list : DEFAULT_CLASSES.slice();
}

// ==================== AUTH ROUTES ====================

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const users = readData(USERS_FILE, []);
  const inputHash = hashPassword(password);

  const matched = users.find(u => 
    u.username.toLowerCase() === username.trim().toLowerCase() &&
    (u.passwordHash === inputHash || u.plainTextNotice === password.trim())
  );

  if (!matched) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  const userSession = {
    id: matched.id,
    username: matched.username,
    name: matched.name,
    role: matched.role,
    assignedSubjects: matched.assignedSubjects || (matched.role === 'admin' ? ['Biology', 'Chemistry'] : ['Biology']),
    plainTextNotice: matched.plainTextNotice || ''
  };

  sessions.set(token, userSession);

  res.json({
    message: 'Login successful',
    token,
    user: userSession
  });
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
  // Return fresh info from database
  const users = readData(USERS_FILE, []);
  const fresh = users.find(u => u.id === req.user.id);
  if (fresh) {
    req.user.assignedSubjects = fresh.assignedSubjects || [];
    req.user.name = fresh.name;
    req.user.role = fresh.role;
    req.user.plainTextNotice = fresh.plainTextNotice || '';
  }
  res.json({ user: req.user });
});

// Self-service password change for the signed-in user
app.put('/api/auth/password', authMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password are required.' });
  }

  const cleanNew = String(newPassword).trim();
  if (cleanNew.length < 3) {
    return res.status(400).json({ error: 'New password must be at least 3 characters.' });
  }

  const users = readData(USERS_FILE, []);
  const user = users.find(u => u.id === req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  const currentMatches =
    user.passwordHash === hashPassword(currentPassword) ||
    user.plainTextNotice === String(currentPassword).trim();

  if (!currentMatches) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }

  user.passwordHash = hashPassword(cleanNew);
  user.plainTextNotice = cleanNew;
  writeData(USERS_FILE, users);

  // Keep every active session for this user in sync
  for (const sess of sessions.values()) {
    if (sess.id === user.id) {
      sess.plainTextNotice = user.plainTextNotice;
    }
  }

  res.json({
    message: 'Password updated successfully.',
    user: req.user
  });
});

// Self-service profile update (name only — username is admin-managed)
app.put('/api/auth/profile', authMiddleware, (req, res) => {
  const cleanName = String(req.body.name || '').trim();

  if (!cleanName) {
    return res.status(400).json({ error: 'Full name is required.' });
  }
  if (cleanName.length > 80) {
    return res.status(400).json({ error: 'Full name must be 80 characters or fewer.' });
  }

  const users = readData(USERS_FILE, []);
  const user = users.find(u => u.id === req.user.id);
  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  user.name = cleanName;
  writeData(USERS_FILE, users);

  for (const sess of sessions.values()) {
    if (sess.id === user.id) sess.name = user.name;
  }

  req.user.name = user.name;

  res.json({
    message: 'Profile updated successfully.',
    user: req.user
  });
});

app.post('/api/auth/logout', authMiddleware, (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader.replace(/^Bearer\s+/, '');
  sessions.delete(token);
  res.json({ message: 'Logged out successfully' });
});

// ==================== ADMIN: TEACHER MANAGEMENT ====================

// List teachers with uploaded papers count
app.get('/api/admin/teachers', authMiddleware, adminMiddleware, (req, res) => {
  const users = readData(USERS_FILE, []);
  const papers = readData(PAPERS_FILE, []);

  const teachers = users
    .filter(u => u.role === 'teacher')
    .map(u => ({
      id: u.id,
      username: u.username,
      name: u.name,
      email: u.email || '',
      phone: u.phone || '',
      role: u.role,
      assignedSubjects: u.assignedSubjects || [],
      plainTextNotice: u.plainTextNotice || '123',
      createdAt: u.createdAt,
      papersCount: papers.filter(p => p.uploadedByUsername === u.username || p.uploadedBy === u.name).length
    }));
  res.json({ teachers });
});

// View single teacher details including their uploaded papers
app.get('/api/admin/teachers/:id/details', authMiddleware, adminMiddleware, (req, res) => {
  const { id } = req.params;
  const users = readData(USERS_FILE, []);
  const papers = readData(PAPERS_FILE, []);

  const teacher = users.find(u => u.id === id && u.role === 'teacher');
  if (!teacher) {
    return res.status(404).json({ error: 'Teacher not found' });
  }

  const teacherPapers = papers.filter(p => p.uploadedByUsername === teacher.username || p.uploadedBy === teacher.name);

  res.json({
    teacher: {
      id: teacher.id,
      username: teacher.username,
      name: teacher.name,
      email: teacher.email || '',
      phone: teacher.phone || '',
      role: teacher.role,
      assignedSubjects: teacher.assignedSubjects || [],
      plainTextNotice: teacher.plainTextNotice || '123',
      createdAt: teacher.createdAt
    },
    papers: teacherPapers
  });
});

// Add new teacher with subject permissions (Default password: 123)
app.post('/api/admin/teachers', authMiddleware, adminMiddleware, (req, res) => {
  const { username, password, name, assignedSubjects, email, phone } = req.body;

  if (!username || !name) {
    return res.status(400).json({ error: 'Username and full name are required.' });
  }

  const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const cleanPhone = typeof phone === 'string' ? phone.trim() : '';
  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }
  if (cleanPhone && !/^[+()\d\s-]{7,20}$/.test(cleanPhone)) {
    return res.status(400).json({ error: 'Please enter a valid phone number.' });
  }

  // Default password to 123 if omitted
  const finalPassword = (password && password.trim().length > 0) ? password.trim() : '123';

  if (!assignedSubjects || !Array.isArray(assignedSubjects) || assignedSubjects.length === 0) {
    return res.status(400).json({ error: 'Please assign at least one subject (Biology, Chemistry, or both).' });
  }

  // Validate subjects
  for (const s of assignedSubjects) {
    if (!VALID_SUBJECTS.includes(s)) {
      return res.status(400).json({ error: `Invalid subject: ${s}. Must be Biology or Chemistry.` });
    }
  }

  const users = readData(USERS_FILE, []);

  // Check unique username
  const exists = users.some(u => u.username.toLowerCase() === username.trim().toLowerCase());
  if (exists) {
    return res.status(400).json({ error: `Username "${username}" already exists. Please pick another.` });
  }

  const newTeacher = {
    id: 'teacher-' + crypto.randomUUID(),
    username: username.trim().toLowerCase(),
    passwordHash: hashPassword(finalPassword),
    plainTextNotice: finalPassword,
    role: 'teacher',
    name: name.trim(),
    email: cleanEmail,
    phone: cleanPhone,
    assignedSubjects: assignedSubjects,
    createdAt: new Date().toISOString()
  };

  users.push(newTeacher);
  writeData(USERS_FILE, users);

  res.status(201).json({
    message: 'Teacher registered successfully! Default password is 123.',
    teacher: {
      id: newTeacher.id,
      username: newTeacher.username,
      name: newTeacher.name,
      email: newTeacher.email,
      phone: newTeacher.phone,
      role: newTeacher.role,
      assignedSubjects: newTeacher.assignedSubjects,
      plainTextNotice: newTeacher.plainTextNotice,
      createdAt: newTeacher.createdAt,
      papersCount: 0
    }
  });
});

// Update teacher (subjects, name, username, password)
app.put('/api/admin/teachers/:id', authMiddleware, adminMiddleware, (req, res) => {
  const { id } = req.params;
  const { name, username, assignedSubjects, password, email, phone } = req.body;

  const users = readData(USERS_FILE, []);
  const teacher = users.find(u => u.id === id && u.role === 'teacher');

  if (!teacher) {
    return res.status(404).json({ error: 'Teacher not found.' });
  }

  if (name && name.trim()) teacher.name = name.trim();

  if (email !== undefined) {
    const cleanEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return res.status(400).json({ error: 'Please enter a valid email address.' });
    }
    teacher.email = cleanEmail;
  }

  if (phone !== undefined) {
    const cleanPhone = typeof phone === 'string' ? phone.trim() : '';
    if (cleanPhone && !/^[+()\d\s-]{7,20}$/.test(cleanPhone)) {
      return res.status(400).json({ error: 'Please enter a valid phone number.' });
    }
    teacher.phone = cleanPhone;
  }
  if (username && username.trim()) {
    const cleanUsername = username.trim().toLowerCase();
    const clash = users.some(u => u.id !== id && u.username.toLowerCase() === cleanUsername);
    if (clash) {
      return res.status(400).json({ error: `Username "${cleanUsername}" is already taken.` });
    }
    teacher.username = cleanUsername;
  }

  if (assignedSubjects && Array.isArray(assignedSubjects) && assignedSubjects.length > 0) {
    teacher.assignedSubjects = assignedSubjects;
  }

  if (password && password.trim().length > 0) {
    teacher.passwordHash = hashPassword(password);
    teacher.plainTextNotice = password.trim();
  }

  writeData(USERS_FILE, users);

  // Update in-memory sessions if teacher is currently logged in
  for (let [tok, sess] of sessions.entries()) {
    if (sess.id === id) {
      sess.name = teacher.name;
      sess.username = teacher.username;
      sess.assignedSubjects = teacher.assignedSubjects;
      sess.plainTextNotice = teacher.plainTextNotice || '';
    }
  }

  res.json({
    message: 'Teacher details updated successfully.',
    teacher: {
      id: teacher.id,
      username: teacher.username,
      name: teacher.name,
      email: teacher.email || '',
      phone: teacher.phone || '',
      assignedSubjects: teacher.assignedSubjects,
      plainTextNotice: teacher.plainTextNotice
    }
  });
});

// Delete teacher
app.delete('/api/admin/teachers/:id', authMiddleware, adminMiddleware, (req, res) => {
  const { id } = req.params;
  let users = readData(USERS_FILE, []);
  const index = users.findIndex(u => u.id === id && u.role === 'teacher');

  if (index === -1) {
    return res.status(404).json({ error: 'Teacher not found.' });
  }

  const deleted = users.splice(index, 1)[0];
  writeData(USERS_FILE, users);

  // Invalidate any active session
  for (let [tok, sess] of sessions.entries()) {
    if (sess.id === id) sessions.delete(tok);
  }

  res.json({ message: `Teacher ${deleted.name} removed successfully.` });
});

// ==================== PAPERS ROUTES ====================

// Metadata options
app.get('/api/meta', authMiddleware, (req, res) => {
  let allowedSubjects = VALID_SUBJECTS;
  if (req.user.role !== 'admin' && req.user.assignedSubjects) {
    allowedSubjects = req.user.assignedSubjects;
  }

  res.json({
    classes: readClasses(),
    subjects: allowedSubjects,
    terms: VALID_TERMS
  });
});

// List classes/years
app.get('/api/classes', authMiddleware, (req, res) => {
  res.json({ classes: readClasses() });
});

// Add a class/year (admin only)
app.post('/api/classes', authMiddleware, adminMiddleware, (req, res) => {
  const name = typeof req.body.name === 'string' ? req.body.name.trim().replace(/\s+/g, ' ') : '';

  if (!name) {
    return res.status(400).json({ error: 'Please enter a class name.' });
  }
  if (name.length > 30) {
    return res.status(400).json({ error: 'Class name must be 30 characters or fewer.' });
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9\s-]*$/.test(name)) {
    return res.status(400).json({ error: 'Class name may only contain letters, numbers, spaces and hyphens.' });
  }

  const classes = readClasses();
  if (classes.some(c => c.toLowerCase() === name.toLowerCase())) {
    return res.status(400).json({ error: `"${name}" already exists.` });
  }

  classes.push(name);
  writeData(CLASSES_FILE, classes);

  res.status(201).json({ message: `Class "${name}" added.`, name, classes });
});

// List papers with subject-level filtration enforcement
app.get('/api/papers', authMiddleware, (req, res) => {
  const { classYear, subject, term, academicYear, search } = req.query;
  let papers = readData(PAPERS_FILE, []);

  // Strict Subject Scope Check:
  // If not admin, restrict papers strictly to user's assignedSubjects!
  if (req.user.role !== 'admin' && req.user.assignedSubjects && req.user.assignedSubjects.length > 0) {
    papers = papers.filter(p => req.user.assignedSubjects.includes(p.subject));
  }

  if (classYear && classYear !== 'all') {
    papers = papers.filter(p => p.classYear === classYear);
  }

  if (subject && subject !== 'all') {
    // Check if user is trying to access a subject they are not allowed to view
    if (req.user.role !== 'admin' && req.user.assignedSubjects && !req.user.assignedSubjects.includes(subject)) {
      return res.json({ count: 0, papers: [] });
    }
    papers = papers.filter(p => p.subject.toLowerCase() === subject.toLowerCase());
  }

  if (term && term !== 'all') {
    papers = papers.filter(p => p.term === term);
  }

  if (academicYear && academicYear !== 'all') {
    papers = papers.filter(p => p.academicYear === academicYear);
  }

  if (search && search.trim() !== '') {
    const q = search.trim().toLowerCase();
    papers = papers.filter(p => 
      p.title.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.originalName.toLowerCase().includes(q) ||
      p.paperType.toLowerCase().includes(q)
    );
  }

  // Sort latest first
  papers.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

  res.json({
    count: papers.length,
    papers
  });
});

// Upload paper with subject verification
app.post('/api/papers', authMiddleware, upload.single('paperFile'), (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Permission denied. Only authorized teachers and admins can upload papers.' });
  }

  if (!req.file) {
    return res.status(400).json({ error: 'No paper file was uploaded' });
  }

  const { title, classYear, subject, term, academicYear, paperType, description } = req.body;

  if (!title || !classYear || !subject || !term) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Please provide Title, Class/Year, Subject, and Term.' });
  }

  if (!readClasses().includes(classYear)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: `Invalid class. Must be one of: ${readClasses().join(', ')}` });
  }

  if (!VALID_SUBJECTS.includes(subject)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Invalid subject. Strictly Biology or Chemistry allowed.' });
  }

  // Teacher Subject Restriction Check:
  // If not admin, teacher can ONLY upload papers in their assigned subjects!
  if (req.user.role !== 'admin' && req.user.assignedSubjects && !req.user.assignedSubjects.includes(subject)) {
    fs.unlinkSync(req.file.path);
    return res.status(403).json({ 
      error: `Access Denied: You are only authorized to upload papers for [${req.user.assignedSubjects.join(', ')}]. You cannot upload for ${subject}.` 
    });
  }

  if (!VALID_TERMS.includes(term)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Invalid term. Must be Term 1, Term 2, or Term 3.' });
  }

  const papers = readData(PAPERS_FILE, []);

  const newPaper = {
    id: 'paper-' + crypto.randomUUID(),
    title: title.trim(),
    classYear: classYear.trim(),
    subject: subject.trim(),
    term: term.trim(),
    academicYear: academicYear ? academicYear.trim() : new Date().getFullYear().toString(),
    paperType: paperType ? paperType.trim() : 'End of Term Exam',
    description: description ? description.trim() : '',
    originalName: req.file.originalname,
    filename: req.file.filename,
    size: req.file.size,
    mimetype: req.file.mimetype,
    uploadedBy: req.user.name || req.user.username,
    uploadedByUsername: req.user.username,
    uploadedAt: new Date().toISOString(),
    downloadsCount: 0
  };

  papers.unshift(newPaper);
  writeData(PAPERS_FILE, papers);

  res.status(201).json({
    message: 'Paper successfully uploaded!',
    paper: newPaper
  });
});

// Inline preview (does not count as a download)
app.get('/api/papers/:id/view', authMiddleware, (req, res) => {
  const { id } = req.params;
  const papers = readData(PAPERS_FILE, []);
  const paper = papers.find(p => p.id === id);

  if (!paper) {
    return res.status(404).json({ error: 'Paper not found' });
  }

  if (req.user.role !== 'admin' && req.user.assignedSubjects && !req.user.assignedSubjects.includes(paper.subject)) {
    return res.status(403).json({ error: `Access Denied: You do not have permission to view ${paper.subject} papers.` });
  }

  const filePath = path.join(UPLOADS_DIR, paper.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on server' });
  }

  res.setHeader('Content-Disposition', 'inline');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(filePath);
});

// Download paper with subject restriction enforcement
app.get('/api/papers/:id/download', authMiddleware, (req, res) => {
  const { id } = req.params;
  const papers = readData(PAPERS_FILE, []);
  const paper = papers.find(p => p.id === id);

  if (!paper) {
    return res.status(404).json({ error: 'Paper not found' });
  }

  // Teacher / Student Subject Restriction:
  if (req.user.role !== 'admin' && req.user.assignedSubjects && !req.user.assignedSubjects.includes(paper.subject)) {
    return res.status(403).json({ error: `Access Denied: You do not have permission to view or download ${paper.subject} papers.` });
  }

  const filePath = path.join(UPLOADS_DIR, paper.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found on server' });
  }

  paper.downloadsCount = (paper.downloadsCount || 0) + 1;
  writeData(PAPERS_FILE, papers);

  res.download(filePath, paper.originalName);
});

// Delete paper
app.delete('/api/papers/:id', authMiddleware, (req, res) => {
  if (req.user.role !== 'teacher' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Permission denied. Only teachers and admins can delete papers.' });
  }

  const { id } = req.params;
  let papers = readData(PAPERS_FILE, []);
  const paperIndex = papers.findIndex(p => p.id === id);

  if (paperIndex === -1) {
    return res.status(404).json({ error: 'Paper not found' });
  }

  const paper = papers[paperIndex];

  // Subject permission check
  if (req.user.role !== 'admin' && req.user.assignedSubjects && !req.user.assignedSubjects.includes(paper.subject)) {
    return res.status(403).json({ error: `Permission denied. You cannot delete ${paper.subject} papers.` });
  }

  const filePath = path.join(UPLOADS_DIR, paper.filename);
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      console.error('Error removing file:', e);
    }
  }

  papers.splice(paperIndex, 1);
  writeData(PAPERS_FILE, papers);

  res.json({ message: 'Paper deleted successfully' });
});

// Stats endpoint
app.get('/api/stats', authMiddleware, (req, res) => {
  let papers = readData(PAPERS_FILE, []);

  // Filter stats by user subject permissions
  if (req.user.role !== 'admin' && req.user.assignedSubjects && req.user.assignedSubjects.length > 0) {
    papers = papers.filter(p => req.user.assignedSubjects.includes(p.subject));
  }

  const stats = {
    totalPapers: papers.length,
    biologyCount: papers.filter(p => p.subject === 'Biology').length,
    chemistryCount: papers.filter(p => p.subject === 'Chemistry').length,
    byClass: {},
    byTerm: {
      'Term 1': papers.filter(p => p.term === 'Term 1').length,
      'Term 2': papers.filter(p => p.term === 'Term 2').length,
      'Term 3': papers.filter(p => p.term === 'Term 3').length
    }
  };

  const classList = readClasses();
  papers.forEach(p => {
    if (p.classYear && !classList.includes(p.classYear)) classList.push(p.classYear);
  });
  classList.forEach(c => {
    stats.byClass[c] = papers.filter(p => p.classYear === c).length;
  });

  const VALID_ACADEMIC_YEARS = ['2026', '2025', '2024', '2023', '2022', '2021', '2020'];
  stats.byAcademicYear = {};
  VALID_ACADEMIC_YEARS.forEach(y => {
    stats.byAcademicYear[y] = papers.filter(p => p.academicYear === y).length;
  });

  res.json(stats);
});

// Fallback to index.html for SPA
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server
app.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`  TIS Paper Repository Server is running!     `);
  console.log(`  URL: http://localhost:${PORT}                 `);
  console.log(`  Storage: ${DATA_DIR}`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`  Admin Login: admin / admin123                 `);
    console.log(`  Bio Teacher: bio_teacher / teacher123         `);
    console.log(`  Chem Teacher: chem_teacher / teacher123       `);
  } else {
    console.log(`  Mode: production                              `);
  }
  console.log(`===============================================`);
});
