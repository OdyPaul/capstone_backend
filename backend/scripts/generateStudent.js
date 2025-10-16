// backend/scripts/generateStudents.js
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const { getStudentsConn } = require("../config/db");
const Student = require("../models/students/studentModel");              // ⬅️ Students-DB Student
const Curriculum = require("../models/students/Curriculum");       // ⬅️ Students-DB Curriculum

const MONGO_URI = process.env.MONGO_URI_STUDENTS;

// ---------- Helper Functions ----------
function getRandomGrade() {
  const grades = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0];
  return grades[Math.floor(Math.random() * grades.length)];
}

function getRandomName(existingNames) {
  const firstNames = ["Juan", "Maria", "Jose", "Ana", "Pedro", "Liza", "Mark", "Karla", "Paulo", "Ella"];
  const lastNames = ["Santos", "Reyes", "Cruz", "Gonzales", "Torres", "Flores", "Ramos", "Bautista", "Mendoza", "Garcia"];

  let fullName;
  do {
    fullName = `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${
      lastNames[Math.floor(Math.random() * lastNames.length)]
    }`;
  } while (existingNames.has(fullName));

  existingNames.add(fullName);
  return fullName;
}

function flattenSubjects(curriculum) {
  const subjects = [];
  for (const year of Object.keys(curriculum.structure || {})) {
    for (const sem of Object.keys(curriculum.structure[year] || {})) {
      const arr = curriculum.structure[year][sem] || [];
      arr.forEach((s) => {
        if (s.code && s.code.trim() !== "") {
          subjects.push({
            subjectCode: s.code,
            subjectDescription: s.title || "",
            units: s.units || 3,
            yearLevel: year,
            semester: sem,
          });
        }
      });
    }
  }
  return subjects;
}

function generateStudentNumber(year, index) {
  return `C${year}${String(index).padStart(5, "0")}`;
}

// ---------- Main Logic ----------
async function createRandomStudent(curriculum, studentNumber, fullName) {
  const subjects = flattenSubjects(curriculum);
  if (!subjects.length) {
    console.warn(`⚠️ ${curriculum.program} has no subjects — skipping ${studentNumber}`);
    return;
  }

  const existing = await Student.findOne({ studentNumber });
  if (existing) {
    console.log(`ℹ️ Student ${studentNumber} already exists — skipping`);
    return;
  }

  const subjectsWithGrades = subjects.map((s) => {
    const grade = getRandomGrade();
    return {
      ...s,
      finalGrade: grade,
      remarks: grade <= 3.0 ? "PASSED" : "FAILED",
    };
  });

  const gwa =
    Number(
      (
        subjectsWithGrades.reduce((sum, s) => sum + s.finalGrade, 0) /
        subjectsWithGrades.length
      ).toFixed(2)
    ) || 0;

  const student = new Student({
    studentNumber,
    fullName,
    program: curriculum.program,
    dateGraduated: new Date("2025-06-30"),
    gwa,
    honor: "",
    curriculum: curriculum._id,
    subjects: subjectsWithGrades,
  });

  await student.save();
  console.log(`✅ ${student.fullName} (${curriculum.program}) created — GWA ${gwa}`);
}

async function main() {
  await mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  console.log("✅ MongoDB connected to Students DB");

  const curriculums = await Curriculum.find({});
  if (!curriculums.length) {
    console.error("❌ No curriculums found. Run importAllCurriculums.js first.");
    return;
  }

  const programs = curriculums.slice(0, 8);
  const existingNames = new Set();
  let studentIndex = 1;

  for (const curriculum of programs) {
    console.log(`\n📘 Generating 5 students for ${curriculum.program}...`);
    for (let i = 1; i <= 5; i++) {
      const year = Math.floor(Math.random() * (2025 - 2015 + 1)) + 2015;
      const studentNumber = generateStudentNumber(year, studentIndex++);
      const fullName = getRandomName(existingNames);
      await createRandomStudent(curriculum, studentNumber, fullName);
    }
  }
}

main()
  .then(async () => {
    // Close BOTH connections to exit cleanly
    try { await mongoose.disconnect(); } catch {}
    try { await getStudentsConn().close(); } catch {}
    console.log("\n🎉 Finished generating students.\n🔌 Disconnected from MongoDB.");
  })
  .catch(async (err) => {
    console.error("Fatal error:", err);
    try { await mongoose.disconnect(); } catch {}
    try { await getStudentsConn().close(); } catch {}
    process.exit(1);
  });
