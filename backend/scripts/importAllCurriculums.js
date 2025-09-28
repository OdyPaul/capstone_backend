const mongoose = require("mongoose");
const path = require("path");
const fs = require("fs");
const Curriculum = require("../models/web/Curriculum");

require('dotenv').config({ path: path.resolve(__dirname, '../.env') });


const MONGO_URI = process.env.MONGO_URI;

// Regex to validate subject codes
const validCodeRegex = /^([A-Z]{2,}[0-9]{0,3}([- ]?[0-9A-Z]{0,3})*)$/;

function isValidCode(code) {
  if (!code) return false;
  const trimmed = code.trim();
  if (validCodeRegex.test(trimmed)) return true;
  if (/^[A-Z]{2,10}$/.test(trimmed)) return true; // allow short codes like OJT, NSTP
  return false;
}

async function importCurriculumFromFile(filePath) {
  const rawData = fs.readFileSync(filePath, "utf-8");
  const jsonData = JSON.parse(rawData);

  const fileName = path.basename(filePath, path.extname(filePath));
  const program = fileName.split("_")[0].toUpperCase();

  let subjectCount = 0;

  // Clean subjects
  Object.keys(jsonData).forEach((year) => {
    Object.keys(jsonData[year]).forEach((sem) => {
      jsonData[year][sem] = jsonData[year][sem].filter((s) => {
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

  await Curriculum.deleteMany({ program }); // remove old one(s) if any

  const curriculum = new Curriculum({
    program,
    curriculumYear: "2024",
    structure: jsonData,
  });

  await curriculum.save();
  console.log(`✅ Imported curriculum for ${program} with ${subjectCount} subjects`);
}

async function run() {
  try {
    const dir = path.join(__dirname, "..", "Curriculums");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));

    if (files.length === 0) {
      console.log("❌ No JSON files found in Curriculums folder.");
      return;
    }

    for (const file of files) {
      const filePath = path.join(dir, file);
      await importCurriculumFromFile(filePath);
    }
  } catch (err) {
    console.error("❌ Error importing:", err);
  } finally {
    await mongoose.disconnect();
    console.log("🔌 Disconnected from MongoDB.");
  }
}

// Only connect and run once
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log("✅ MongoDB connected");
    return run();
  })
  .catch((err) => {
    console.error("❌ MongoDB connection failed:", err);
    process.exit(1);
  });
