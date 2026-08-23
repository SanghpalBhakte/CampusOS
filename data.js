// ============================================================
// Clarity Desk — Personal Data
// Official SY-AIDS Timetable (W.E.F 30/07/2026) — SF-31
// ============================================================

// Default profile — overridden by Settings (localStorage)
export const STUDENT = {
  name:    "",
  branch:  "",
  year:    "",
  college: "",
  rollNo:  "",
};

// ── Timetable ─────────────────────────────────────────────────
export const EMPTY_TIMETABLE = {
  0: [],
  1: [],
  2: [],
  3: [],
  4: [],
  5: [],
  6: []
};

// Official SY-AIDS Timetable (W.E.F 30/07/2026) — Lecture Hall SF-31
// Days: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
export const TIMETABLE = {
  1: [ // Monday
    { time: "10:00", end: "11:00", subject: "DEMP",                          code: "DEMP", room: "SF-31",        teacher: "Prof. VAK",        type: "lecture" },
    { time: "11:00", end: "12:00", subject: "Data Structure (DS)",          code: "DS",   room: "SF-31",        teacher: "Prof. VJM",        type: "lecture" },
    { time: "12:00", end: "12:45", subject: "Recess",                        code: "REC",  room: "—",           teacher: "—",                type: "off", isBreak: true },
    { time: "12:45", end: "14:45", subject: "Open Elective 1 (OE-1)",        code: "OE-1", room: "SF-31",        teacher: "Faculty",          type: "lecture" },
    { time: "14:45", end: "15:00", subject: "Recess",                        code: "REC",  room: "—",           teacher: "—",                type: "off", isBreak: true },
    { time: "15:00", end: "17:00", subject: "Multi Disciplinary Minor (MDM)",code: "MDM",  room: "SF-31",        teacher: "Faculty",          type: "lecture" },
  ],
  2: [ // Tuesday
    { time: "10:00", end: "12:00", subject: "DS-AI-A2 (VJM) + WEB DEV.-AI-C2 (MKP)", code: "LAB", room: "FF-28 / FF-40", teacher: "Prof. VJM / MKP", type: "lab" },
    { time: "12:00", end: "12:45", subject: "Recess",                           code: "REC",  room: "—",            teacher: "—",                type: "off", isBreak: true },
    { time: "12:45", end: "14:45", subject: "Open Elective 2 (OE-2)",           code: "OE-2", room: "SF-31",        teacher: "Faculty",          type: "lecture" },
    { time: "14:45", end: "15:00", subject: "Recess",                           code: "REC",  room: "—",            teacher: "—",                type: "off", isBreak: true },
    { time: "15:00", end: "17:00", subject: "DEMP-AI-D2 (VAK)",                 code: "DEMP", room: "DMP Lab (FF-38)", teacher: "Prof. VAK",      type: "lab" },
  ],
  3: [ // Wednesday
    { time: "10:00", end: "12:00", subject: "Community Engagement (AI-C2, D2)", code: "CE",   room: "SF-31",        teacher: "Prof. SDJ",        type: "lab" },
    { time: "12:00", end: "12:45", subject: "Recess",                           code: "REC",  room: "—",            teacher: "—",                type: "off", isBreak: true },
    { time: "12:45", end: "13:45", subject: "Data Structure (DS)",             code: "DS",   room: "SF-31",        teacher: "Prof. VJM",        type: "lecture" },
    { time: "13:45", end: "14:45", subject: "DEMP",                             code: "DEMP", room: "SF-31",        teacher: "Prof. VAK",        type: "lecture" },
    { time: "14:45", end: "15:00", subject: "Recess",                           code: "REC",  room: "—",            teacher: "—",                type: "off", isBreak: true },
    { time: "15:00", end: "17:00", subject: "DEMP-AI-A2 (VAK) + DS-AI-B2 (VJM) + WEB DEV.-AI-D2 (MKP)", code: "LAB", room: "FF-38 / FF-28 / FF-40", teacher: "Prof. VAK / VJM / MKP", type: "lab" },
  ],
  4: [ // Thursday
    { time: "10:00", end: "12:00", subject: "DEMP-AI-B2 (VAK) + DS-AI-C2 (VJM) + WEB DEV.-AI-A2 (MKP)", code: "LAB", room: "FF-38 / FF-28 / FF-40", teacher: "Prof. VAK / VJM / MKP", type: "lab" },
    { time: "12:00", end: "12:45", subject: "Recess",                           code: "REC",  room: "—",            teacher: "—",                type: "off", isBreak: true },
    { time: "12:45", end: "14:45", subject: "Probability & Statistics (PBST)",  code: "PBST", room: "SF-31",        teacher: "Prof. SDJ",        type: "lecture" },
    { time: "14:45", end: "15:00", subject: "Recess",                           code: "REC",  room: "—",            teacher: "—",                type: "off", isBreak: true },
  ],
  5: [ // Friday
    { time: "10:00", end: "12:00", subject: "DEMP-AI-C2 (VAK) + WEB DEV.-AI-B2 (MKP) + DS-D2 (VJM)", code: "LAB", room: "FF-38 / FF-40 / FF-28", teacher: "Prof. VAK / MKP / VJM", type: "lab" },
    { time: "12:00", end: "12:45", subject: "Recess",                           code: "REC",  room: "—",            teacher: "—",                type: "off", isBreak: true },
    { time: "12:45", end: "14:45", subject: "Business Management & Financial Account (BMFA)", code: "BMFA", room: "SF-31", teacher: "Faculty",          type: "lecture" },
    { time: "14:45", end: "15:00", subject: "Recess",                           code: "REC",  room: "—",            teacher: "—",                type: "off", isBreak: true },
    { time: "15:00", end: "17:00", subject: "Community Engagement (AI-A2, B2, C2, D2)", code: "CE", room: "SF-31", teacher: "Prof. SDJ",        type: "lab" },
  ],
  6: [ // Saturday
    { time: "10:00", end: "12:00", subject: "Constitution of India (COI)",      code: "COI",  room: "SF-31",        teacher: "Adv. Vrushali Joshi", type: "lecture" },
    { time: "12:00", end: "12:45", subject: "Recess",                           code: "REC",  room: "—",            teacher: "—",                type: "off", isBreak: true },
    { time: "12:45", end: "14:45", subject: "Community Engagement (AI-A2, B2)", code: "CE",   room: "SF-31",        teacher: "Prof. SDJ",        type: "lab" },
    { time: "14:45", end: "15:00", subject: "Recess",                           code: "REC",  room: "—",            teacher: "—",                type: "off", isBreak: true },
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
    title: "Timetable Updated — Effective 30/07/2026 (SY-AIDS)",
    category: "Academic",
    date: new Date().toISOString().split('T')[0],
    content: "Your official SY-AIDS timetable effective 30/07/2026 (Lecture Hall SF-31) has been updated with DEMP, DS, WEB DEV, PBST, MDM, COI, BMFA, OE-1, OE-2, and Community Engagement modules.",
    important: false,
  },
];

// ── Quick Links ───────────────────────────────────────────────
export const QUICK_LINKS = [
  {
    subject: "Data Structure",
    code: "DS",
    color: "#394B63",
    resources: [
      { label: "GFG DSA Sheet",         url: "https://www.geeksforgeeks.org/dsa-sheet-by-love-babbar/", icon: "list" },
      { label: "Striver's SDE Sheet",   url: "https://takeuforward.org/interviews/strivers-sde-sheet-top-coding-interview-problems/", icon: "code" },
      { label: "Visualgo",              url: "https://visualgo.net/en", icon: "eye" },
    ],
  },
  {
    subject: "Digital Electronics & Microprocessor",
    code: "DEMP",
    color: "#5A6F8F",
    resources: [
      { label: "NPTEL Digital Circuits", url: "https://nptel.ac.in/courses/108105132", icon: "video" },
      { label: "8085 Microprocessor Notes", url: "https://www.geeksforgeeks.org/microprocessor-tutorial/", icon: "book-open" },
      { label: "Circuit Simulator",     url: "https://www.falstad.com/circuit/", icon: "cpu" },
    ],
  },
  {
    subject: "Web Development",
    code: "WD",
    color: "#4E7A5D",
    resources: [
      { label: "MDN Web Docs",          url: "https://developer.mozilla.org/", icon: "book-open" },
      { label: "W3Schools HTML/CSS/JS", url: "https://www.w3schools.com/", icon: "code" },
      { label: "Frontend Mentor",       url: "https://www.frontendmentor.io/", icon: "graduation-cap" },
    ],
  },
  {
    subject: "Probability & Statistics",
    code: "PBST",
    color: "#B48852",
    resources: [
      { label: "StatQuest (YouTube)",   url: "https://www.youtube.com/@statquest", icon: "video" },
      { label: "Seeing Theory",         url: "https://seeing-theory.brown.edu/", icon: "eye" },
      { label: "Khan Academy Stats",    url: "https://www.khanacademy.org/math/statistics-probability", icon: "graduation-cap" },
    ],
  },
  {
    subject: "Multi Disciplinary Minor",
    code: "MDM",
    color: "#A34B43",
    resources: [
      { label: "NPTEL DBMS",            url: "https://nptel.ac.in/courses/106105175", icon: "video" },
      { label: "SQLZoo Practice",       url: "https://sqlzoo.net/", icon: "database" },
      { label: "MongoDB University",    url: "https://learn.mongodb.com/", icon: "database" },
    ],
  },
  {
    subject: "Constitution of India",
    code: "COI",
    color: "#6B5E52",
    resources: [
      { label: "India Code - Constitution", url: "https://www.indiacode.nic.in/constitution", icon: "book-open" },
      { label: "Constitution Notes",        url: "https://www.clearias.com/constitution-of-india/", icon: "list" },
    ],
  },
  {
    subject: "Business Management & Financial Account",
    code: "BMFA",
    color: "#7E9C8D",
    resources: [
      { label: "Investopedia Basics",   url: "https://www.investopedia.com/financial-accounting-4689738", icon: "book-open" },
      { label: "AccountingCoach",       url: "https://www.accountingcoach.com/", icon: "graduation-cap" },
    ],
  },
  {
    subject: "Open Electives (OE-1 / OE-2)",
    code: "OE",
    color: "#90A3BE",
    resources: [
      { label: "NPTEL Online Courses",  url: "https://nptel.ac.in/", icon: "video" },
      { label: "SWAYAM Portal",         url: "https://swayam.gov.in/", icon: "graduation-cap" },
    ],
  },
  {
    subject: "Community Engagement",
    code: "CE",
    color: "#5E5449",
    resources: [
      { label: "Community Service Guidelines", url: "https://nss.gov.in/", icon: "book-open" },
    ],
  },
];
