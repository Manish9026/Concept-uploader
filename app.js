require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const session = require('express-session');
const mongoose = require('mongoose');
const sharp = require('sharp');
const app = express();
const PORT = process.env.PORT || 3000;

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected to MongoDB ✅'))
    .catch(err => console.error('MongoDB connection error ❌:', err));

// Schemas
const SubjectSchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true }
});

const ConceptSchema = new mongoose.Schema({
    title: { type: String, required: true },
    subject: { type: String, required: true },
    htmlContent: { type: String, required: true },
    uploadDate: { type: Date, default: Date.now },
    sortOrder: { type: Number, default: 0 },
    parentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Concept', default: null },
    originalName: { type: String },
    media: {
        data: Buffer,
        contentType: String,
        fileName: String
    }
});

const Subject = mongoose.model('Subject', SubjectSchema);
const Concept = mongoose.model('Concept', ConceptSchema);

// Configure EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000, // 1 Day
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true
    }
}));

// Multer (Memory Storage for optimized DB transfer)
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (path.extname(file.originalname).toLowerCase() === '.html') {
            cb(null, true);
        } else {
            cb(new Error('Only .html files are allowed'));
        }
    }
});

const mediaUpload = multer({
    storage: storage,
    limits: { fileSize: 15 * 1024 * 1024 }, // 15MB limit
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm', '.zip', '.docx'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowedTypes.includes(ext) || file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/') || file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('File type not allowed'));
        }
    }
});

// Security Middleware
const isAdmin = (req, res, next) => {
    if (req.session.isAdmin) return next();
    if (req.xhr || req.headers.accept.indexOf('json') > -1) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    res.redirect('/auth/gate?returnTo=' + encodeURIComponent(req.originalUrl));
};

// Authentication Routes
app.get('/auth/gate', (req, res) => {
    res.render('auth-gate', { 
        error: null,
        returnTo: req.query.returnTo || '/',
        seo: { title: 'Secured Access', description: 'Restricted area.', path: '/auth/gate' }
    });
});

app.post('/auth/gate', (req, res) => {
    const { tokenCode, returnTo } = req.body;
    if (tokenCode === process.env.ADMIN_SECRET) {
        req.session.isAdmin = true;
        res.redirect(returnTo || '/');
    } else {
        res.render('auth-gate', { 
            error: 'Invalid Token Code!',
            returnTo: returnTo || '/',
            seo: { title: 'Secured Access', description: 'Restricted area.', path: '/auth/gate' }
        });
    }
});

app.post('/auth/verify', (req, res) => {
    const { tokenCode } = req.body;
    if (tokenCode === process.env.ADMIN_SECRET) {
        req.session.isAdmin = true;
        res.json({ success: true });
    } else {
        res.json({ success: false, error: 'Invalid Token Code!' });
    }
});

app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Routes
app.get('/', async (req, res) => {
    try {
        let concepts = await Concept.find().lean();
        const sortBy = req.query.sort || 'order-asc';

        // Sorting
        concepts.sort((a, b) => {
            if (a.sortOrder !== b.sortOrder) return (a.sortOrder || 0) - (b.sortOrder || 0);
            if (sortBy === 'title-asc') return a.title.localeCompare(b.title);
            if (sortBy === 'title-desc') return b.title.localeCompare(a.title);
            if (sortBy === 'date-asc') return a.uploadDate - b.uploadDate;
            if (sortBy === 'date-desc') return b.uploadDate - a.uploadDate;
            return 0;
        });

        const grouped = concepts.reduce((acc, curr) => {
            if (!acc[curr.subject]) acc[curr.subject] = [];
            acc[curr.subject].push(curr);
            return acc;
        }, {});

        const allSubjects = await Subject.find().lean();
        res.render('index', { 
            subjects: grouped, 
            sortBy, 
            allConcepts: concepts,
            allSubjects: allSubjects.map(s => s.name),
            isAuthenticated: !!req.session.isAdmin,
            seo: {
                title: 'Knowledge Repository',
                description: 'A premium vault for educational concepts, computer science guides, and interactive study materials.',
                keywords: 'NIMCET, computer science, concept vault, educational resources, software guides',
                path: '/'
            }
        });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.get('/upload', isAdmin, async (req, res) => {
    try {
        const concepts = await Concept.find().lean();
        const allSubjects = await Subject.find().lean();
        res.render('upload', { 
            allConcepts: concepts,
            allSubjects: allSubjects.map(s => s.name),
            seo: {
                title: `Contribute New Concept`,
                description: 'Upload and organize new educational HTML concepts into the Concept Vault.',
                keywords: 'upload concept, contribute education, html concept uploader',
                path: '/upload'
            }
        });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post('/upload', isAdmin, upload.single('conceptFile'), async (req, res) => {
    try {
        const { title, subject, pasteContent, sortOrder, parentId } = req.body;
        let htmlContent;

        if (req.file) {
            htmlContent = req.file.buffer.toString('utf-8');
        } else if (pasteContent) {
            htmlContent = pasteContent;
        } else {
            return res.status(400).send('No file or content provided.');
        }

        // Persist Subject
        await Subject.findOneAndUpdate(
            { name: subject },
            { name: subject },
            { upsert: true, new: true }
        );

        const newConcept = new Concept({
            title,
            subject,
            htmlContent,
            originalName: req.file ? req.file.originalname : 'pasted_content.html',
            sortOrder: parseInt(sortOrder) || 0,
            parentId: parentId || null
        });

        await newConcept.save();
        res.redirect('/');
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.get('/concept/:id', isAdmin, async (req, res) => {
    try {
        const concept = await Concept.findById(req.params.id);
        if (!concept) return res.status(404).send('Concept not found');
        const concepts = await Concept.find().lean();
        const allSubjects = await Subject.find().lean();

        res.render('manage', { 
            concept, 
            allConcepts: concepts,
            allSubjects: allSubjects.map(s => s.name),
            seo: {
                title: `Manage: ${concept.title}`,
                description: `Update and manage the content for ${concept.title} in the Concept Vault.`,
                keywords: `manage ${concept.title}, edit concept, update study material`,
                path: `/concept/${concept._id}`
            }
        });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post('/concept/:id/update', isAdmin, async (req, res) => {
    try {
        const { title, subject, sortOrder, parentId } = req.body;
        
        await Subject.findOneAndUpdate(
            { name: subject },
            { name: subject },
            { upsert: true }
        );

        await Concept.findByIdAndUpdate(req.params.id, {
            title,
            subject,
            sortOrder: parseInt(sortOrder) || 0,
            parentId: parentId || null
        });
        
        res.redirect(`/concept/${req.params.id}`);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post('/concept/:id/replace', isAdmin, upload.single('conceptFile'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send('No file uploaded');
        
        await Concept.findByIdAndUpdate(req.params.id, {
            htmlContent: req.file.buffer.toString('utf-8'),
            originalName: req.file.originalname
        });

        res.redirect(`/concept/${req.params.id}`);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Media Routes
app.post('/concept/:id/media', isAdmin, mediaUpload.single('mediaFile'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).send('No file uploaded');
        
        let buffer = req.file.buffer;
        let contentType = req.file.mimetype;

        // Optimization for images
        if (contentType.startsWith('image/') && !contentType.includes('gif')) {
            try {
                buffer = await sharp(buffer)
                    .resize(1600, null, { withoutEnlargement: true, fit: 'inside' })
                    .jpeg({ quality: 80, progressive: true })
                    .toBuffer();
                contentType = 'image/jpeg';
            } catch (sharpError) {
                console.error('Sharp optimization failed, storing original:', sharpError);
            }
        }

        await Concept.findByIdAndUpdate(req.params.id, {
            media: {
                data: buffer,
                contentType: contentType,
                fileName: req.file.originalname
            }
        });

        res.redirect(`/concept/${req.params.id}`);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.get('/concept/:id/media/view', async (req, res) => {
    try {
        const concept = await Concept.findById(req.params.id);
        if (!concept || !concept.media || !concept.media.data) {
            return res.status(404).send('Media not found');
        }
        
        // Clear any previous headers that might force download
        res.removeHeader('Content-Disposition');
        
        res.set('Content-Type', concept.media.contentType);
        res.set('Content-Disposition', 'inline'); 
        res.send(concept.media.data);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.get('/concept/:id/media/viewer', async (req, res) => {
    try {
        const concept = await Concept.findById(req.params.id);
        if (!concept || !concept.media) return res.status(404).send('Media not found');
        
        res.render('media-viewer', { 
            concept,
            seo: { 
                title: `Viewing: ${concept.media.fileName}`, 
                description: `Viewing media for ${concept.title}`,
                path: `/concept/${concept._id}/media/viewer` 
            }
        });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post('/concept/:id/media/delete', isAdmin, async (req, res) => {
    try {
        await Concept.findByIdAndUpdate(req.params.id, { $unset: { media: 1 } });
        res.redirect(`/concept/${req.params.id}`);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.get('/concept/:id/edit', isAdmin, async (req, res) => {
    try {
        const concept = await Concept.findById(req.params.id);
        if (!concept) return res.status(404).send('Concept not found');
        
        res.render('editor', { 
            concept, 
            content: concept.htmlContent,
            seo: {
                title: `Editing: ${concept.title}`,
                description: `Directly edit the HTML source for ${concept.title} using the Monaco Editor.`,
                keywords: 'html editor, monaco editor, online code editor',
                path: `/concept/${concept._id}/edit`
            }
        });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

app.post('/concept/:id/save', isAdmin, async (req, res) => {
    try {
        const { content } = req.body;
        await Concept.findByIdAndUpdate(req.params.id, { htmlContent: content });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/concept/:id/delete', isAdmin, async (req, res) => {
    try {
        await Concept.findByIdAndDelete(req.params.id);
        res.redirect('/');
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Serve HTML content dynamically
app.get('/view/:id', async (req, res) => {
    try {
        const concept = await Concept.findById(req.params.id);
        if (!concept) return res.status(404).send('Concept not found');
        res.send(concept.htmlContent);
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Sitemap
app.get('/sitemap.xml', async (req, res) => {
    const concepts = await Concept.find().lean();
    const baseUrl = 'https://nimcet.erpsaas.in';
    
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>${baseUrl}/</loc><priority>1.0</priority></url>
        <url><loc>${baseUrl}/upload</loc><priority>0.5</priority></url>`;
    
    concepts.forEach(concept => {
        xml += `
        <url>
            <loc>${baseUrl}/view/${concept._id}</loc>
            <lastmod>${new Date(concept.uploadDate).toISOString().split('T')[0]}</lastmod>
            <priority>0.8</priority>
        </url>`;
    });
    
    xml += '\n</urlset>';
    res.header('Content-Type', 'application/xml');
    res.send(xml);
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
