require('dotenv').config();
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
const session = require('express-session');
const app = express();
const PORT = process.env.PORT || 3000;

// Configure EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));
app.use(session({
    secret: process.env.SESSION_SECRET || 'fallback_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 3600000 } // 1 hour
}));

// Multer storage configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'uploads/');
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + file.originalname);
    }
});

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

const DATA_PATH = path.join(__dirname, 'data', 'concepts.json');

// Helper to read data
async function getConcepts() {
    try {
        const data = await fs.readJson(DATA_PATH);
        return data;
    } catch (err) {
        return [];
    }
}

// Helper to write data
async function saveConcepts(concepts) {
    await fs.writeJson(DATA_PATH, concepts, { spaces: 2 });
}

// Routes
app.get('/', async (req, res) => {
    let concepts = await getConcepts();
    const sortBy = req.query.sort || 'order-asc';

    // Sorting logic
    concepts.sort((a, b) => {
        // Always respect explicit sort order first if it exists
        if (a.sortOrder !== b.sortOrder) {
            return (a.sortOrder || 0) - (b.sortOrder || 0);
        }

        if (sortBy === 'title-asc') return a.title.localeCompare(b.title);
        if (sortBy === 'title-desc') return b.title.localeCompare(a.title);
        if (sortBy === 'date-asc') return new Date(a.uploadDate) - new Date(b.uploadDate);
        if (sortBy === 'date-desc') return new Date(b.uploadDate) - new Date(a.uploadDate);
        return 0;
    });

    // Group concepts by subject and handle nesting
    const grouped = concepts.reduce((acc, curr) => {
        if (!acc[curr.subject]) acc[curr.subject] = [];
        acc[curr.subject].push(curr);
        return acc;
    }, {});

    res.render('index', { 
        subjects: grouped, 
        sortBy, 
        allConcepts: concepts,
        seo: {
            title: 'Knowledge Repository',
            description: 'A premium vault for educational concepts, computer science guides, and interactive study materials.',
            keywords: 'NIMCET, computer science, concept vault, educational resources, software guides',
            path: '/'
        }
    });
});

app.get('/upload', async (req, res) => {
    const concepts = await getConcepts();
    res.render('upload', { 
        allConcepts: concepts,
        seo: {
            title: 'Contribute New Concept',
            description: 'Upload and organize new educational HTML concepts into the Concept Vault.',
            keywords: 'upload concept, contribute education, html concept uploader',
            path: '/upload'
        }
    });
});

app.post('/upload', upload.single('conceptFile'), async (req, res) => {
    try {
        const { title, subject, pasteContent, sortOrder, parentId } = req.body;
        let filename;

        if (req.file) {
            filename = req.file.filename;
        } else if (pasteContent) {
            filename = `paste-${Date.now()}.html`;
            await fs.writeFile(path.join(__dirname, 'uploads', filename), pasteContent);
        } else {
            return res.status(400).send('No file or content provided.');
        }

        const concepts = await getConcepts();
        const newConcept = {
            id: Date.now(),
            title,
            subject,
            filename: filename,
            originalName: req.file ? req.file.originalname : 'pasted_content.html',
            uploadDate: new Date().toISOString(),
            sortOrder: parseInt(sortOrder) || 0,
            parentId: parentId || null
        };

        concepts.push(newConcept);
        await saveConcepts(concepts);

        res.redirect('/');
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// Manage Page
app.get('/concept/:id', async (req, res) => {
    const concepts = await getConcepts();
    const concept = concepts.find(c => c.id == req.params.id);
    if (!concept) return res.status(404).send('Concept not found');
    res.render('manage', { 
        concept, 
        allConcepts: concepts,
        seo: {
            title: `Manage: ${concept.title}`,
            description: `Update and manage the content for ${concept.title} in the Concept Vault.`,
            keywords: `manage ${concept.title}, edit concept, update study material`,
            path: `/concept/${concept.id}`
        }
    });
});

// Update Metadata
app.post('/concept/:id/update', async (req, res) => {
    const { title, subject, sortOrder, parentId } = req.body;
    let concepts = await getConcepts();
    const index = concepts.findIndex(c => c.id == req.params.id);
    if (index === -1) return res.status(404).send('Concept not found');
    
    concepts[index].title = title;
    concepts[index].subject = subject;
    concepts[index].sortOrder = parseInt(sortOrder) || 0;
    concepts[index].parentId = parentId || null;
    
    await saveConcepts(concepts);
    res.redirect(`/concept/${req.params.id}`);
});

// Replace File
app.post('/concept/:id/replace', upload.single('conceptFile'), async (req, res) => {
    let concepts = await getConcepts();
    const index = concepts.findIndex(c => c.id == req.params.id);
    if (index === -1) return res.status(404).send('Concept not found');
    
    if (!req.file) return res.status(400).send('No file uploaded');

    // Delete old file
    const oldPath = path.join(__dirname, 'uploads', concepts[index].filename);
    if (await fs.exists(oldPath)) await fs.remove(oldPath);

    concepts[index].filename = req.file.filename;
    concepts[index].originalName = req.file.originalname;
    await saveConcepts(concepts);
    res.redirect(`/concept/${req.params.id}`);
});

// Editor Page
app.get('/concept/:id/edit', async (req, res) => {
    const concepts = await getConcepts();
    const concept = concepts.find(c => c.id == req.params.id);
    if (!concept) return res.status(404).send('Concept not found');
    
    const filePath = path.join(__dirname, 'uploads', concept.filename);
    const content = await fs.readFile(filePath, 'utf-8');
    res.render('editor', { 
        concept, 
        content,
        seo: {
            title: `Editing: ${concept.title}`,
            description: `Directly edit the HTML source for ${concept.title} using the Monaco Editor.`,
            keywords: 'html editor, monaco editor, online code editor',
            path: `/concept/${concept.id}/edit`
        }
    });
});

// Save from Editor
app.post('/concept/:id/save', async (req, res) => {
    const { content } = req.body;
    const concepts = await getConcepts();
    const concept = concepts.find(c => c.id == req.params.id);
    if (!concept) return res.status(404).send('Concept not found');
    
    const filePath = path.join(__dirname, 'uploads', concept.filename);
    await fs.writeFile(filePath, content);
    res.json({ success: true });
});

// Delete Concept
app.post('/concept/:id/delete', async (req, res) => {
    let concepts = await getConcepts();
    const index = concepts.findIndex(c => c.id == req.params.id);
    if (index === -1) return res.status(404).send('Concept not found');

    const filePath = path.join(__dirname, 'uploads', concepts[index].filename);
    if (await fs.exists(filePath)) await fs.remove(filePath);

    concepts.splice(index, 1);
    await saveConcepts(concepts);
    res.redirect('/');
});

// Sitemap
app.get('/sitemap.xml', async (req, res) => {
    const concepts = await getConcepts();
    const baseUrl = 'https://nimcet.erpsaas.in';
    
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
        <url><loc>${baseUrl}/</loc><priority>1.0</priority></url>
        <url><loc>${baseUrl}/upload</loc><priority>0.5</priority></url>`;
    
    concepts.forEach(concept => {
        xml += `
        <url>
            <loc>${baseUrl}/uploads/${concept.filename}</loc>
            <lastmod>${concept.uploadDate.split('T')[0]}</lastmod>
            <priority>0.8</priority>
        </url>`;
    });
    
    xml += '\n</urlset>';
    res.header('Content-Type', 'application/xml');
    res.send(xml);
});

// Admin Authentication Middleware
const isAdmin = (req, res, next) => {
    if (req.session.isAdmin) return next();
    res.redirect('/admin/login');
};

// Admin Routes
app.get('/admin/login', (req, res) => {
    res.render('admin-login', { 
        error: null,
        seo: { title: 'Admin Login', description: 'Restricted area.', path: '/admin/login' }
    });
});

app.post('/admin/login', (req, res) => {
    const { secretCode } = req.body;
    if (secretCode === process.env.ADMIN_SECRET) {
        req.session.isAdmin = true;
        res.redirect('/admin/dashboard');
    } else {
        res.render('admin-login', { 
            error: 'Invalid secret code!',
            seo: { title: 'Admin Login', description: 'Restricted area.', path: '/admin/login' }
        });
    }
});

app.get('/admin/dashboard', isAdmin, async (req, res) => {
    const uploadDir = path.join(__dirname, 'uploads');
    const files = await fs.readdir(uploadDir);
    const concepts = await getConcepts();
    
    // Enrich file info with concept titles if they exist
    const fileList = files.filter(f => f !== '.gitkeep').map(file => {
        const concept = concepts.find(c => c.filename === file);
        return {
            name: file,
            isTracked: !!concept,
            conceptTitle: concept ? concept.title : 'Orphaned File',
            stats: fs.statSync(path.join(uploadDir, file))
        };
    });

    res.render('admin-dashboard', { 
        files: fileList,
        seo: { title: 'Admin Dashboard', description: 'System file management.', path: '/admin/dashboard' }
    });
});

app.post('/admin/delete-file', isAdmin, async (req, res) => {
    const { filename } = req.body;
    const filePath = path.join(__dirname, 'uploads', filename);
    
    if (await fs.exists(filePath)) {
        await fs.remove(filePath);
        // Also remove from concepts.json if tracked
        let concepts = await getConcepts();
        const updated = concepts.filter(c => c.filename !== filename);
        await saveConcepts(updated);
    }
    res.redirect('/admin/dashboard');
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
