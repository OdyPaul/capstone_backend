const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });


const mongoose = require("mongoose");
const Student = require("../models/web/studentModel");
const Curriculum = require("../models/web/Curriculum");
const connectDB = require("../config/db");
console.log("MONGO_URI in script:", process.env.MONGO_URI);
function getRandomGrade() {
  const grades = [1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0];
  return grades[Math.floor(Math.random() * grades.length)];
}

function getRandomName() {
  const firstNames = ["Juan", "Maria", "Jose", "Ana", "Pedro", "Liza", "Mark", "Karla", "Paulo", "Ella"];
  const lastNames = ["Santos", "Reyes", "Cruz", "Gonzales", "Torres", "Flores", "Ramos", "Bautista", "Mendoza", "Garcia"];
  return `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${
    lastNames[Math.floor(Math.random() * lastNames.length)]
  }`;
}

function flattenSubjects(curriculum) {
  const subjects = [];

  if (curriculum.structure && typeof curriculum.structure === "object") {
    for (const year of Object.keys(curriculum.structure)) {
      const semesters = curriculum.structure[year];
      for (const sem of Object.keys(semesters)) {
        const arr = semesters[sem] || [];
        arr.forEach((s) => {
          if (s.code && s.code.trim() !== "") {
            subjects.push({
              subjectCode: s.code,
              subjectDescription: s.title || "",
              units: s.units || "",
              yearLevel: year,
              semester: sem,
            });
          }
        });
      }
    }
  }

  return subjects;
}

async function createRandomStudent(curriculum, studentNumber) {
  const subjects = flattenSubjects(curriculum);

  if (!subjects.length) {
    console.warn(`⚠️ ${curriculum.program} has no subjects — skipping ${studentNumber}`);
    return;
  }

  // avoid duplicate studentNumbers
  const existing = await Student.findOne({ studentNumber });
  if (existing) {
    console.log(`ℹ️ Student ${studentNumber} already exists — skipping`);
    return;
  }

  const subjectsWithGrades = subjects.map((sub) => {
    const grade = getRandomGrade();
    return {
      subjectCode: sub.subjectCode,
      subjectDescription: sub.subjectDescription,
      units: sub.units,
      yearLevel: sub.yearLevel,
      semester: sub.semester,
      finalGrade: grade,
      remarks: grade <= 3.0 ? "PASSED" : "FAILED",
    };
  });

  const total = subjectsWithGrades.reduce((sum, s) => sum + s.finalGrade, 0);
  const gwa = Number((total / subjectsWithGrades.length).toFixed(2));

  const student = new Student({
    studentNumber,
    fullName: getRandomName(),
    program: curriculum.program,
    dateGraduated: "2025-06-30",
    gwa,
    honor: "",
    curriculum: curriculum._id,
    subjects: subjectsWithGrades,
  });

  await student.save();
  console.log(`✅ ${student.fullName} (${curriculum.program}) created — GWA ${gwa}`);
}

async function main() {
  try {
    await connectDB();  // connect to DB

    const curriculums = await Curriculum.find({});
    if (!curriculums.length) {
      console.error("❌ No curriculums found. Run importAllCurriculums.js first.");
      return;
    }

    for (const curriculum of curriculums) {
      console.log(`\n📌 Generating students for ${curriculum.program}...`);
      for (let i = 1; i <= 10; i++) {
        await createRandomStudent(curriculum, `${curriculum.program}-2020-${1000 + i}`);
      }
    }
  } catch (err) {
    console.error("Error in main:", err);
  } finally {
    // Always disconnect
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

// Run script
main().catch((err) => {
  console.error("Fatal error:", err);
  mongoose.disconnect();
});
