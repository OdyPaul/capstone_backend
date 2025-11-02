// backend/lib/createStudent.js
// Generates random grades + GWA for a Curriculum doc's subjects.

function getRandomGrade() {
  const grades = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0];
  return grades[Math.floor(Math.random() * grades.length)];
}

function flattenSubjects(curriculumDoc) {
  const out = [];
  const structure = curriculumDoc?.structure || {};
  for (const yearLevel of Object.keys(structure)) {
    const bySem = structure[yearLevel] || {};
    for (const semester of Object.keys(bySem)) {
      const arr = bySem[semester] || [];
      arr.forEach(s => {
        if (s?.code && String(s.code).trim()) {
          out.push({
            subjectCode: s.code,
            subjectDescription: s.title || "",
            units: Number(s.units ?? 3) || 3,
            yearLevel,
            semester,
          });
        }
      });
    }
  }
  return out;
}

function generateRandomGradesForCurriculum(curriculumDoc) {
  const subjects = flattenSubjects(curriculumDoc);
  if (!subjects.length) {
    return { subjects: [], gwa: 0 };
  }

  const subjectsWithGrades = subjects.map(s => {
    const finalGrade = getRandomGrade();
    return {
      ...s,
      finalGrade,
      remarks: finalGrade <= 3.0 ? "PASSED" : "FAILED",
    };
  });

  const sum = subjectsWithGrades.reduce((acc, s) => acc + Number(s.finalGrade || 0), 0);
  const gwa = Number((sum / subjectsWithGrades.length).toFixed(2)) || 0;

  return { subjects: subjectsWithGrades, gwa };
}

function generateStudentNumber(year = new Date().getFullYear(), index = Math.floor(Math.random()*99999)+1) {
  return `C${year}${String(index).padStart(5, "0")}`;
}

module.exports = {
  generateRandomGradesForCurriculum,
  generateStudentNumber,
  flattenSubjects,
};
