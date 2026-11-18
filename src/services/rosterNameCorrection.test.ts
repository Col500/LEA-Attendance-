import assert from 'node:assert/strict';
import {
  cleanNigerianStudentName,
  mergeNigerianNameCorrections,
  type RosterStudentCandidate
} from '../server/rosterNameCorrectionService';

// 1. Clean Nigerian name normalization tests
{
  assert.equal(cleanNigerianStudentName('ABUBAKAR   MUSA_'), 'Abubakar Musa');
  assert.equal(cleanNigerianStudentName('OLUWA-SEGUN  ADEBAYO'), 'Oluwa-Segun Adebayo');
  assert.equal(cleanNigerianStudentName('CHINAZA B. OKAFOR'), 'Chinaza B. Okafor');
  assert.equal(cleanNigerianStudentName('  *zainab|ibrahim=  '), 'Zainab Ibrahim');
  assert.equal(cleanNigerianStudentName('   '), '');
}

// 2. Conservative merge of Nigerian-context OCR corrections
{
  const initialRows: RosterStudentCandidate[] = [
    { studentNumber: 1, fullName: 'ABUBAKER MUSA', admissionNumber: 'LEA/01' },
    { studentNumber: 2, fullName: 'CHUKWURNA OKAFOR', admissionNumber: 'LEA/02' },
    { studentNumber: 3, fullName: 'OLUWASEGUN ADEBAY0', admissionNumber: 'LEA/03' },
    { studentNumber: 4, fullName: 'AMINA YUSUF', admissionNumber: 'LEA/04' }
  ];

  const merged = mergeNigerianNameCorrections(initialRows, [
    {
      studentNumber: 1,
      correctedFullName: 'ABUBAKAR MUSA',
      reason: 'Fixed common e->a OCR slip in Hausa name'
    },
    {
      studentNumber: 2,
      correctedFullName: 'Chukwuma Okafor',
      reason: 'Fixed rn->m OCR substitution'
    },
    {
      studentNumber: 3,
      correctedFullName: 'Oluwasegun Adebayo',
      reason: 'Fixed 0->o digit-letter swap'
    },
    // Same spelling as row 4 (just case normalized) -> should NOT increment correctedCount
    {
      studentNumber: 4,
      correctedFullName: 'Amina Yusuf',
      reason: ''
    },
    // Out-of-range row number -> must NEVER invent a new student row
    {
      studentNumber: 99,
      correctedFullName: 'Invented Pupil',
      reason: 'Should be ignored'
    },
    // Blank/too-short suggestion -> ignored safely
    {
      studentNumber: 4,
      correctedFullName: 'X',
      reason: 'Too short'
    }
  ]);

  assert.equal(merged.students.length, 4);
  assert.equal(merged.correctedCount, 3);

  assert.equal(merged.students[0].fullName, 'Abubakar Musa');
  assert.equal(merged.students[0].originalOcrName, 'ABUBAKER MUSA');
  assert.equal(merged.students[0].aiCorrected, true);
  assert.equal(
    merged.students[0].aiCorrectionNote,
    'Fixed common e->a OCR slip in Hausa name'
  );

  assert.equal(merged.students[1].fullName, 'Chukwuma Okafor');
  assert.equal(merged.students[1].originalOcrName, 'CHUKWURNA OKAFOR');
  assert.equal(merged.students[1].aiCorrected, true);

  assert.equal(merged.students[2].fullName, 'Oluwasegun Adebayo');
  assert.equal(merged.students[2].originalOcrName, 'OLUWASEGUN ADEBAY0');
  assert.equal(merged.students[2].aiCorrected, true);

  // Row 4 stays unflagged as AI-corrected because spelling was already valid, just formatted cleanly
  assert.equal(merged.students[3].fullName, 'Amina Yusuf');
  assert.equal(merged.students[3].originalOcrName, 'AMINA YUSUF');
  assert.equal(merged.students[3].aiCorrected, false);
}

// 3. Preserves originalOcrName across repeated correction passes
{
  const pass1: RosterStudentCandidate[] = [
    {
      studentNumber: 5,
      fullName: 'Ada Sarnson',
      originalOcrName: 'ADA SARNSON',
      aiCorrected: false
    }
  ];

  const pass2 = mergeNigerianNameCorrections(pass1, [
    {
      studentNumber: 5,
      correctedFullName: 'Ada Samson',
      reason: 'Fixed rn->m in surname'
    }
  ]);

  assert.equal(pass2.correctedCount, 1);
  assert.equal(pass2.students[0].fullName, 'Ada Samson');
  assert.equal(pass2.students[0].originalOcrName, 'ADA SARNSON');
  assert.equal(pass2.students[0].aiCorrected, true);
}

console.log('✅ All Nigerian-context roster name correction tests passed!');
