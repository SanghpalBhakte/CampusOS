// ============================================================
// Campus OS — Personal Data
// Timetable & Quick Links updated with your official schedule.
// ============================================================

// Default profile — overridden by Settings (localStorage)
export const STUDENT = {
  name:    "Your Name",
  branch:  "Artificial Intelligence & Data Science",
  year:    "2nd Year — Semester 4",
  college: "Your College",
  rollNo:  "Your Roll No.",
};

// ── Timetable ─────────────────────────────────────────────────
// Days: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
export const TIMETABLE = {
  1: [ // Monday
    { time: "10:00", end: "11:00", subject: "DEMP",                          code: "DEMP",   room: "LT-1",  teacher: "Prof. VAK", type: "lecture" },
    { time: "11:00", end: "12:00", subject: "Data Structures (DS)",          code: "DS",     room: "LT-2",  teacher: "Prof. VJM", type: "lecture" },
    { time: "12:45", end: "13:45", subject: "Art Of Public Speaking (OE-1)", code: "OE-1",   room: "OE-1",  teacher: "Faculty",   type: "lecture" },
    { time: "13:45", end: "14:45", subject: "Art Of Public Speaking (OE-1)", code: "OE-1",   room: "OE-1",  teacher: "Faculty",   type: "lecture" },
    { time: "15:00", end: "17:00", subject: "Multi Disciplinary Minor",      code: "MDM",    room: "LT-3",  teacher: "Faculty",   type: "lab" },
  ],
  2: [ // Tuesday
    { time: "10:00", end: "12:00", subject: "DS-AI-A2 / WD-AI-C2 / DEMP-AI-D2", code: "LAB", room: "AI-A2/C2/D2", teacher: "Faculty", type: "lab" },
    { time: "12:45", end: "13:45", subject: "Personality Dev (OE-2)",        code: "OE-2",   room: "OE-2",  teacher: "Faculty",   type: "lecture" },
    { time: "13:45", end: "14:45", subject: "Personality Dev (OE-2)",        code: "OE-2",   room: "OE-2",  teacher: "Faculty",   type: "lecture" },
  ],
  3: [ // Wednesday
    { time: "10:00", end: "12:00", subject: "Community Engagement (AI-C2,D2)", code: "CE",   room: "AI-C2,D2", teacher: "Coordinator", type: "project" },
    { time: "12:45", end: "13:45", subject: "Data Structures (DS)",          code: "DS",     room: "LT-2",  teacher: "Prof. VJM", type: "lecture" },
    { time: "13:45", end: "14:45", subject: "DEMP",                          code: "DEMP",   room: "LT-1",  teacher: "Prof. VAK", type: "lecture" },
    { time: "15:00", end: "17:00", subject: "DEMP-AI-A2 / DS-AI-B2 / WD-AI-D2", code: "LAB", room: "AI-A2/B2/D2", teacher: "Faculty", type: "lab" },
  ],
  4: [ // Thursday
    { time: "10:00", end: "12:00", subject: "DEMP-AI-B2 / DS-AI-C2 / WD-AI-A2", code: "LAB", room: "AI-B2/C2/A2", teacher: "Faculty", type: "lab" },
    { time: "12:45", end: "14:45", subject: "Community Engagement (AI-A2,B2,C2,D2)", code: "CE", room: "AI-A2,B2,C2,D2", teacher: "Coordinator", type: "project" },
  ],
  5: [ // Friday
    { time: "10:00", end: "12:00", subject: "DEMP-AI-C2 / WD-B2 / DS-D2",    code: "LAB",    room: "AI-C2/B2/D2", teacher: "Faculty", type: "lab" },
    { time: "12:45", end: "13:45", subject: "PBST (Prob & Stats)",           code: "PBST",   room: "LT-1",  teacher: "Prof. SDJ", type: "lecture" },
    { time: "13:45", end: "14:45", subject: "Constitution of India (COI)",   code: "COI",    room: "LT-2",  teacher: "Faculty",   type: "lecture" },
    { time: "15:00", end: "17:00", subject: "Community Engagement (AI-A2,B2)", code: "CE",   room: "AI-A2,B2", teacher: "Coordinator", type: "project" },
  ],
  6: [ // Saturday
    { time: "10:00", end: "11:00", subject: "PBST (Prob & Stats)",           code: "PBST",   room: "LT-1",  teacher: "Prof. SDJ", type: "lecture" },
    { time: "11:00", end: "12:00", subject: "Constitution of India (COI)",   code: "COI",    room: "LT-2",  teacher: "Faculty",   type: "lecture" },
    { time: "12:45", end: "13:45", subject: "Basic Management & Financial Accts (BMFA)", code: "BMFA", room: "LT-3", teacher: "Faculty", type: "lecture" },
    { time: "13:45", end: "14:45", subject: "Basic Management & Financial Accts (BMFA)", code: "BMFA", room: "SF-32", teacher: "Faculty", type: "lecture" },
  ],
  0: [], // Sunday
};

// ── Assignments ───────────────────────────────────────────────
export const ASSIGNMENTS = [];

// ── Notices ───────────────────────────────────────────────────
export const NOTICES = [
  {
    id: "n1",
    title: "End-Semester Examination — Set Your Exam Date",
    category: "Exam",
    date: new Date().toISOString().split('T')[0],
    content: "Go to Settings and enter your end-semester exam date. A live countdown will appear on your dashboard.",
    important: true,
  },
  {
    id: "n2",
    title: "Timetable Updated for Sem 4",
    category: "Academic",
    date: new Date().toISOString().split('T')[0],
    content: "Your weekly timetable has been configured with DS, DEMP, WD, PBST, MDM, COI, and Community Engagement modules.",
    important: false,
  },
];

// ── Quick Links ───────────────────────────────────────────────
export const QUICK_LINKS = [
  {
    subject: "Data Structures",
    code: "DS",
    color: "#6366f1",
    resources: [
      { label: "GFG DSA Sheet",         url: "https://www.geeksforgeeks.org/dsa-sheet-by-love-babbar/", icon: "list" },
      { label: "Striver's SDE Sheet",   url: "https://takeuforward.org/interviews/strivers-sde-sheet-top-coding-interview-problems/", icon: "code" },
      { label: "Visualgo",              url: "https://visualgo.net/en", icon: "eye" },
    ],
  },
  {
    subject: "Digital Electronics & Microprocessors",
    code: "DEMP",
    color: "#0ea5e9",
    resources: [
      { label: "NPTEL Digital Circuits", url: "https://nptel.ac.in/courses/108105132", icon: "video" },
      { label: "8085 Microprocessor Notes", url: "https://www.geeksforgeeks.org/microprocessor-tutorial/", icon: "book-open" },
      { label: "Circuit Simulator",     url: "https://www.falstad.com/circuit/", icon: "cpu" },
    ],
  },
  {
    subject: "Web Development",
    code: "WD",
    color: "#10b981",
    resources: [
      { label: "MDN Web Docs",          url: "https://developer.mozilla.org/", icon: "book-open" },
      { label: "W3Schools HTML/CSS/JS", url: "https://www.w3schools.com/", icon: "code" },
      { label: "Frontend Mentor",       url: "https://www.frontendmentor.io/", icon: "graduation-cap" },
    ],
  },
  {
    subject: "Probability & Statistics",
    code: "PBST",
    color: "#f59e0b",
    resources: [
      { label: "StatQuest (YouTube)",   url: "https://www.youtube.com/@statquest", icon: "video" },
      { label: "Seeing Theory",         url: "https://seeing-theory.brown.edu/", icon: "eye" },
      { label: "Khan Academy Stats",    url: "https://www.khanacademy.org/math/statistics-probability", icon: "graduation-cap" },
    ],
  },
  {
    subject: "Modern Data Management",
    code: "MDM",
    color: "#ec4899",
    resources: [
      { label: "NPTEL DBMS",            url: "https://nptel.ac.in/courses/106105175", icon: "video" },
      { label: "SQLZoo Practice",       url: "https://sqlzoo.net/", icon: "database" },
      { label: "MongoDB University",    url: "https://learn.mongodb.com/", icon: "database" },
    ],
  },
];
