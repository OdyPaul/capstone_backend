// generateStudents.js
const mongoose = require("mongoose");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const Student = require("../models/web/studentModel");
const Curriculum = require("../models/web/Curriculum");

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI_Students, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log(`✅ MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`❌ Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

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
            units: s.units || "",
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
      subjectCode: s.subjectCode,
      subjectDescription: s.subjectDescription,
      units: s.units,
      yearLevel: s.yearLevel,
      semester: s.semester,
      finalGrade: grade,
      remarks: grade <= 3.0 ? "PASSED" : "FAILED",
    };
  });

  const gwa = Number(
    (subjectsWithGrades.reduce((sum, s) => sum + s.finalGrade, 0) / subjectsWithGrades.length).toFixed(2)
  );

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
  await connectDB();

  const curriculums = await Curriculum.find({});
  if (!curriculums.length) {
    console.error("❌ No curriculums found. Run importAllCurriculums.js first.");
    await mongoose.disconnect();
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

  console.log(`🎉 Finished generating ${programs.length * 5} students.`);
  await mongoose.disconnect();
  console.log("🔌 Disconnected from MongoDB.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  mongoose.disconnect();
});
