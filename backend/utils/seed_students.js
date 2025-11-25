// backend/utils/seed_student.js
// Helpers for synthetic student + grades generation (testing only).

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

function randomGwa() {
  const value = 1 + Math.random() * 2; // 1.00–3.00
  return Number(value.toFixed(2));
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
  if (!(admittedDate instanceof Date) || isNaN(admittedDate)) {
    return null;
  }

  const minAge = 17;
  const maxAge = 21;

  const age = minAge + Math.floor(Math.random() * (maxAge - minAge + 1));
  const year = admittedDate.getFullYear() - age;

  const start = new Date(year, 0, 1).getTime();
  const end = new Date(year, 11, 31).getTime();
  const ts = start + Math.random() * (end - start);

  return new Date(ts);
}

// Curriculum → flat subjects list
function flattenCurriculumSubjects(curriculum) {
  const out = [];
  const structure = (curriculum && curriculum.structure) || {};

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

// Fill missing synthetic fields on StudentData doc shape
function fillMissingStudentFields(base, { graduationYear } = {}) {
  const out = { ...base };

  if (!out.gender) {
    out.gender = Math.random() < 0.5 ? 'male' : 'female';
  }

  if (!out.permanentAddress && !out.address) {
    out.permanentAddress = getRandomMagalangAddress();
  }

  // NEW: random place of birth if missing
  if (!out.placeOfBirth) {
    out.placeOfBirth = randomPlaceOfBirth();
  }

  // Admission + Graduation
  if (!out.dateAdmitted || !out.dateGraduated) {
    const gradYear =
      graduationYear ||
      (out.dateGraduated instanceof Date
        ? out.dateGraduated.getFullYear()
        : new Date().getFullYear());

    const admittedYear = gradYear - (3 + Math.floor(Math.random() * 3)); // 3–5 years
    if (!out.dateAdmitted) {
      out.dateAdmitted = randomDateBetween(admittedYear, admittedYear);
    }
    if (!out.dateGraduated) {
      out.dateGraduated = randomDateBetween(gradYear, gradYear);
    }
  }

  // Date of birth based on admission
  if (!out.dateOfBirth && out.dateAdmitted instanceof Date) {
    out.dateOfBirth = randomDateOfBirthForAdmission(out.dateAdmitted);
  }

  if (out.collegeGwa === undefined || out.collegeGwa === null) {
    out.collegeGwa = randomGwa();
  }

  if (!out.highSchool && !out.shsSchool) {
    const shs = randomSchoolName('SHS');
    out.highSchool = shs;
    out.shsSchool = shs;
  }

  if (!out.jhsSchool) {
    out.jhsSchool = randomSchoolName('JHS');
  }

  if (!out.entranceCredentials) {
    out.entranceCredentials = randomEntranceCredential();
  }

  return out;
}

module.exports = {
  getRandomMagalangAddress,
  randomDateBetween,
  randomGwa,
  randomSchoolName,
  randomEntranceCredential,
  randomPlaceOfBirth,
  randomDateOfBirthForAdmission,
  flattenCurriculumSubjects,
  getRandomGrade,
  getRemarksFromGrade,
  getTermNameFromSemester,
  getSampleSchoolYear,
  fillMissingStudentFields,
};
