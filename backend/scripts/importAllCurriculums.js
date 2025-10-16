require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const mongoose = require("mongoose");
const fs = require("fs");
const path = require("path");

// ✅ use the Students-DB model (dual-mode)
const Curriculum = require("../models/students/Curriculum");

const MONGO_URI = process.env.MONGO_URI_STUDENTS;

const validCodeRegex = /^([A-Z]{2,}[0-9]{0,3}([- ]?[0-9A-Z]{0,3})*)$/;
const isValidCode = (code) => !!code && (validCodeRegex.test(code.trim()) || /^[A-Z]{2,10}$/.test(code.trim()));

async function importCurriculumFromFile(filePath) {
  const rawData = fs.readFileSync(filePath, "utf-8");
  const jsonData = JSON.parse(rawData);

  const fileName = path.basename(filePath, path.extname(filePath));
  const program = fileName.split("_")[0].toUpperCase();

  let subjectCount = 0;

  // clean/validate
  Object.keys(jsonData).forEach((year) => {
    Object.keys(jsonData[year]).forEach((sem) => {
      jsonData[year][sem] = (jsonData[year][sem] || []).filter((s) => {
        if (s.code && isValidCode(s.code)) {
          if (!("units" in s)) s.units = "";
          subjectCount++;
          return true;
        }
        return false;
      });
    });
  });

  if (subjectCount === 0) {
    console.log(`⚠️ Skipping ${program} — no valid subjects found.`);
    return;
  }

  await Curriculum.deleteMany({ program });

  await new Curriculum({
    program,
    curriculumYear: "2024",
    structure: jsonData,
  }).save();

  console.log(`✅ Imported ${program} with ${subjectCount} subjects.`);
}

async function run() {
  const dir = path.join(__dirname, "..", "Curriculums");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  if (!files.length) {
    console.log("❌ No JSON files found in Curriculums folder.");
    return;
  }
  for (const file of files) {
    await importCurriculumFromFile(path.join(dir, file));
  }
}

(async () => {
  await mongoose.connect(MONGO_URI, { });
  console.log("✅ MongoDB connected to Students DB");
  try {
    await run();
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB.");
  }
})().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
