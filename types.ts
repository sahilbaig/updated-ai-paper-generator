
export enum QuestionType {
  MCQ = "MCQ",
  TITA = "TITA",
}

export enum QuestionStatus {
  NotVisited = "Not Visited",
  NotAnswered = "Not Answered",
  Answered = "Answered",
  MarkedForReview = "Marked for Review",
  AnsweredAndMarked = "Answered & Marked for Review",
}

export interface Option {
  label: string;
  text: string;
}

export interface FigureRef {
  dataUrl: string;
  caption: string | null;
}

export interface Question {
  qid: number;
  text: string;
  qtype: QuestionType;
  options: Option[];
  answerKey: string | null;
  passageId: number | null;
  figureRefs: FigureRef[];
  pageRef: number;
  section?: string;
  topic?: string;
}

export interface Passage {
  passageId: number;
  title?: string;
  text: string;
  pageSpan: [number, number];
}

export interface MarkingScheme {
  mcq: { correct: number; wrong: number };
  tita: { correct: number; wrong: number };
}

export interface QuestionSet {
  meta: {
    title: string;
    year?: number;
    sourceUrl?: string;
    status: "processing" | "ready" | "error";
    totalQuestions: number;
    totalPassages: number;
    marking: MarkingScheme;
  };
  passages: Passage[];
  questions: Question[];
}

export interface Answers {
  [qid: number]: string;
}

export interface Statuses {
    [qid: number]: QuestionStatus;
}

export interface Score {
    raw: number;
    mcqCorrect: number;
    mcqWrong: number;
    titaCorrect: number;
    totalAnswered: number;
}

export interface Attempt {
  uploadId: string;
  userId: string;
  timer: {
    startedAt: number;
    durationSec: number;
    remainingSec: number;
  };
  answers: Answers;
  statuses: Statuses;
  status: "inProgress" | "submitted";
  score: Score | null;
}