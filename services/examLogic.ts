import type { Attempt, QuestionSet, Score } from '../types';
import { QuestionType } from '../types';

export const calculateScore = (attempt: Attempt, questionSet: QuestionSet): Score => {
    let mcqCorrect = 0;
    let mcqWrong = 0;
    let titaCorrect = 0;
    let totalAnswered = 0;

    const { marking } = questionSet.meta;

    for(const q of questionSet.questions) {
        const userAnswer = attempt.answers[q.qid];
        if (userAnswer && userAnswer.trim() !== "") {
            totalAnswered++;
            const isCorrect = userAnswer.trim().toLowerCase() === q.answerKey?.toLowerCase();
            
            if (q.qtype === QuestionType.MCQ) {
                if(isCorrect) mcqCorrect++;
                else mcqWrong++;
            } else if (q.qtype === QuestionType.TITA) {
                if(isCorrect) titaCorrect++;
            }
        }
    }
    
    const raw = (mcqCorrect * marking.mcq.correct) + (mcqWrong * marking.mcq.wrong) + (titaCorrect * marking.tita.correct);

    return { raw, mcqCorrect, mcqWrong, titaCorrect, totalAnswered };
  }