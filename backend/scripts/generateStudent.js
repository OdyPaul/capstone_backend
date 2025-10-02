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

function getRandomName(existingNames) {
  const firstNames = ["Juan", "Maria", "Jose", "Ana", "Pedro", "Liza", "Mark", "Karla", "Paulo", "Ella"];
  const lastNames = ["Santos", "Reyes", "Cruz", "Gonzales", "Torres", "Flores", "Ramos", "Bautista", "Mendoza", "Garcia"];

  let fullName;
  do {
    fullName = `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${
      lastNames[Math.floor(Math.random() * lastNames.length)]
    }`;
  } while (existingNames.has(fullName)); // ensure no duplicates

  existingNames.add(fullName);
  return fullName;
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

// generate studentNumber
function generateStudentNumber(year, index) {
  return `C${year}${String(index).padStart(5, "0")}`;
}

async function createRandomStudent(curriculum, studentNumber, fullName) {
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
    fullName,
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
    await connectDB();

    const curriculums = await Curriculum.find({});
    if (!curriculums.length) {
      console.error("❌ No curriculums found. Run importAllCurriculums.js first.");
      return;
    }

    // Only use 8 programs max
    const programs = curriculums.slice(0, 8);

    const existingNames = new Set();
    let studentIndex = 1; // global index

    for (const curriculum of programs) {
      console.log(`\n📌 Generating 5 students for ${curriculum.program}...`);

      for (let i = 1; i <= 5; i++) {
        const year = Math.floor(Math.random() * (2025 - 2015 + 1)) + 2015; // 2015–2025
        const studentNumber = generateStudentNumber(year, studentIndex++);
        const fullName = getRandomName(existingNames);

        await createRandomStudent(curriculum, studentNumber, fullName);
      }
    }

    console.log(`🎉 Finished generating ${programs.length * 5} students.`);
  } catch (err) {
    console.error("Error in main:", err);
  } finally {
    await mongoose.disconnect();
    console.log("Disconnected from MongoDB.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  mongoose.disconnect();
});
