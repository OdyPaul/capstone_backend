// services/gradeService.js

const YEAR_ORDER = ['1ST YEAR', '2ND YEAR', '3RD YEAR', '4TH YEAR', '5TH YEAR', '6TH YEAR'];
const SEM_ORDER  = ['1ST SEMESTER', '2ND SEMESTER', 'MID YEAR TERM', 'MID-YEAR', 'SUMMER', 'MID YEAR'];

const norm = s =>
  String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

const idx = (v, arr) => {
  const i = arr.indexOf(norm(v));
  return i < 0 ? 99 : i;
};

// "Lastname, Firstname M."
function toFullName(s) {
  if (!s) return '';
  const mid = (s.middleName || '').trim();
  const ext = (s.extName || '').trim();
  const middle = mid ? ` ${mid[0].toUpperCase()}.` : '';
  const extStr = ext ? ` ${ext}` : '';
  return `${(s.lastName || '').trim().toUpperCase()}, ${(s.firstName || '')
    .trim()
    .toUpperCase()}${middle}${extStr}`;
}

// Map Grade docs → template-friendly subjects array (sorted for TOR)
function torSubjectsFromGrades(grades) {
  const sorted = [...grades].sort(
    (a, b) =>
      idx(a.yearLevel, YEAR_ORDER) - idx(b.yearLevel, YEAR_ORDER) ||
      idx(a.semester, SEM_ORDER) - idx(b.semester, SEM_ORDER) ||
      String(a.subjectCode || '').localeCompare(String(b.subjectCode || '')),
  );

  return sorted.map(g => ({
    subjectCode: g.subjectCode,
    subjectTitle: g.subjectTitle || '',
    units: Number.isFinite(Number(g.units)) ? Number(g.units) : null,
    finalGrade: g.finalGrade,
    remarks: g.remarks,
    yearLevel: g.yearLevel,
    semester: g.semester,
    schoolYear: g.schoolYear || null,
    termName: g.termName || null,
  }));
}

module.exports = {
  torSubjectsFromGrades,
  toFullName,
};
