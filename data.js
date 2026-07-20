// ============================================================
// Campus OS — Personal Data
// Fill in YOUR details via the Settings page — no code needed.
// This file only provides the default fallbacks.
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
// Replace with YOUR actual weekly schedule.
// Days: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
export const TIMETABLE = {
  1: [ // Monday
    { time: "09:00", end: "10:00", subject: "Machine Learning",          code: "ML-401", room: "LT-7",       teacher: "Dr. Ananya Roy",    type: "lecture" },
    { time: "10:00", end: "11:00", subject: "Probability & Statistics",  code: "ST-401", room: "LT-2",       teacher: "Dr. Pradeep Verma", type: "lecture" },
    { time: "11:15", end: "12:15", subject: "Data Mining & Warehousing", code: "DM-402", room: "LT-6",       teacher: "Dr. Kavya Sharma",  type: "lecture" },
    { time: "12:15", end: "13:15", subject: "Computer Vision",           code: "CV-403", room: "LT-7",       teacher: "Prof. S. Iyer",     type: "lecture" },
    { time: "14:00", end: "16:00", subject: "ML Lab",                   code: "ML-402", room: "AI Lab-1",   teacher: "Dr. Ananya Roy",    type: "lab"     },
  ],
  2: [ // Tuesday
    { time: "09:00", end: "10:00", subject: "Python for Data Science",   code: "PY-404", room: "LT-4",       teacher: "Ms. Deepika Nair",  type: "lecture" },
    { time: "10:00", end: "11:00", subject: "Machine Learning",          code: "ML-401", room: "LT-7",       teacher: "Dr. Ananya Roy",    type: "lecture" },
    { time: "11:15", end: "12:15", subject: "Probability & Statistics",  code: "ST-401", room: "LT-2",       teacher: "Dr. Pradeep Verma", type: "lecture" },
    { time: "14:00", end: "16:00", subject: "Data Mining Lab",           code: "DM-403", room: "AI Lab-2",   teacher: "Dr. Kavya Sharma",  type: "lab"     },
  ],
  3: [ // Wednesday
    { time: "09:00", end: "10:00", subject: "Computer Vision",           code: "CV-403", room: "LT-7",       teacher: "Prof. S. Iyer",     type: "lecture" },
    { time: "10:00", end: "11:00", subject: "Data Mining & Warehousing", code: "DM-402", room: "LT-6",       teacher: "Dr. Kavya Sharma",  type: "lecture" },
    { time: "11:15", end: "12:15", subject: "Machine Learning",          code: "ML-401", room: "LT-7",       teacher: "Dr. Ananya Roy",    type: "lecture" },
    { time: "12:15", end: "13:15", subject: "Environmental Science",     code: "ES-401", room: "LT-1",       teacher: "Dr. B. Mathur",     type: "lecture" },
    { time: "14:00", end: "16:00", subject: "Python Lab",                code: "PY-405", room: "AI Lab-3",   teacher: "Ms. Deepika Nair",  type: "lab"     },
  ],
  4: [ // Thursday
    { time: "09:00", end: "10:00", subject: "Probability & Statistics",  code: "ST-401", room: "LT-2",       teacher: "Dr. Pradeep Verma", type: "lecture" },
    { time: "10:00", end: "11:00", subject: "Computer Vision",           code: "CV-403", room: "LT-7",       teacher: "Prof. S. Iyer",     type: "lecture" },
    { time: "11:15", end: "12:15", subject: "Data Mining & Warehousing", code: "DM-402", room: "LT-6",       teacher: "Dr. Kavya Sharma",  type: "lecture" },
    { time: "14:00", end: "16:00", subject: "Env. Science Lab",          code: "ES-402", room: "Env. Lab",   teacher: "Dr. B. Mathur",     type: "lab"     },
  ],
  5: [ // Friday
    { time: "09:00", end: "10:00", subject: "Python for Data Science",   code: "PY-404", room: "LT-4",       teacher: "Ms. Deepika Nair",  type: "lecture" },
    { time: "10:00", end: "11:00", subject: "Probability & Statistics",  code: "ST-401", room: "LT-2",       teacher: "Dr. Pradeep Verma", type: "lecture" },
    { time: "11:15", end: "13:15", subject: "Minor Project",             code: "MP-401", room: "Seminar Hall",teacher: "Dr. Ananya Roy",   type: "project" },
  ],
  6: [], // Saturday — free
  0: [], // Sunday — free
};

// ── Assignments ───────────────────────────────────────────────
// Start fresh — add your real assignments via the "Add Task" button.
export const ASSIGNMENTS = [];

// ── Notices ───────────────────────────────────────────────────
// Replace with your college's current notices.
export const NOTICES = [
  {
    id: "n1",
    title: "End-Semester Examination — Set Your Exam Date",
    category: "Exam",
    date: new Date().toISOString().split('T')[0],
    content: "Go to Settings and enter your end-semester exam date. A live countdown will appear on your dashboard. Check your university portal for the official date sheet.",
    important: true,
  },
  {
    id: "n2",
    title: "NPTEL Enrollment — July Batch Open for AI & DS Students",
    category: "Academic",
    date: new Date(Date.now() - 86400000 * 2).toISOString().split('T')[0],
    content: "NPTEL has opened enrollment for the July batch. Recommended courses for AI & DS students: 'Machine Learning' (IIT Kharagpur), 'Deep Learning' (IIT Ropar), 'Python for Data Science' (IIT Madras). Certificates count for internal credit transfer. Enroll at nptel.ac.in.",
    important: false,
  },
  {
    id: "n3",
    title: "Add Your College Notices Here",
    category: "General",
    date: new Date(Date.now() - 86400000 * 4).toISOString().split('T')[0],
    content: "Open data.js and replace the NOTICES array with your college's actual notices, or add them manually here. You can also delete these placeholder entries.",
    important: false,
  },
];

// ── Quick Links ───────────────────────────────────────────────
// AI & Data Science focused resources
export const QUICK_LINKS = [
  {
    subject: "Machine Learning",
    code: "ML-401",
    color: "#6366f1",
    resources: [
      { label: "Andrew Ng — ML Course",   url: "https://www.coursera.org/specializations/machine-learning-introduction", icon: "video"     },
      { label: "fast.ai Practical ML",    url: "https://www.fast.ai/",                                                    icon: "code"      },
      { label: "Scikit-learn Docs",       url: "https://scikit-learn.org/stable/",                                        icon: "book-open" },
      { label: "Kaggle Learn",            url: "https://www.kaggle.com/learn",                                            icon: "graduation-cap" },
    ],
  },
  {
    subject: "Data Mining & Warehousing",
    code: "DM-402",
    color: "#0ea5e9",
    resources: [
      { label: "NPTEL Data Mining",       url: "https://nptel.ac.in/courses/106105174",                                   icon: "video"     },
      { label: "Orange Data Mining",      url: "https://orangedatamining.com/",                                           icon: "cpu"       },
      { label: "UCI ML Repository",       url: "https://archive.ics.uci.edu/",                                            icon: "database"  },
      { label: "KDnuggets",              url: "https://www.kdnuggets.com/",                                               icon: "book-open" },
    ],
  },
  {
    subject: "Python for Data Science",
    code: "PY-404",
    color: "#10b981",
    resources: [
      { label: "NumPy Documentation",     url: "https://numpy.org/doc/",                                                  icon: "book-open" },
      { label: "Pandas Documentation",    url: "https://pandas.pydata.org/docs/",                                         icon: "book-open" },
      { label: "Real Python",             url: "https://realpython.com/",                                                  icon: "code"      },
      { label: "Google Colab",            url: "https://colab.research.google.com/",                                      icon: "cpu"       },
    ],
  },
  {
    subject: "Probability & Statistics",
    code: "ST-401",
    color: "#f59e0b",
    resources: [
      { label: "StatQuest (YouTube)",     url: "https://www.youtube.com/@statquest",                                      icon: "video"     },
      { label: "Seeing Theory",           url: "https://seeing-theory.brown.edu/",                                        icon: "eye"       },
      { label: "NPTEL Prob & Stats",      url: "https://nptel.ac.in/courses/111104079",                                   icon: "video"     },
      { label: "Khan Academy — Stats",    url: "https://www.khanacademy.org/math/statistics-probability",                 icon: "graduation-cap" },
    ],
  },
  {
    subject: "Computer Vision",
    code: "CV-403",
    color: "#ec4899",
    resources: [
      { label: "CS231n — Stanford",       url: "https://cs231n.stanford.edu/",                                            icon: "graduation-cap" },
      { label: "OpenCV Documentation",    url: "https://docs.opencv.org/",                                                icon: "book-open" },
      { label: "Papers With Code",        url: "https://paperswithcode.com/",                                             icon: "list"      },
      { label: "Roboflow Blog",           url: "https://blog.roboflow.com/",                                               icon: "eye"       },
    ],
  },
];
