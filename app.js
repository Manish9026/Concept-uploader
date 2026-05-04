const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs-extra');
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

    res.render('index', { subjects: grouped, sortBy, allConcepts: concepts });
});

app.get('/upload', async (req, res) => {
    const concepts = await getConcepts();
    res.render('upload', { allConcepts: concepts });
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
    res.render('manage', { concept, allConcepts: concepts });
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
    res.render('editor', { concept, content });
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

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
