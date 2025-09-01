import React, { useMemo } from 'react';
import type { Question, Statuses } from '../types';
import { QuestionStatus } from '../types';

interface QuestionNavigatorProps {
  questions: Question[];
  statuses: Statuses;
  currentIndex: number;
  onSelect: (index: number) => void;
  sections: string[];
  currentSection: string;
  onSectionChange: (section: string) => void;
}

const statusStyles: { [key in QuestionStatus]: string } = {
  [QuestionStatus.NotVisited]: "bg-status-not-visited hover:ring-gray-400",
  [QuestionStatus.NotAnswered]: "bg-status-not-answered hover:ring-red-400",
  [QuestionStatus.Answered]: "bg-status-answered hover:ring-green-400",
  [QuestionStatus.MarkedForReview]: "bg-status-marked hover:ring-purple-400",
  [QuestionStatus.AnsweredAndMarked]: "bg-status-marked relative after:content-[''] after:absolute after:w-2 after:h-2 after:bg-green-400 after:rounded-full after:right-1 after:top-1 hover:ring-purple-400",
};

const LegendItem: React.FC<{ colorClass: string; label: string }> = ({ colorClass, label }) => (
    <div className="flex items-center space-x-2">
        <div className={`w-5 h-5 rounded ${colorClass}`}></div>
        <span className="text-xs text-text-secondary-dark">{label}</span>
    </div>
);

const QuestionNavigator: React.FC<QuestionNavigatorProps> = ({ questions, statuses, currentIndex, onSelect, sections, currentSection, onSectionChange }) => {
  const currentQid = questions[currentIndex]?.qid;

  const filteredQuestions = useMemo(() => {
    if (currentSection === 'All') return questions;
    return questions.filter(q => q.section === currentSection);
  }, [questions, currentSection]);
  
  return (
    <div className="flex flex-col h-full">
        <div className="flex-shrink-0">
            {sections.length > 1 && (
                <div className="flex flex-wrap gap-2 mb-4">
                    {sections.map(section => (
                        <button 
                            key={section}
                            onClick={() => onSectionChange(section)}
                            className={`px-3 py-1 text-sm font-semibold rounded-full transition-colors ${currentSection === section ? 'bg-brand-secondary text-white' : 'bg-gray-700 hover:bg-gray-600 text-text-secondary-dark'}`}
                        >
                            {section}
                        </button>
                    ))}
                </div>
            )}
            <h3 className="text-lg font-semibold mb-4 text-center">Question Palette</h3>
        </div>
        
        <div className="flex-grow overflow-y-auto pr-2">
            <div className="grid grid-cols-4 gap-2">
                {filteredQuestions.map((q) => {
                    const originalIndex = questions.findIndex(origQ => origQ.qid === q.qid);
                    return (
                        <button
                            key={q.qid}
                            onClick={() => onSelect(originalIndex)}
                            className={`flex items-center justify-center w-12 h-12 rounded-md font-bold text-white transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-surface-dark ${statusStyles[statuses[q.qid]]} ${q.qid === currentQid ? 'ring-2 ring-brand-accent ring-offset-2 ring-offset-background-dark' : 'hover:ring-2'}`}
                        >
                            {q.qid}
                        </button>
                    );
                })}
            </div>
        </div>

       <div className="space-y-2 p-3 bg-background-dark rounded-lg mt-4 flex-shrink-0">
           <LegendItem colorClass="bg-status-answered" label="Answered" />
           <LegendItem colorClass="bg-status-not-answered" label="Not Answered" />
           <LegendItem colorClass="bg-status-marked" label="Marked for Review" />
           <LegendItem colorClass="bg-status-not-visited" label="Not Visited" />
           <div className="flex items-center space-x-2">
                <div className="w-5 h-5 rounded bg-status-marked relative after:content-[''] after:absolute after:w-2 after:h-2 after:bg-green-400 after:rounded-full after:right-0.5 after:top-0.5"></div>
                <span className="text-xs text-text-secondary-dark">Answered & Marked</span>
           </div>
       </div>
    </div>
  );
};

export default QuestionNavigator;
