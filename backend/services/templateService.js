// services/templateService.js

const {
  buildDataFromTemplate,
  validateAgainstTemplate,
} = require('../utils/vcTemplate');
const { torSubjectsFromGrades } = require('./gradeService');

/**
 * Build credentialSubject data from template + student (+curriculum, +grades)
 * and validate against template attributes.
 */
function buildSubjectData({
  template,
  student,
  curriculumDoc,
  kind,
  overrides = {},
  grades = [],
}) {
  const effectiveOverrides = { ...overrides };

  if (kind === 'tor') {
    effectiveOverrides.subjects =
      effectiveOverrides.subjects && effectiveOverrides.subjects.length
        ? effectiveOverrides.subjects
        : torSubjectsFromGrades(grades);

    if (student.collegeGwa != null && effectiveOverrides.gwa == null) {
      effectiveOverrides.gwa = student.collegeGwa;
    }
  }

  const attrs = Array.isArray(template.attributes) ? template.attributes : [];
  if (!attrs.length) {
    throw Object.assign(
      new Error('Template has no attributes configured'),
      { status: 400 },
    );
  }

  const withAttrs = { ...template.toObject(), attributes: attrs };

  const data = buildDataFromTemplate(
    withAttrs,
    student,
    effectiveOverrides,
    curriculumDoc,
  );
  const { valid, errors } = validateAgainstTemplate(withAttrs, data);

  if (!valid) {
    throw Object.assign(
      new Error('Validation failed: ' + errors.join('; ')),
      { status: 400 },
    );
  }

  return data;
}

module.exports = {
  buildSubjectData,
};
