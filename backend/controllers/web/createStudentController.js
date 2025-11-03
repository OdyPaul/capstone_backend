// backend/controllers/web/studentAdminController.js
const asyncHandler = require('express-async-handler');
const { isValidObjectId } = require('mongoose');

const cloudinary = require('../../utils/cloudinary');
const Student = require('../../models/students/studentModel');
const Curriculum = require('../../models/students/Curriculum');
const {
  generateRandomGradesForCurriculum,
  generateStudentNumber,
} = require('../../lib/createStudent');

// ---------- helpers ----------
function hasValue(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim().length > 0;
  return true;
}

function minusYears(dateLike, years) {
  const d = new Date(dateLike);
  if (isNaN(d)) return undefined;
  d.setFullYear(d.getFullYear() - Number(years || 0));
  return d;
}

function randPick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomPHAddress() {
  const streets = ['Mabini St.', 'Rizal Ave.', 'Bonifacio St.', 'Roxas Blvd.'];
  const brgys = ['Brgy. 1', 'Brgy. 12-B', 'Brgy. San Isidro', 'Brgy. Bagong Silang'];
  const cities = ['Quezon City', 'Cebu City', 'Davao City', 'Iloilo City', 'Baguio City'];
  const provs = ['Metro Manila', 'Cebu', 'Davao del Sur', 'Iloilo', 'Benguet'];
  return `${randPick(streets)}, ${randPick(brgys)}, ${randPick(cities)}, ${randPick(provs)}`;
}

function randomPlaceOfBirth() {
  const places = [
    'Quezon City, Metro Manila',
    'Cebu City, Cebu',
    'Davao City, Davao del Sur',
    'Iloilo City, Iloilo',
    'Baguio City, Benguet',
  ];
  return randPick(places);
}

async function uploadDataUriToCloudinary(dataUri, folder = 'students_profiles') {
  if (!/^data:image\//i.test(String(dataUri || ''))) return null;
  const res = await cloudinary.uploader.upload(dataUri, { folder });
  return res?.secure_url || null;
}

// ---------- controller ----------
exports.createStudent = asyncHandler(async (req, res) => {
  // pull values
  let {
    fullName,
    studentNumber,
    program,
    major,
    curriculumId,
    dateAdmission,
    dateGraduated,
    gender,
    address,
    placeOfBirth,
    extensionName,
    highSchool,
    entranceCredentials,
    honor,
    photoDataUrl,

    // NEW: toggle randomization of missing fields (default true)
    randomizeMissing,
  } = req.body;

  const wantRandom = randomizeMissing !== false; // default true

  // student no (always safe to generate if missing)
  if (!hasValue(studentNumber)) {
    let tries = 0;
    do {
      studentNumber = generateStudentNumber();
      // eslint-disable-next-line no-await-in-loop
      const exists = await Student.findOne({ studentNumber }).lean();
      if (!exists) break;
      tries += 1;
    } while (tries < 5);
  }

  // curriculum
  let curriculumDoc = null;
  if (hasValue(curriculumId)) {
    if (!isValidObjectId(curriculumId)) {
      return res.status(400).json({ message: 'Invalid curriculumId.' });
    }
    curriculumDoc = await Curriculum.findById(curriculumId).lean();
    if (!curriculumDoc) {
      return res.status(404).json({ message: 'Curriculum not found.' });
    }
    if (!hasValue(program)) {
      program =
        curriculumDoc?.program ||
        curriculumDoc?.name ||
        curriculumDoc?.title ||
        program;
    }
  }

  // subjects + GWA only if curriculum provided
  let subjects = [];
  let gwa = null;
  if (curriculumDoc) {
    const { subjects: subs, gwa: computedGwa } =
      generateRandomGradesForCurriculum(curriculumDoc);
    subjects = subs;
    gwa = computedGwa;
  }

  // dates
  const gradDateRaw = hasValue(dateGraduated)
    ? new Date(dateGraduated)
    : undefined;
  const gradDate = gradDateRaw && !isNaN(gradDateRaw) ? gradDateRaw : undefined;

  let admissionDate;
  if (hasValue(dateAdmission)) {
    const d = new Date(dateAdmission);
    admissionDate = !isNaN(d) ? d : undefined;
  } else {
    // If graduation is provided, admission = grad - 4 years (deterministic)
    // If not, base is "now" (keeps deterministic behavior even when wantRandom=false)
    const base = gradDate || new Date();
    admissionDate = minusYears(base, 4);
  }

  // randomizable fields → only when missing AND wantRandom
  const allowedGenders = new Set(['male', 'female', 'other']);
  const genderFinal =
    hasValue(gender) && allowedGenders.has(String(gender).toLowerCase())
      ? String(gender).toLowerCase()
      : wantRandom
      ? randPick(['male', 'female', 'other'])
      : undefined;

  const addressFinal = hasValue(address)
    ? String(address).trim()
    : wantRandom
    ? randomPHAddress()
    : undefined;

  const pobFinal = hasValue(placeOfBirth)
    ? String(placeOfBirth).trim()
    : wantRandom
    ? randomPlaceOfBirth()
    : undefined;

  const hsFinal = hasValue(highSchool)
    ? String(highSchool).trim()
    : wantRandom
    ? randPick([
        'QC Science HS',
        'Makati Science HS',
        'Iloilo National HS',
        'Davao City HS',
      ])
    : undefined;

  const entranceFinal = hasValue(entranceCredentials)
    ? String(entranceCredentials).trim()
    : wantRandom
    ? randPick(['Form 138', 'ALS', 'PEPT', 'Transferee'])
    : undefined;

  const honorFinal = hasValue(honor)
    ? String(honor).trim()
    : wantRandom
    ? randPick(['', 'Cum Laude', 'Magna Cum Laude', 'With Honors'])
    : undefined;

  // photo: upload only if provided
  const photoUrl = hasValue(photoDataUrl)
    ? await uploadDataUriToCloudinary(String(photoDataUrl))
    : undefined;

  // assemble payload (omit undefined)
  const payload = {
    fullName,
    ...(hasValue(extensionName) && {
      extensionName: String(extensionName).trim(),
    }),
    ...(hasValue(genderFinal) && { gender: genderFinal }),
    ...(hasValue(addressFinal) && { address: addressFinal }),
    ...(hasValue(pobFinal) && { placeOfBirth: pobFinal }),
    ...(hasValue(hsFinal) && { highSchool: hsFinal }),
    ...(hasValue(entranceFinal) && { entranceCredentials: entranceFinal }),

    studentNumber,
    ...(hasValue(program) && { program }),
    ...(hasValue(major) && { major }),

    dateAdmission: admissionDate,
    ...(gradDate && { dateGraduated: gradDate }),

    ...(hasValue(honorFinal) && { honor: honorFinal }),
    ...(gwa !== null && { gwa }),
    ...(subjects.length && { subjects }),
    ...(curriculumDoc && { curriculum: curriculumDoc._id }),
    ...(photoUrl && { photoUrl }),
  };

  const student = await Student.create(payload);
  return res.status(201).json({ student });
});
