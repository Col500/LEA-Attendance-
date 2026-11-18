import { SchoolClass, SchoolInfo, AttendanceSession } from '../types/attendance';

export const initialSchoolInfo: SchoolInfo = {
  id: 'school-primary',
  name: 'My Primary School',
  shortName: 'Attendance Portal',
  subLocation: '',
  zone: '',
  city: '',
  state: '',
  lga: '',
  academicSession: '2026/2027',
  currentTerm: 'First Term',
  headTeacher: 'Head Teacher',
  administratorName: 'School Administrator',
  contactPhone: '',
  contactEmail: '',
  absenceAlertThreshold: 15,
};

export const availableSchools: SchoolInfo[] = [initialSchoolInfo];

export const schoolInfo = initialSchoolInfo;

export const schoolClasses: SchoolClass[] = [];

export const sampleAttendanceSessions: AttendanceSession[] = [];
