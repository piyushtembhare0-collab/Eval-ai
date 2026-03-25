/**
 * ExamEval Backend Server
 * Node.js + Express API for AI-powered exam evaluation
 * 
 * Handles: file uploads, Claude API calls, DOC generation
 */

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const mammoth = require('mammoth');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, BorderStyle, Table, TableRow, TableCell, WidthType, ShadingType } = require('docx');

const app = express();
const PORT = process.env.PORT || 3001;

// ─── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── File Upload Config (Multer) ───────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Sanitize filename and add timestamp to avoid collisions
    const sanitized = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${sanitized}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB per file
  fileFilter: (req, file, cb) => {
    // Accept all common document and image formats
    const allowedExts = [
      // Documents
      'pdf', 'doc', 'docx', 'odt', 'rtf', 'txt',
      // Images
      'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'tif', 'heic', 'heif', 'svg'
    ];
    const ext = file.originalname.split('.').pop().toLowerCase();
    if (allowedExts.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not supported: .${ext}. Accepted: PDF, DOC, DOCX, ODT, RTF, TXT, JPG, PNG, GIF, BMP, WEBP, TIFF, HEIC`));
    }
  }
});

// ─── Claude API Client (created per-request using user's key) ─────────────────
// No global client — each request brings its own API key

// ─── Helper: Convert file to base64 for Claude Vision ─────────────────────────
function fileToBase64(filePath) {
  const buffer = fs.readFileSync(filePath);
  return buffer.toString('base64');
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeMap = {
    '.pdf':  'application/pdf',
    '.doc':  'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.odt':  'application/vnd.oasis.opendocument.text',
    '.rtf':  'application/rtf',
    '.txt':  'text/plain',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png':  'image/png',
    '.gif':  'image/gif',
    '.bmp':  'image/bmp',
    '.webp': 'image/webp',
    '.tiff': 'image/tiff',
    '.tif':  'image/tiff',
    '.heic': 'image/heic',
    '.heif': 'image/heif',
    '.svg':  'image/svg+xml'
  };
  return mimeMap[ext] || 'application/octet-stream';
}

// ─── Build Claude Message Content from uploaded files (async for docx) ────────
async function buildFileContent(files, label) {
  const contents = [];
  contents.push({ type: 'text', text: `\n\n=== ${label} ===\n` });

  for (const file of files) {
    const mimeType = getMimeType(file.path);

    if (mimeType === 'application/pdf') {
      const base64Data = fileToBase64(file.path);
      contents.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data: base64Data }
      });

    } else if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mimeType)) {
      const base64Data = fileToBase64(file.path);
      contents.push({
        type: 'image',
        source: { type: 'base64', media_type: mimeType, data: base64Data }
      });

    } else if (mimeType.includes('wordprocessingml') || mimeType.includes('msword') ||
               file.originalname.match(/\.docx?$/i)) {
      // .doc / .docx — extract with mammoth
      try {
        const result = await mammoth.extractRawText({ path: file.path });
        contents.push({ type: 'text', text: `[Content of ${file.originalname}]\n${result.value || ''}` });
      } catch (err) {
        contents.push({ type: 'text', text: `[Could not read ${file.originalname}: ${err.message}]` });
      }

    } else if (mimeType === 'text/plain' || file.originalname.match(/\.txt$/i)) {
      // Plain text — read directly
      try {
        const text = fs.readFileSync(file.path, 'utf8');
        contents.push({ type: 'text', text: `[Content of ${file.originalname}]\n${text}` });
      } catch (err) {
        contents.push({ type: 'text', text: `[Could not read ${file.originalname}]` });
      }

    } else if (mimeType === 'application/rtf' || file.originalname.match(/\.rtf$/i) ||
               mimeType.includes('opendocument') || file.originalname.match(/\.odt$/i)) {
      // RTF / ODT — try mammoth, fallback to raw text
      try {
        const result = await mammoth.extractRawText({ path: file.path });
        contents.push({ type: 'text', text: `[Content of ${file.originalname}]\n${result.value || ''}` });
      } catch (err) {
        try {
          const raw = fs.readFileSync(file.path, 'utf8');
          // Strip RTF control codes roughly
          const stripped = raw.replace(/\\[a-z]+\d*\s?|[{}]/g, ' ').replace(/\s+/g, ' ').trim();
          contents.push({ type: 'text', text: `[Content of ${file.originalname}]\n${stripped}` });
        } catch (e2) {
          contents.push({ type: 'text', text: `[Could not read ${file.originalname}]` });
        }
      }

    } else {
      // Unknown type — note it for Claude
      contents.push({ type: 'text', text: `[File attached: ${file.originalname} — type: ${mimeType}]` });
    }
  }

  return contents;
}

// ─── Build the structured evaluation prompt ────────────────────────────────────
function buildEvaluationPrompt(curriculum) {
  return `You are an expert academic examiner specializing in ${curriculum} curriculum evaluation. Your task is to evaluate student responses against the provided question paper and marking scheme.

IMPORTANT: Return your evaluation as a JSON object only (no markdown, no preamble). Follow this exact structure:

{
  "curriculum": "${curriculum}",
  "totalMarksAwarded": <number>,
  "totalMarksAvailable": <number>,
  "percentage": <number>,
  "grade": "<letter grade>",
  "summary": "<2-3 sentence overall summary of student performance>",
  "strongAreas": [
    { "topic": "<topic name>", "detail": "<specific evidence from student answers>" }
  ],
  "weakAreas": [
    { "topic": "<topic name>", "detail": "<specific misconception or gap>" }
  ],
  "questionAnalysis": [
    {
      "questionNumber": "<e.g. Q1a>",
      "marksAwarded": <number>,
      "marksAvailable": <number>,
      "expectedAnswer": "<brief summary of what was expected>",
      "studentAnswer": "<brief summary of what student wrote>",
      "errors": ["<error 1>", "<error 2>"],
      "feedback": "<specific, actionable improvement advice>"
    }
  ],
  "conceptualFeedback": "<paragraph on key conceptual gaps and curriculum-specific weaknesses>",
  "actionPlan": [
    "<specific step 1>",
    "<specific step 2>",
    "<specific step 3>",
    "<specific step 4>"
  ]
}

Grading guidelines:
- Assign marks strictly per the marking scheme (M marks, A marks, B marks)
- Do NOT award marks for unsupported answers
- Be objective and evidence-based
- Provide constructive, curriculum-aligned feedback`;
}

// ─── Generate DOC file from evaluation result ─────────────────────────────────
async function generateDocFile(evaluation, outputPath) {
  const { 
    curriculum, totalMarksAwarded, totalMarksAvailable, percentage, grade,
    summary, strongAreas, weakAreas, questionAnalysis, conceptualFeedback, actionPlan
  } = evaluation;

  // Color scheme
  const primaryColor = '1a1a2e';
  const accentColor = '4f46e5';
  const successColor = '16a34a';
  const dangerColor = 'dc2626';
  const mutedColor = '6b7280';

  const sections = [];

  // ── Title ──
  sections.push(
    new Paragraph({
      text: 'STUDENT PERFORMANCE REPORT',
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 }
    }),
    new Paragraph({
      text: `Curriculum: ${curriculum}`,
      alignment: AlignmentType.CENTER,
      spacing: { after: 100 },
      runs: [new TextRun({ text: `Curriculum: ${curriculum}`, color: mutedColor, size: 22 })]
    }),
    new Paragraph({
      text: `Generated on ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      runs: [new TextRun({ text: `Generated on ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, color: mutedColor, size: 18, italics: true })]
    })
  );

  // ── Summary Box ──
  sections.push(
    new Paragraph({ text: '1. SUMMARY', heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 200 } }),
    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({ text: 'Total Marks: ', bold: true }),
        new TextRun({ text: `${totalMarksAwarded} / ${totalMarksAvailable}`, color: accentColor, bold: true, size: 28 })
      ]
    }),
    new Paragraph({
      spacing: { after: 100 },
      children: [
        new TextRun({ text: 'Percentage: ', bold: true }),
        new TextRun({ text: `${percentage}%`, bold: true })
      ]
    }),
    new Paragraph({
      spacing: { after: 200 },
      children: [
        new TextRun({ text: 'Grade: ', bold: true }),
        new TextRun({ text: grade, bold: true, color: accentColor, size: 28 })
      ]
    }),
    new Paragraph({ text: summary, spacing: { after: 300 } })
  );

  // ── Strong Areas ──
  sections.push(
    new Paragraph({ text: '2. STRONG AREAS', heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 200 } })
  );
  strongAreas.forEach((area, i) => {
    sections.push(
      new Paragraph({
        spacing: { after: 80 },
        children: [
          new TextRun({ text: `✓ ${area.topic}`, bold: true, color: successColor })
        ]
      }),
      new Paragraph({ text: area.detail, spacing: { after: 150 } })
    );
  });

  // ── Weak Areas ──
  sections.push(
    new Paragraph({ text: '3. AREAS FOR IMPROVEMENT', heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 200 } })
  );
  weakAreas.forEach((area) => {
    sections.push(
      new Paragraph({
        spacing: { after: 80 },
        children: [
          new TextRun({ text: `✗ ${area.topic}`, bold: true, color: dangerColor })
        ]
      }),
      new Paragraph({ text: area.detail, spacing: { after: 150 } })
    );
  });

  // ── Question Analysis ──
  sections.push(
    new Paragraph({ text: '4. QUESTION-WISE ANALYSIS', heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 200 } })
  );

  questionAnalysis.forEach((q) => {
    const marksColor = q.marksAwarded === q.marksAvailable ? successColor : 
                       q.marksAwarded === 0 ? dangerColor : accentColor;
    
    sections.push(
      new Paragraph({
        spacing: { before: 200, after: 100 },
        children: [
          new TextRun({ text: `Question ${q.questionNumber}  `, bold: true, size: 26 }),
          new TextRun({ text: `${q.marksAwarded}/${q.marksAvailable} marks`, bold: true, color: marksColor, size: 24 })
        ]
      }),
      new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: 'Expected: ', bold: true }), new TextRun({ text: q.expectedAnswer })]
      }),
      new Paragraph({
        spacing: { after: 80 },
        children: [new TextRun({ text: 'Student answer: ', bold: true }), new TextRun({ text: q.studentAnswer })]
      })
    );

    if (q.errors && q.errors.length > 0) {
      sections.push(new Paragraph({ children: [new TextRun({ text: 'Errors identified:', bold: true, color: dangerColor })], spacing: { after: 60 } }));
      q.errors.forEach(err => {
        sections.push(new Paragraph({ text: `• ${err}`, spacing: { after: 40 }, indent: { left: 360 } }));
      });
    }

    sections.push(
      new Paragraph({
        spacing: { before: 80, after: 200 },
        children: [
          new TextRun({ text: 'Feedback: ', bold: true, color: accentColor }),
          new TextRun({ text: q.feedback, italics: true })
        ]
      })
    );
  });

  // ── Conceptual Feedback ──
  sections.push(
    new Paragraph({ text: '5. CONCEPTUAL FEEDBACK', heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 200 } }),
    new Paragraph({ text: conceptualFeedback, spacing: { after: 300 } })
  );

  // ── Action Plan ──
  sections.push(
    new Paragraph({ text: '6. ACTION PLAN', heading: HeadingLevel.HEADING_1, spacing: { before: 300, after: 200 } })
  );
  actionPlan.forEach((step, i) => {
    sections.push(
      new Paragraph({
        spacing: { after: 120 },
        children: [
          new TextRun({ text: `${i + 1}. `, bold: true, color: accentColor }),
          new TextRun({ text: step })
        ]
      })
    );
  });

  // ── Footer ──
  sections.push(
    new Paragraph({
      text: '─────────────────────────────────────────',
      alignment: AlignmentType.CENTER,
      spacing: { before: 400, after: 100 }
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Generated by ExamEval AI • Powered by Claude', color: mutedColor, size: 18, italics: true })],
      alignment: AlignmentType.CENTER
    })
  );

  // ── Create Document ──
  const doc = new Document({
    creator: 'ExamEval AI',
    title: `Student Performance Report — ${curriculum}`,
    description: 'AI-generated academic evaluation report',
    sections: [{
      properties: {
        page: {
          margin: { top: 1440, right: 1080, bottom: 1440, left: 1080 }
        }
      },
      children: sections
    }]
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

// ─── Cleanup uploaded files ────────────────────────────────────────────────────
function cleanupFiles(files) {
  if (!files) return;
  Object.values(files).flat().forEach(file => {
    if (file && file.path && fs.existsSync(file.path)) {
      fs.unlinkSync(file.path);
    }
  });
}

// ─── MAIN EVALUATION ENDPOINT ─────────────────────────────────────────────────
app.post('/api/evaluate',
  upload.fields([
    { name: 'curriculum', maxCount: 3 },
    { name: 'questionPaper', maxCount: 3 },
    { name: 'markingScheme', maxCount: 3 },
    { name: 'studentSubmission', maxCount: 10 }
  ]),
  async (req, res) => {
    const files = req.files;
    const outputPath = path.join(__dirname, 'uploads', `report_${Date.now()}.docx`);

    try {
      const curriculumName = req.body.curriculumName || 'General';

      // Validate API key sent from browser
      const apiKey = req.body.apiKey;
      if (!apiKey || !apiKey.startsWith('sk-ant-')) {
        return res.status(401).json({ error: 'Invalid or missing API key. Please enter your Anthropic API key.' });
      }

      // Create Anthropic client with user's own key
      const anthropic = new Anthropic({ apiKey });

      // Validate required files
      if (!files.questionPaper || !files.markingScheme || !files.studentSubmission) {
        return res.status(400).json({
          error: 'Missing required files. Please upload question paper, marking scheme, and student submission.'
        });
      }

      // Build message content for Claude
      const messageContent = [];
      messageContent.push({ type: 'text', text: buildEvaluationPrompt(curriculumName) });

      // Add curriculum files if provided
      if (files.curriculum) {
        messageContent.push(...await buildFileContent(files.curriculum, 'CURRICULUM DOCUMENT'));
      }

      // Add question paper
      messageContent.push(...await buildFileContent(files.questionPaper, 'QUESTION PAPER'));

      // Add marking scheme
      messageContent.push(...await buildFileContent(files.markingScheme, 'MARKING SCHEME / RUBRIC'));

      // Add student submission
      messageContent.push(...await buildFileContent(files.studentSubmission, 'STUDENT SUBMISSION'));

      messageContent.push({
        type: 'text',
        text: '\n\nNow evaluate the student submission thoroughly and return your analysis as valid JSON only.'
      });

      // Call Claude API
      const response = await anthropic.messages.create({
        model: 'claude-opus-4-5',
        max_tokens: 4000,
        messages: [{ role: 'user', content: messageContent }]
      });

      // Parse the JSON response
      const rawText = response.content
        .filter(block => block.type === 'text')
        .map(block => block.text)
        .join('');

      // Extract JSON from response (Claude might wrap it)
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Could not parse evaluation response. Please try again.');
      }

      const evaluation = JSON.parse(jsonMatch[0]);

      // Generate DOC file
      await generateDocFile(evaluation, outputPath);

      // Read DOC as base64 for response
      const docBuffer = fs.readFileSync(outputPath);
      const docBase64 = docBuffer.toString('base64');

      // Clean up files
      cleanupFiles(files);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

      res.json({
        success: true,
        evaluation,
        docFile: docBase64,
        filename: `ExamEval_Report_${curriculumName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.docx`
      });

    } catch (error) {
      console.error('Evaluation error:', error);
      cleanupFiles(files);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

      res.status(500).json({
        error: error.message || 'Evaluation failed. Please check your files and try again.'
      });
    }
  }
);

// ─── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Serve frontend (index.html) for all non-API routes ────────────────────────
app.get('/', (req, res) => {
  // Check multiple possible locations for index.html
  const possiblePaths = [
    path.join(__dirname, '..', 'frontend', 'index.html'), // local: backend/../frontend/
    path.join(__dirname, 'frontend', 'index.html'),        // deployed: same dir/frontend/
    path.join(__dirname, 'index.html'),                    // deployed: same dir
    path.join(__dirname, '..', 'index.html'),              // deployed: one level up
  ];
  const frontendPath = possiblePaths.find(p => fs.existsSync(p));
  if (frontendPath) {
    res.sendFile(frontendPath);
  } else {
    res.send('<h2>Eval AI is running. Please make sure index.html is in the project.</h2>');
  }
});

app.listen(PORT, () => {
  console.log(`\n🎓 ExamEval API running on http://localhost:${PORT}\n`);
});
