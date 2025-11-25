// backend/utils/seed_student.js
// Helper utilities for generating synthetic StudentData + Grade data.
// Used by web student creation and testing scripts.

function generateStudentNumber(year, index) {
  const y = String(year || new Date().getFullYear());
  const i = String(index || 1).padStart(5, '0');
  return `C${y}${i}`;
}

function getRandomGender() {
  return Math.random() < 0.5 ? 'male' : 'female';
}

function getRandomMagalangAddress() {
  const barangays = [
    'San Nicolas',
    'San Isidro',
    'San Agustin',
    'San Pedro I',
    'San Pedro II',
    'Sta. Cruz',
    'Dolores',
    'Camias',
    'Turu',
    'San Roque',
  ];

  const streets = [
    'Mabini St.',
    'Rizal St.',
    'MacArthur Highway',
    'Magalang-Angeles Road',
    'Balitucan Road',
    'Paralaya Road',
    'Sta. Cruz Road',
    'Poblacion Street',
  ];

  const puroks = ['Purok 1', 'Purok 2', 'Purok 3', 'Purok 4', 'Purok 5'];

  const purok = puroks[Math.floor(Math.random() * puroks.length)];
  const street = streets[Math.floor(Math.random() * streets.length)];
  const barangay = barangays[Math.floor(Math.random() * barangays.length)];

  const block = Math.floor(Math.random() * 20) + 1;
  const lot = Math.floor(Math.random() * 10) + 1;

  return `Blk ${block} Lot ${lot}, ${purok} ${street}, Brgy. ${barangay}, Magalang, Pampanga`;
}

function randomDateBetween(yearStart, yearEnd) {
  const start = new Date(yearStart, 0, 1).getTime();
  const end = new Date(yearEnd, 11, 31).getTime();
  const ts = start + Math.random() * (end - start);
  return new Date(ts);
}

// Admission + graduation pair, fully random (2015–2023 admit, +3–5 yrs for grad)
function randomAdmissionAndGraduation() {
  const admitted = randomDateBetween(2015, 2023);
  const gradYear =
    admitted.getFullYear() + (3 + Math.floor(Math.random() * 3));
  const graduated = randomDateBetween(gradYear, gradYear);

  return { dateAdmitted: admitted, dateGraduated: graduated };
}

// Admission date randomized given a fixed graduation date
function randomAdmissionAndGraduationForGradDate(gradDate) {
  if (!(gradDate instanceof Date) || Number.isNaN(gradDate.getTime())) {
    return randomAdmissionAndGraduation();
  }

  const gradYear = gradDate.getFullYear();
  const minYears = 3;
  const maxYears = 5;
  const yearsBack =
    minYears + Math.floor(Math.random() * (maxYears - minYears + 1));

  const admitYear = gradYear - yearsBack;
  const admitted = randomDateBetween(admitYear, admitYear);

  return {
    dateAdmitted: admitted,
    dateGraduated: gradDate,
  };
}

function randomGwa() {
  const value = 1 + Math.random() * 2; // 1.00–3.00
  return Number(value.toFixed(2));
}

function randomHonor(gwa) {
  if (gwa == null) return '';
  if (gwa <= 1.25) return 'Summa Cum Laude';
  if (gwa <= 1.50) return 'Magna Cum Laude';
  if (gwa <= 1.75) return 'Cum Laude';
  return '';
}

function randomSchoolName(prefix) {
  const bases = [
    'National HS',
    'Integrated School',
    'Academy',
    'Institute',
    'Science HS',
  ];
  const towns = ['Magalang', 'Angeles', 'Arayat', 'Mabalacat', 'San Fernando'];
  const town = towns[Math.floor(Math.random() * towns.length)];
  const base = bases[Math.floor(Math.random() * bases.length)];
  return `${prefix} ${town} ${base}`;
}

function randomEntranceCredential() {
  const options = ['SF10 - JHS', 'SF10 - SHS', 'ALS Certificate', 'PEPT Passer'];
  return options[Math.floor(Math.random() * options.length)];
}

function randomPlaceOfBirth() {
  const places = [
    'Magalang, Pampanga',
    'Angeles City, Pampanga',
    'Mabalacat, Pampanga',
    'San Fernando, Pampanga',
    'Arayat, Pampanga',
  ];
  return places[Math.floor(Math.random() * places.length)];
}

// Random date of birth based on admission date (age 17–21 at admission)
function randomDateOfBirthForAdmission(admittedDate) {
  const base =
    admittedDate instanceof Date && !Number.isNaN(admittedDate.getTime())
      ? admittedDate
      : new Date();

  const minAge = 17;
  const maxAge = 21;

  const age = minAge + Math.floor(Math.random() * (maxAge - minAge + 1));
  const year = base.getFullYear() - age;

  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year, 11, 31).getTime();
  const ts = start + Math.random() * (end - start);

  return new Date(ts);
}

// ----- Grade helpers (same logic as generateStudentData.js) -----

function flattenCurriculumSubjects(curriculum) {
  const out = [];
  if (!curriculum) return out;

  const structure = curriculum.structure || {};

  for (const yearLevel of Object.keys(structure)) {
    const yearBlock = structure[yearLevel] || {};
    for (const semester of Object.keys(yearBlock)) {
      const semSubjects = yearBlock[semester] || [];
      semSubjects.forEach((s) => {
        if (!s.code || !s.code.toString().trim()) return;

        out.push({
          yearLevel,
          semester,
          subjectCode: s.code.toString().trim(),
          subjectTitle: (s.title || '').toString(),
          units: Number(s.units || 0),
        });
      });
    }
  }

  return out;
}

function getRandomGrade() {
  const grades = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0];
  return grades[Math.floor(Math.random() * grades.length)];
}

function getRemarksFromGrade(grade) {
  if (grade == null) return null;
  return grade <= 3.0 ? 'PASSED' : 'FAILED';
}

function getTermNameFromSemester(semester) {
  const lower = (semester || '').toLowerCase();
  if (lower.includes('1st')) return '1st Sem';
  if (lower.includes('2nd')) return '2nd Sem';
  if (lower.includes('mid')) return 'Mid Year Term';
  return semester || null;
}

function getSampleSchoolYear() {
  const startYear = 2020 + Math.floor(Math.random() * 5); // 2020–2024
  return `${startYear}-${startYear + 1}`;
}

// Build Grade documents (plain objects) for a given student + curriculum
function makeGradeRowsForCurriculum({
  studentId,
  curriculum,
  program,
  schoolYear,
}) {
  if (!studentId || !curriculum) return [];

  const subjects = flattenCurriculumSubjects(curriculum);
  if (!subjects.length) return [];

  const sy = schoolYear || getSampleSchoolYear();

  const rows = subjects.map((subj) => {
    const finalGrade = getRandomGrade();
    const remarks = getRemarksFromGrade(finalGrade);
    const termName = getTermNameFromSemester(subj.semester);

    return {
      student: studentId,
      program: program || curriculum.program || '',
      curriculum: curriculum._id,
      yearLevel: subj.yearLevel,
      semester: subj.semester,
      subjectCode: subj.subjectCode,
      subjectTitle: subj.subjectTitle,
      units: subj.units,
      schoolYear: sy,
      termName,
      finalGrade,
      remarks,
    };
  });

  return rows;
}

module.exports = {
  generateStudentNumber,
  getRandomGender,
  getRandomMagalangAddress,
  randomDateBetween,
  randomAdmissionAndGraduation,
  randomAdmissionAndGraduationForGradDate,
  randomGwa,
  randomHonor,
  randomSchoolName,
  randomEntranceCredential,
  randomPlaceOfBirth,
  randomDateOfBirthForAdmission,
  flattenCurriculumSubjects,
  getRandomGrade,
  getRemarksFromGrade,
  getTermNameFromSemester,
  getSampleSchoolYear,
  makeGradeRowsForCurriculum,
};
