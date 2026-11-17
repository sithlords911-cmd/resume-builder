export interface Education {
  id: string;
  institution: string;
  degree: string;
  field: string;
  startYear: string;
  endYear: string;
  grade: string;
}

export interface Experience {
  id: string;
  company: string;
  role: string;
  startDate: string;
  endDate: string;
  description: string;
}

export interface Certification {
  id: string;
  name: string;
  issuer: string;
  year: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  tech: string;
}

export interface ResumeData {
  name: string;
  title: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
  website: string;
  summary: string;
  education: Education[];
  experience: Experience[];
  skills: string[];
  certifications: Certification[];
  projects: Project[];
  achievements: string[];
  languages: string[];
}

export interface ExtractedFile {
  id: string;
  fileName: string;
  fileType: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  progress: number; // 0-100
  statusText: string;
  text: string;
  pages: number;
  error?: string;
}

export type BuilderStep = 'upload' | 'processing' | 'review' | 'preview';

export const emptyResume = (): ResumeData => ({
  name: '',
  title: '',
  email: '',
  phone: '',
  location: '',
  linkedin: '',
  github: '',
  website: '',
  summary: '',
  education: [],
  experience: [],
  skills: [],
  certifications: [],
  projects: [],
  achievements: [],
  languages: [],
});

export const uid = () => Math.random().toString(36).slice(2, 10);
