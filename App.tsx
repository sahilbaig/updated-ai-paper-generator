import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { Question, QuestionSet, Attempt, Statuses } from './types';
import { QuestionStatus, QuestionType } from './types';
import { parsePdfWithGemini, getHintForQuestion } from './services/geminiService';
import { calculateScore } from './services/examLogic';
import { useTimer } from './hooks/useTimer';
import { UploadCloudIcon, CheckCircleIcon, AlertTriangleIcon, LightbulbIcon, PauseIcon, PlayIcon, XCircleIcon } from './components/icons';
import Spinner from './components/Spinner';
import QuestionNavigator from './components/QuestionNavigator';

type View = 'upload' | 'processing' | 'exam' | 'results';
const EXAM_DURATION_SECONDS = 180 * 60; // 3 hours

const App: React.FC = () => {
    const [view, setView] = useState<View>('upload');
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [processingError, setProcessingError] = useState<string | null>(null);
    const [processingMessage, setProcessingMessage] = useState<string>('');
    const [questionSet, setQuestionSet] = useState<QuestionSet | null>(null);
    const [attempt, setAttempt] = useState<Attempt | null>(null);
    const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

    const [hint, setHint] = useState<{ qid: number, text: string } | null>(null);
    const [isHintLoading, setIsHintLoading] = useState(false);


    const handleFileUpload = async (file: File) => {
        if (!file) return;
        setView('processing');
        setProcessingError(null);
        setProcessingMessage('Starting process...');
        try {
            const parsedQuestionSet = await parsePdfWithGemini(file, setProcessingMessage);
            const newSessionId = `${file.name}-${file.lastModified}`;
            setSessionId(newSessionId);
            setQuestionSet(parsedQuestionSet);
            console.log("Question Set state updated:", parsedQuestionSet);
            startExam(parsedQuestionSet, newSessionId);
        } catch (error) {
            console.error("PDF Parsing failed", error);
            const errorMessage = error instanceof Error ? `AI parsing failed: ${error.message}` : "An unknown error occurred during parsing.";
            setProcessingError(errorMessage);
            setView('upload');
        }
    };

    const startExam = (qSet: QuestionSet, currentSessionId: string) => {
        if (qSet.questions.length === 0) {
            setProcessingError("No questions could be parsed from the PDF. It might be a blank document or have an unsupported format.");
            setView('upload');
            return;
        }

        const statuses: Statuses = {};
        qSet.questions.forEach(q => statuses[q.qid] = QuestionStatus.NotVisited);
        
        statuses[qSet.questions[0].qid] = QuestionStatus.NotAnswered;
        
        const savedAttemptRaw = localStorage.getItem(`attempt_${currentSessionId}`);
        if(savedAttemptRaw) {
            const savedAttempt = JSON.parse(savedAttemptRaw);
            setAttempt(savedAttempt);
            console.log("Loaded saved attempt:", savedAttempt);
            const lastQuestionId = localStorage.getItem(`last_qid_${currentSessionId}`) || (qSet.questions.length > 0 ? qSet.questions[0].qid : 1);
            const savedIndex = qSet.questions.findIndex(q => q.qid === parseInt(lastQuestionId as string, 10));
            setCurrentQuestionIndex(savedIndex >= 0 ? savedIndex : 0);
        } else {
            const newAttempt: Attempt = {
                uploadId: currentSessionId,
                userId: "local_user",
                timer: {
                    startedAt: Date.now(),
                    durationSec: EXAM_DURATION_SECONDS,
                    remainingSec: EXAM_DURATION_SECONDS,
                },
                answers: {},
                statuses,
                status: "inProgress",
                score: null,
            };
            setAttempt(newAttempt);
            console.log("Started new attempt:", newAttempt);
            setCurrentQuestionIndex(0);
        }

        setView('exam');
    };
    
    const autosaveAttempt = useCallback(() => {
        if (attempt && sessionId) {
            localStorage.setItem(`attempt_${sessionId}`, JSON.stringify(attempt));
            if(questionSet && questionSet.questions[currentQuestionIndex]) {
                 localStorage.setItem(`last_qid_${sessionId}`, questionSet.questions[currentQuestionIndex].qid.toString());
            }
        }
    }, [attempt, sessionId, currentQuestionIndex, questionSet]);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (view === 'exam') {
                autosaveAttempt();
            }
        }, 3000);
        return () => clearTimeout(timer);
    }, [attempt, view, autosaveAttempt]);


    const submitExam = useCallback(() => {
        if (attempt && questionSet) {
            autosaveAttempt();
            const score = calculateScore(attempt, questionSet);
            const finalAttempt = { ...attempt, status: 'submitted' as const, score };
            setAttempt(finalAttempt);
            setView('results');
            if (sessionId) {
                localStorage.removeItem(`attempt_${sessionId}`);
                localStorage.removeItem(`last_qid_${sessionId}`);
            }
        }
    }, [attempt, questionSet, sessionId, autosaveAttempt]);
    
     const handleGetHint = async (question: Question) => {
        setIsHintLoading(true);
        setHint(null);
        try {
            const hintText = await getHintForQuestion(question);
            setHint({ qid: question.qid, text: hintText });
        } catch (error) {
            console.error("Failed to get hint:", error);
            setHint({ qid: question.qid, text: "Sorry, couldn't fetch a hint right now." });
        } finally {
            setIsHintLoading(false);
        }
    };
    
    return (
        <div className="min-h-screen bg-background-dark text-text-primary-dark font-sans">
            <main>
                {view === 'upload' && <UploadView onFileUpload={handleFileUpload} error={processingError} />}
                {view === 'processing' && <ProcessingView message={processingMessage} />}
                {view === 'exam' && questionSet && attempt && (
                    <ExamView
                        questionSet={questionSet}
                        attempt={attempt}
                        setAttempt={setAttempt}
                        currentQuestionIndex={currentQuestionIndex}
                        setCurrentQuestionIndex={setCurrentQuestionIndex}
                        onSubmit={submitExam}
                        onExit={() => setView('upload')}
                        onGetHint={handleGetHint}
                        hint={hint}
                        isHintLoading={isHintLoading}
                    />
                )}
                {view === 'results' && attempt?.score && questionSet && (
                   <ResultsView attempt={attempt} questionSet={questionSet} />
                )}
            </main>
        </div>
    );
};

// UPLOAD VIEW
const UploadView: React.FC<{ onFileUpload: (file: File) => void; error: string | null }> = ({ onFileUpload, error }) => {
    const [dragging, setDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            onFileUpload(e.target.files[0]);
        }
    };
    
    const handleDragEvents = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.type === 'dragenter' || e.type === 'dragover') {
            setDragging(true);
        } else if (e.type === 'dragleave') {
            setDragging(false);
        }
    };
    
    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
            onFileUpload(e.dataTransfer.files[0]);
        }
    };

    return (
        <div className="flex flex-col items-center justify-center min-h-screen p-4">
             <div className="text-center mb-8">
                <h1 className="text-4xl sm:text-5xl font-bold text-white mb-2">CAT Exam Simulator</h1>
                <p className="text-lg text-text-secondary-dark">Upload any CAT PDF and start your practice test instantly.</p>
            </div>
            {error && (
                <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-lg relative mb-6 w-full max-w-md flex items-center">
                    <AlertTriangleIcon className="w-5 h-5 mr-3" />
                    <span className="block sm:inline">{error}</span>
                </div>
            )}
            <div 
                className={`relative w-full max-w-lg p-8 sm:p-10 border-2 border-dashed rounded-xl transition-all duration-300 ${dragging ? 'border-brand-accent bg-surface-dark/50' : 'border-gray-600 hover:border-brand-secondary'}`}
                onDragEnter={handleDragEvents}
                onDragOver={handleDragEvents}
                onDragLeave={handleDragEvents}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
            >
                <div className="flex flex-col items-center justify-center space-y-4 text-center">
                    <UploadCloudIcon className={`w-16 h-16 transition-colors duration-300 ${dragging ? 'text-brand-accent' : 'text-gray-500'}`} />
                    <p className="text-xl font-semibold text-text-primary-dark">Drag & drop your PDF here</p>
                    <p className="text-text-secondary-dark">or click to browse</p>
                    <p className="text-xs text-gray-500">Supports scanned and digital papers from 1990-present</p>
                    <p className="text-xs text-gray-500 mt-2">Note: Parsing is done by an advanced AI to ensure accuracy.</p>
                </div>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf"
                    className="hidden"
                    onChange={handleFileChange}
                />
            </div>
        </div>
    );
};

// PROCESSING VIEW
const ProcessingView: React.FC<{ message: string }> = ({ message }) => (
    <div className="flex flex-col items-center justify-center min-h-screen space-y-6 text-center px-4">
        <Spinner className="w-16 h-16 text-brand-secondary" />
        <h2 className="text-2xl font-semibold text-white animate-pulse">{message || 'Processing your PDF...'}</h2>
        <p className="text-text-secondary-dark max-w-md">
            Our AI is analyzing the document's layout, text, and images. This may take a minute for large files.
        </p>
    </div>
);


// EXAM VIEW
interface ExamViewProps {
    questionSet: QuestionSet;
    attempt: Attempt;
    setAttempt: React.Dispatch<React.SetStateAction<Attempt | null>>;
    currentQuestionIndex: number;
    setCurrentQuestionIndex: React.Dispatch<React.SetStateAction<number>>;
    onSubmit: () => void;
    onExit: () => void;
    onGetHint: (question: Question) => void;
    hint: { qid: number, text: string } | null;
    isHintLoading: boolean;
}
const ExamView: React.FC<ExamViewProps> = ({ questionSet, attempt, setAttempt, currentQuestionIndex, setCurrentQuestionIndex, onSubmit, onExit, onGetHint, hint, isHintLoading }) => {
    const { remainingTime, start, pause, isRunning, setTime } = useTimer(attempt.timer.remainingSec, onSubmit);
    const [currentSection, setCurrentSection] = useState<string>('All');
    const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);
    
    const sections = useMemo(() => ['All', ...Array.from(new Set(questionSet.questions.map(q => q.section).filter((s): s is string => !!s)))], [questionSet.questions]);
    
    const filteredQuestions = useMemo(() => {
        if (currentSection === 'All') return questionSet.questions;
        return questionSet.questions.filter(q => q.section === currentSection);
    }, [questionSet.questions, currentSection]);
    
    const currentQuestion = questionSet.questions[currentQuestionIndex];
    const currentPassage = currentQuestion?.passageId ? questionSet.passages.find(p => p.passageId === currentQuestion.passageId) : null;
    
    const togglePause = () => {
        if (isRunning) pause();
        else start();
    };

    const handleConfirmSubmit = () => {
        onSubmit();
        setIsSubmitModalOpen(false);
    };

    useEffect(() => {
        const savedAttemptRaw = localStorage.getItem(`attempt_${attempt.uploadId}`);
        if(savedAttemptRaw) {
             const savedAttempt = JSON.parse(savedAttemptRaw);
             setTime(savedAttempt.timer.remainingSec);
        }
        start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        setAttempt(prev => prev ? {...prev, timer: {...prev.timer, remainingSec: remainingTime}} : null);
    }, [remainingTime, setAttempt]);

    const updateStatus = useCallback((qid: number, newStatus: QuestionStatus) => {
        setAttempt(prev => {
            if (!prev) return null;
            const updatedStatuses = { ...prev.statuses, [qid]: newStatus };
            return { ...prev, statuses: updatedStatuses };
        });
    }, [setAttempt]);

    const handleAnswerChange = (qid: number, answer: string) => {
        setAttempt(prev => {
            if (!prev) return null;
            const updatedAnswers = { ...prev.answers, [qid]: answer };
            const currentStatus = prev.statuses[qid];
            let newStatus = currentStatus;
            
            if (answer) {
                if(currentStatus === QuestionStatus.MarkedForReview || currentStatus === QuestionStatus.AnsweredAndMarked) newStatus = QuestionStatus.AnsweredAndMarked;
                else newStatus = QuestionStatus.Answered;
            } else {
                if(currentStatus === QuestionStatus.AnsweredAndMarked) newStatus = QuestionStatus.MarkedForReview;
                else if(currentStatus !== QuestionStatus.MarkedForReview) newStatus = QuestionStatus.NotAnswered;
            }

            return { ...prev, answers: updatedAnswers, statuses: {...prev.statuses, [qid]: newStatus} };
        });
    };
    
    const handleMarkForReview = () => {
        if (!currentQuestion) return;
        const qid = currentQuestion.qid;
        const currentStatus = attempt.statuses[qid];
        let newStatus: QuestionStatus;
        if (currentStatus === QuestionStatus.MarkedForReview) newStatus = attempt.answers[qid] ? QuestionStatus.Answered : QuestionStatus.NotAnswered;
        else if (currentStatus === QuestionStatus.AnsweredAndMarked) newStatus = QuestionStatus.Answered;
        else newStatus = attempt.answers[qid] ? QuestionStatus.AnsweredAndMarked : QuestionStatus.MarkedForReview;
        updateStatus(qid, newStatus);
    };

    const handleQuestionSelect = (index: number) => {
        if (currentQuestion) {
            const currentStatus = attempt.statuses[currentQuestion.qid];
            if (currentStatus === QuestionStatus.NotVisited) updateStatus(currentQuestion.qid, QuestionStatus.NotAnswered);
        }
        const newQid = questionSet.questions[index].qid;
        if (attempt.statuses[newQid] === QuestionStatus.NotVisited) updateStatus(newQid, QuestionStatus.NotAnswered);
        setCurrentQuestionIndex(index);
    };

    const navigateWithinFilter = (direction: 'next' | 'prev') => {
        const currentFilteredIndex = filteredQuestions.findIndex(q => q.qid === currentQuestion.qid);
        const nextFilteredIndex = direction === 'next' ? currentFilteredIndex + 1 : currentFilteredIndex - 1;

        if (nextFilteredIndex >= 0 && nextFilteredIndex < filteredQuestions.length) {
            const nextQuestionQid = filteredQuestions[nextFilteredIndex].qid;
            const originalIndex = questionSet.questions.findIndex(q => q.qid === nextQuestionQid);
            if(originalIndex !== -1) handleQuestionSelect(originalIndex);
        }
    };
    
    const clearResponse = () => {
        if (currentQuestion) handleAnswerChange(currentQuestion.qid, "");
    };

    if (!currentQuestion) {
        return ( <div className="flex items-center justify-center h-screen"><div className="text-center p-8 bg-surface-dark rounded-lg shadow-xl"><AlertTriangleIcon className="w-12 h-12 mx-auto text-red-500 mb-4" /><h2 className="text-2xl font-semibold text-white">No Questions Found</h2><p className="text-text-secondary-dark mt-2 max-w-sm">The AI parser could not detect any questions. This can happen with very low-quality scans or non-standard document formats.</p><button onClick={onExit} className="mt-6 px-5 py-2.5 bg-brand-primary hover:bg-brand-secondary rounded-md font-semibold transition-colors">Try Another File</button></div></div>);
    }
    
    const showHint = hint?.qid === currentQuestion.qid;

    const currentFilteredIndex = filteredQuestions.findIndex(q => q.qid === currentQuestion.qid);
    const isFirstInFilter = currentFilteredIndex === 0;
    const isLastInFilter = currentFilteredIndex === filteredQuestions.length - 1;

    return (
        <div className="flex flex-col h-screen">
            <header className="flex items-center justify-between p-3 bg-surface-dark border-b border-gray-700 shadow-md sticky top-0 z-20">
                <h1 className="text-lg font-bold truncate pr-4">{questionSet.meta.title}</h1>
                <div className="flex items-center space-x-4">
                    <div className="flex items-center space-x-2 bg-gray-900 px-3 py-1.5 rounded-md">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        <span className="font-mono text-lg font-semibold tracking-wider">
                            {Math.floor(remainingTime / 3600).toString().padStart(2, '0')}:
                            {Math.floor((remainingTime % 3600) / 60).toString().padStart(2, '0')}:
                            {(remainingTime % 60).toString().padStart(2, '0')}
                        </span>
                        <button onClick={togglePause} className="ml-2 text-text-secondary-dark hover:text-white">
                            {isRunning ? <PauseIcon className="w-5 h-5"/> : <PlayIcon className="w-5 h-5"/>}
                        </button>
                    </div>
                    <button onClick={() => setIsSubmitModalOpen(true)} className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-md font-semibold transition-colors">Submit Test</button>
                </div>
            </header>
            
            <div className="flex flex-1 overflow-hidden relative">
                {!isRunning && (
                    <div className="absolute inset-0 bg-black/70 flex flex-col items-center justify-center z-30 backdrop-blur-sm" onClick={togglePause}>
                        <PauseIcon className="w-24 h-24 text-white/50" />
                        <h2 className="text-4xl font-bold text-white/80 mt-4">PAUSED</h2>
                        <p className="text-white/60 mt-2">Click anywhere to resume</p>
                    </div>
                )}
                 {isSubmitModalOpen && (
                    <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-40 backdrop-blur-sm">
                        <div className="bg-surface-dark rounded-lg shadow-xl p-6 w-full max-w-md text-center mx-4">
                            <h2 className="text-2xl font-bold mb-4 text-white">Confirm Submission</h2>
                            <p className="text-text-secondary-dark mb-6">
                                You have answered {Object.values(attempt.answers).filter(a => a && a.trim() !== '').length} out of {questionSet.meta.totalQuestions} questions.
                                <br/>
                                Are you sure you want to end the test?
                            </p>
                            <div className="flex justify-center space-x-4">
                                <button 
                                    onClick={() => setIsSubmitModalOpen(false)}
                                    className="px-6 py-2 bg-gray-600 hover:bg-gray-700 rounded-md font-semibold transition-colors"
                                >
                                    Cancel
                                </button>
                                <button 
                                    onClick={handleConfirmSubmit}
                                    className="px-6 py-2 bg-green-600 hover:bg-green-700 rounded-md font-semibold transition-colors"
                                >
                                    Confirm Submit
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                <main className="flex-1 flex flex-col overflow-y-auto">
                    <div className={`flex-1 grid ${currentPassage ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'} gap-4 p-4`}>
                        {currentPassage && (
                            <div className="bg-surface-dark rounded-lg p-6 overflow-y-auto max-h-[calc(100vh-200px)] prose prose-invert prose-p:text-text-secondary-dark prose-headings:text-white">
                                <h3 className="font-bold text-lg mb-2">{currentPassage.title || "Passage"}</h3>
                                <div className="whitespace-pre-wrap">{currentPassage.text}</div>
                            </div>
                        )}
                        <div className={`bg-surface-dark rounded-lg p-6 overflow-y-auto max-h-[calc(100vh-200px)] ${!currentPassage ? 'col-span-1' : ''}`}>
                             <div className="flex justify-between items-start mb-4">
                                <div>
                                    <h2 className="text-lg font-semibold">Question {currentQuestion.qid}</h2>
                                    {currentQuestion.section && (<span className="text-xs font-medium bg-brand-primary/20 text-brand-accent px-2 py-1 rounded-full">{currentQuestion.section} {currentQuestion.topic && ` - ${currentQuestion.topic}`}</span>)}
                                </div>
                                <button onClick={() => onGetHint(currentQuestion)} disabled={isHintLoading} className="flex items-center space-x-2 px-3 py-1.5 border border-yellow-600 text-yellow-400 hover:bg-yellow-600/20 rounded-md transition-colors disabled:opacity-50 disabled:cursor-wait">
                                    {isHintLoading && hint?.qid !== currentQuestion.qid ? <Spinner className="w-4 h-4" /> : <LightbulbIcon className="w-4 h-4" />}
                                    <span>Hint</span>
                                </button>
                            </div>
                            
                            {showHint && (<div className="bg-yellow-900/50 border border-yellow-700 text-yellow-200 px-4 py-3 rounded-lg mb-4 flex items-start space-x-3"><LightbulbIcon className="w-5 h-5 mt-1 flex-shrink-0" /><p>{hint.text}</p></div>)}

                            {currentQuestion.figureRefs && currentQuestion.figureRefs.length > 0 && (<div className="mb-4 space-y-2 rounded-lg p-2 border border-gray-700 bg-background-dark">{currentQuestion.figureRefs.map((fig, index) => (<img key={index} src={fig.dataUrl} alt={`Figure for question ${currentQuestion.qid}`} className="w-full h-auto rounded-md" />))}</div>)}
                            <div className="mb-4 text-text-secondary-dark whitespace-pre-wrap">{currentQuestion.text}</div>
                            
                            {currentQuestion.qtype === QuestionType.MCQ && (<div className="space-y-3">{currentQuestion.options.map(option => (<label key={option.label} className={`flex items-start p-3 rounded-lg border-2 cursor-pointer transition-colors ${attempt.answers[currentQuestion.qid] === option.label ? 'bg-brand-secondary/30 border-brand-secondary' : 'border-gray-700 hover:border-gray-600'}`}><input type="radio" name={`q_${currentQuestion.qid}`} value={option.label} checked={attempt.answers[currentQuestion.qid] === option.label} onChange={() => handleAnswerChange(currentQuestion.qid, option.label)} className="w-4 h-4 mt-1 text-brand-secondary bg-gray-700 border-gray-600 focus:ring-brand-secondary focus:ring-2" /><span className="ml-3 text-text-primary-dark whitespace-pre-wrap">{option.label}. {option.text}</span></label>))}</div>)}
                             {currentQuestion.qtype === QuestionType.TITA && (<input type="text" value={attempt.answers[currentQuestion.qid] || ''} onChange={(e) => handleAnswerChange(currentQuestion.qid, e.target.value)} placeholder="Type your answer here" className="w-full bg-gray-900 border border-gray-700 rounded-md p-3 focus:ring-2 focus:ring-brand-secondary focus:border-brand-secondary outline-none" />)}
                        </div>
                    </div>
                    <div className="flex items-center justify-between p-3 border-t border-gray-700 sticky bottom-0 bg-surface-dark z-10">
                        <div className="flex space-x-2"><button onClick={handleMarkForReview} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 rounded-md font-semibold transition-colors">Mark for Review</button><button onClick={clearResponse} className="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded-md font-semibold transition-colors">Clear</button></div>
                         <div className="flex space-x-2">
                            <button onClick={() => navigateWithinFilter('prev')} disabled={isFirstInFilter} className="px-4 py-2 bg-brand-primary hover:bg-brand-secondary rounded-md font-semibold transition-colors disabled:bg-gray-700 disabled:cursor-not-allowed">Previous</button>
                            <button onClick={() => navigateWithinFilter('next')} disabled={isLastInFilter} className="px-4 py-2 bg-brand-primary hover:bg-brand-secondary rounded-md font-semibold transition-colors disabled:bg-gray-700 disabled:cursor-not-allowed">Next</button>
                        </div>
                    </div>
                </main>
                
                <aside className="w-80 bg-surface-dark border-l border-gray-700 overflow-y-auto p-4 flex flex-col">
                    <QuestionNavigator
                        questions={questionSet.questions}
                        statuses={attempt.statuses}
                        currentIndex={currentQuestionIndex}
                        onSelect={handleQuestionSelect}
                        sections={sections}
                        currentSection={currentSection}
                        onSectionChange={setCurrentSection}
                    />
                </aside>
            </div>
        </div>
    );
};

// RESULTS VIEW
const ResultItem: React.FC<{ question: Question, userAnswer?: string }> = ({ question, userAnswer }) => {
    const isAnswered = userAnswer && userAnswer.trim() !== '';
    const isCorrect = isAnswered && question.answerKey && userAnswer.trim().toLowerCase() === question.answerKey.toLowerCase();
    
    let statusClasses = '';
    let statusIcon: React.ReactNode = null;

    if (isAnswered) {
        if(isCorrect) {
            statusClasses = 'border-l-4 border-status-answered bg-green-900/20';
            statusIcon = <CheckCircleIcon className="w-6 h-6 text-status-answered" />;
        } else {
            statusClasses = 'border-l-4 border-status-not-answered bg-red-900/20';
            statusIcon = <XCircleIcon className="w-6 h-6 text-status-not-answered" />;
        }
    } else {
         statusClasses = 'border-l-4 border-gray-600';
    }


    return (
        <div className={`p-4 rounded-lg bg-background-dark ${statusClasses}`}>
            <div className="flex justify-between items-start">
                <p className="font-semibold text-text-primary-dark mb-2">Q{question.qid}: <span className="text-text-secondary-dark whitespace-pre-wrap">{question.text}</span></p>
                {statusIcon}
            </div>
            {question.qtype === QuestionType.MCQ && (
                 <div className="space-y-1 text-sm mt-2">
                    {question.options.map(opt => {
                        const isUserChoice = userAnswer === opt.label;
                        const isCorrectChoice = question.answerKey === opt.label;
                        let optionClass = 'text-text-secondary-dark';
                        if (isUserChoice && !isCorrectChoice) optionClass = 'text-red-400 line-through';
                        if (isCorrectChoice) optionClass = 'text-green-400 font-semibold';

                        return <p key={opt.label} className={optionClass}>({opt.label}) {opt.text}</p>
                    })}
                </div>
            )}
            <div className="mt-3 pt-3 border-t border-gray-700/50 text-sm">
                <p><span className="font-semibold text-gray-400">Your Answer: </span><span className={isCorrect ? 'text-green-400' : 'text-red-400'}>{isAnswered ? userAnswer : 'Not Answered'}</span></p>
                {question.answerKey && <p><span className="font-semibold text-gray-400">Correct Answer: </span><span className="text-green-400">{question.answerKey}</span></p>}
            </div>
        </div>
    );
};


const ResultsView: React.FC<{ attempt: Attempt; questionSet: QuestionSet }> = ({ attempt, questionSet }) => {
    const score = attempt.score!;
    const hasAnswerKey = questionSet.questions.some(q => q.answerKey);

    return (
        <div className="min-h-screen p-4 sm:p-6 flex justify-center">
            <div className="w-full max-w-4xl">
                <div className="bg-surface-dark rounded-xl shadow-2xl p-6 sm:p-8">
                    <div className="text-center border-b border-gray-700 pb-6 mb-6">
                        <CheckCircleIcon className="w-16 h-16 text-green-500 mx-auto mb-4" />
                        <h1 className="text-3xl sm:text-4xl font-bold text-white">Test Submitted!</h1>
                        <p className="text-lg text-text-secondary-dark mt-2">{questionSet.meta.title}</p>
                    </div>
                    
                    <div className="text-center mb-8">
                        <h2 className="text-xl font-semibold text-brand-accent mb-2">Your Score</h2>
                        <p className="text-6xl font-bold text-white">{score.raw}</p>
                    </div>
                    
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center mb-8">
                        <div className="bg-background-dark p-4 rounded-lg"><p className="text-sm text-text-secondary-dark">Answered</p><p className="text-2xl font-bold">{score.totalAnswered} / {questionSet.meta.totalQuestions}</p></div>
                        <div className="bg-background-dark p-4 rounded-lg"><p className="text-sm text-status-answered">MCQ Correct</p><p className="text-2xl font-bold">{score.mcqCorrect}</p></div>
                        <div className="bg-background-dark p-4 rounded-lg"><p className="text-sm text-status-not-answered">MCQ Wrong</p><p className="text-2xl font-bold">{score.mcqWrong}</p></div>
                        <div className="bg-background-dark p-4 rounded-lg"><p className="text-sm text-blue-400">TITA Correct</p><p className="text-2xl font-bold">{score.titaCorrect}</p></div>
                    </div>

                    {hasAnswerKey && (
                        <div className="mt-8">
                            <h3 className="text-2xl font-bold text-center mb-4">Answer Review</h3>
                            <div className="space-y-4 max-h-[50vh] overflow-y-auto p-4 bg-background-dark/50 rounded-lg">
                                {questionSet.questions.map(q => (
                                    <ResultItem key={q.qid} question={q} userAnswer={attempt.answers[q.qid]} />
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="mt-8 text-center">
                        <button 
                            onClick={() => window.location.reload()}
                            className="px-6 py-3 bg-brand-primary hover:bg-brand-secondary rounded-md font-semibold transition-colors"
                        >
                            Take Another Test
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};


export default App;