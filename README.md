# 🎓 ExamEval AI — Intelligent Exam Evaluator

AI-powered exam grading tool for teachers. Upload question papers, marking schemes, and student submissions to get structured evaluation reports in seconds — powered by Claude.

---

## 📁 Project Structure

```
exameval/
├── frontend/
│   └── index.html          ← Complete single-file React app (open in browser)
├── backend/
│   ├── server.js           ← Express API server
│   ├── package.json        ← Dependencies
│   └── uploads/            ← Temp file storage (auto-created)
└── README.md
```

---

## ⚡ Quick Setup (5 minutes)

### Step 1 — Get your Claude API key
1. Go to https://console.anthropic.com
2. Create an account and generate an API key
3. Copy the key (starts with `sk-ant-...`)

### Step 2 — Set up the backend

```bash
# Navigate to backend folder
cd exameval/backend

# Install dependencies
npm install

# Set your API key (Mac/Linux)
export ANTHROPIC_API_KEY=sk-ant-your-key-here

# Set your API key (Windows CMD)
set ANTHROPIC_API_KEY=sk-ant-your-key-here

# Set your API key (Windows PowerShell)
$env:ANTHROPIC_API_KEY="sk-ant-your-key-here"

# Start the server
npm start
```

You should see: `🎓 ExamEval API running on http://localhost:3001`

### Step 3 — Open the frontend

Simply open `frontend/index.html` in your browser. No build step needed.

```bash
# Mac
open frontend/index.html

# Windows
start frontend/index.html

# Or just double-click index.html in your file explorer
```

---

## 🔧 Configuration

### Change the API port
Edit `backend/server.js`, line: `const PORT = process.env.PORT || 3001;`

### Change the frontend API URL
Edit `frontend/index.html`, line: `const API_BASE = 'http://localhost:3001';`

### For production deployment
- Deploy backend to Railway, Render, or Fly.io
- Host frontend on Vercel, Netlify, or GitHub Pages
- Update `API_BASE` in frontend to your deployed backend URL

---

## 📋 Dependencies

### Backend
| Package | Purpose |
|---------|---------|
| `@anthropic-ai/sdk` | Claude API integration |
| `express` | Web server framework |
| `multer` | File upload handling |
| `cors` | Cross-origin requests |
| `docx` | Generate .docx report files |

Install all: `npm install` (inside `backend/` folder)

---

## 🧠 How It Works

```
Teacher uploads files
        ↓
Frontend sends multipart form to Express API
        ↓
Multer saves files temporarily to /uploads
        ↓
Files are base64-encoded for Claude API
        ↓
Claude analyzes: question paper + marking scheme + student answers
        ↓
Structured JSON evaluation returned
        ↓
docx library generates formatted .docx report
        ↓
Base64 report sent back to browser
        ↓
Teacher downloads report or copies text
```

---

## 📤 Example API Request

```http
POST http://localhost:3001/api/evaluate
Content-Type: multipart/form-data

Fields:
  curriculumName: "IB DP Mathematics AA HL"
  curriculum: [file] (optional)
  questionPaper: [file]
  markingScheme: [file]
  studentSubmission: [file, file, ...]
```

### Example API Response

```json
{
  "success": true,
  "evaluation": {
    "curriculum": "IB DP Mathematics AA HL",
    "totalMarksAwarded": 52,
    "totalMarksAvailable": 80,
    "percentage": 65,
    "grade": "4",
    "summary": "The student demonstrates a solid understanding of differential calculus...",
    "strongAreas": [
      {
        "topic": "Differentiation Rules",
        "detail": "Correctly applied chain rule in Q1 and Q3 with full working shown."
      }
    ],
    "weakAreas": [
      {
        "topic": "Integration by Parts",
        "detail": "Repeatedly chose incorrect u and dv assignments in Q5 and Q6."
      }
    ],
    "questionAnalysis": [
      {
        "questionNumber": "1a",
        "marksAwarded": 3,
        "marksAvailable": 3,
        "expectedAnswer": "f'(x) = 6x² - 4x using power rule",
        "studentAnswer": "Correctly differentiated using power rule, showed all working",
        "errors": [],
        "feedback": "Excellent work. Continue showing intermediate steps clearly."
      },
      {
        "questionNumber": "2b",
        "marksAwarded": 1,
        "marksAvailable": 4,
        "expectedAnswer": "Apply integration by parts with u = ln(x), dv = x dx",
        "studentAnswer": "Set u = x incorrectly, leading to circular integration",
        "errors": ["Incorrect choice of u in IBP", "Did not verify result by differentiation"],
        "feedback": "For IBP, use LIATE rule: Logarithmic functions should be u. Practice with ∫x·ln(x)dx."
      }
    ],
    "conceptualFeedback": "The student shows strong procedural fluency in differentiation but struggles with integration strategies...",
    "actionPlan": [
      "Review LIATE mnemonic for integration by parts — practice 10 problems daily for one week",
      "Complete IB past papers: Nov 2022, May 2023 Paper 1 (integration sections)",
      "Focus on implicit differentiation — attempt 3b again using correct method",
      "Book a revision session focusing on related rates problems"
    ]
  },
  "docFile": "base64encodedstring...",
  "filename": "ExamEval_Report_IB_DP_Mathematics_AA_HL_2025-01-15.docx"
}
```

---

## 🏗️ Generated DOC Structure

The downloaded `.docx` file contains:

```
STUDENT PERFORMANCE REPORT
[Curriculum] | [Date]

1. SUMMARY
   • Total Marks: X / Y
   • Percentage: X%
   • Grade: X
   • Overview paragraph

2. STRONG AREAS
   ✓ Topic name
     Evidence from student answers

3. AREAS FOR IMPROVEMENT
   ✗ Topic name
     Specific misconception identified

4. QUESTION-WISE ANALYSIS
   Question 1a — 3/3 marks
   Expected | Student Answer | Errors | Feedback

5. CONCEPTUAL FEEDBACK
   Paragraph on key gaps and curriculum weaknesses

6. ACTION PLAN
   1. Specific step
   2. Specific step
   ...

─ Generated by ExamEval AI • Powered by Claude ─
```

---

## 🛡️ Security Notes

- Files are deleted from the server immediately after processing
- No student data is stored permanently
- File size limit: 20MB per file
- Accepted types: PDF, JPG, PNG, WebP only
- Never commit your API key — use environment variables

---

## 🐛 Troubleshooting

**"Connection error. Is the backend server running?"**
→ Make sure you ran `npm start` in the `backend/` folder and see port 3001 in terminal.

**"Could not parse evaluation response"**
→ Try again — Claude occasionally returns unexpected formats. If persistent, check API key.

**Files not uploading**
→ Check file size (max 20MB) and format (PDF/JPG/PNG only).

**CORS errors in browser console**
→ Make sure backend is running on `localhost:3001` and `API_BASE` matches in frontend.

---

## 📝 License

MIT — Free to use for educational purposes.

---

Built with ❤️ for educators | Powered by Claude (Anthropic)
