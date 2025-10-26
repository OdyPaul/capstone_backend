  // backend/utils/templateDefaults.js
  const DIPLOMA_DEFAULTS = [
    { key: "studentId",     title: "Student ID",    type: "string", required: true,  path: "studentNumber",  description: "Student identifier." },
    { key: "fullName",      title: "Full Name",     type: "string", required: true,  path: "fullName",       description: "Full name of the student." },
    { key: "degreeTitle",   title: "Degree Title",  type: "string", required: true,  path: "",               description: "Formal degree title (computed from program/curriculum)." },
    { key: "major",         title: "Major",         type: "string", required: false, path: "major",          description: "Optional major, e.g. Crop Science." },
    { key: "graduationDate",title: "Graduation Date",type:"date",   required: false, path: "dateGraduated",  description: "Date of graduation." },
  ];

  const TOR_DEFAULTS = [
    { key: "studentId",     title: "Student ID",    type: "string", required: true,  path: "studentNumber",  description: "Student identifier." },
    { key: "fullName",      title: "Full Name",     type: "string", required: true,  path: "fullName",       description: "Full name of the student." },
    { key: "program",       title: "Program",       type: "string", required: true,  path: "program",        description: "Degree program (e.g., BS Agriculture)." },
    { key: "graduationDate",title: "Graduation Date",type:"date",   required: false, path: "dateGraduated",  description: "Date of graduation, if applicable." },
    { key: "gwa",           title: "GWA",           type: "number", required: false, path: "gwa",            description: "General Weighted Average." },
    { key: "subjects",      title: "Subjects",      type: "array",  required: true,  path: "subjects",       description: "Array of course records (code, title, units, grade, remarks)." },
  ];

  function getDefaults(kind = "diploma") {
    return kind === "tor" ? TOR_DEFAULTS : DIPLOMA_DEFAULTS;
  }

  module.exports = { DIPLOMA_DEFAULTS, TOR_DEFAULTS, getDefaults };
