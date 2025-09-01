import { GoogleGenAI, Type } from "@google/genai";
import type { Question, QuestionSet } from "../types";

// TypeScript declarations for the pdf.js library loaded from CDN
declare const pdfjsLib: any;

// --- AI Client Initialization ---
let ai: GoogleGenAI | null = null;
const getGenAIClient = () => {
  if (!process.env.API_KEY) {
    throw new Error(
      "The API_KEY environment variable must be set for the AI service."
    );
  }
  if (!ai) {
    ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }
  return ai;
};

// --- Gemini Response Schema ---
const responseSchema = {
  type: Type.OBJECT,
  properties: {
    meta: {
      type: Type.OBJECT,
      properties: {
        title: {
          type: Type.STRING,
          description: "Inferred title of the exam paper, e.g., 'CAT 2023 Slot 1'.",
        },
        year: {
          type: Type.INTEGER,
          description: "Inferred year of the exam paper.",
          nullable: true,
        },
      },
      required: ["title"],
    },
    passages: {
      type: Type.ARRAY,
      description: "List of all reading comprehension passages.",
      items: {
        type: Type.OBJECT,
        properties: {
          passageId: { type: Type.INTEGER, description: "Unique sequential ID for the passage, starting from 1." },
          text: { type: Type.STRING, description: "The full text of the passage." },
        },
        required: ["passageId", "text"],
      },
    },
    questions: {
      type: Type.ARRAY,
      description: "List of all questions parsed from the paper.",
      items: {
        type: Type.OBJECT,
        properties: {
          qid: { type: Type.INTEGER, description: "Unique sequential ID for the question, starting from 1." },
          text: { type: Type.STRING, description: "The full text of the question stem." },
          qtype: { type: Type.STRING, enum: ["MCQ", "TITA"], description: "'MCQ' for multiple choice, 'TITA' for type-in-the-answer." },
          section: { type: Type.STRING, description: "The exam section (e.g., 'VARC', 'DILR', 'QA').", nullable: true },
          topic: { type: Type.STRING, description: "The specific topic of the question (e.g., 'Algebra', 'Para Jumbles').", nullable: true },
          options: {
            type: Type.ARRAY,
            description: "List of options for MCQ questions. Empty for TITA questions.",
            items: {
              type: Type.OBJECT,
              properties: {
                label: { type: Type.STRING, description: "The option label (e.g., 'A', 'B')." },
                text: { type: Type.STRING, description: "The full text of the option." },
              },
              required: ["label", "text"],
            },
          },
          answerKey: { type: Type.STRING, description: "The label of the correct option (e.g., 'B'). Null if not available.", nullable: true },
          passageId: { type: Type.INTEGER, description: "The ID of the associated passage, if any. Null otherwise.", nullable: true },
          figureRefs: {
            type: Type.ARRAY,
            description: "A list of figures, charts, or tables associated with the question.",
            items: {
                type: Type.OBJECT,
                properties: {
                    pageIndex: { type: Type.INTEGER, description: "The 0-based index of the page image where the figure is located." },
                    boundingBox: {
                        type: Type.OBJECT,
                        description: "The bounding box of the figure in pixels.",
                        properties: {
                            x1: { type: Type.NUMBER, description: "Top-left x-coordinate in pixels." },
                            y1: { type: Type.NUMBER, description: "Top-left y-coordinate in pixels." },
                            width: { type: Type.NUMBER, description: "Width of the box in pixels." },
                            height: { type: Type.NUMBER, description: "Height of the box in pixels." },
                        },
                        required: ["x1", "y1", "width", "height"],
                    },
                    caption: { type: Type.STRING, description: "A caption for the figure, if any.", nullable: true },
                },
                required: ["pageIndex", "boundingBox"],
            }
          }
        },
        required: ["qid", "text", "qtype", "options"],
      },
    },
  },
  required: ["meta", "passages", "questions"],
};

// --- PDF Parsing with Multimodal AI ---
const buildParsingPrompt = (): string => {
  return `You are an expert AI system designed to deconstruct CAT (Common Admission Test) exam papers from a series of page images. Your task is to perform a structural analysis of the provided images and generate a structured JSON output that strictly adheres to the provided schema. This is a transformation task, not a recitation task.

Follow these analytical rules precisely:
1.  **Analyze Holistically:** Examine all page images to infer the document's logical structure, including columns, sections, passages, figures, and questions.
2.  **Deconstruct Questions & Infer Type:** Identify all numbered questions (e.g., '1.', 'Q1.'). Classify each as 'MCQ' if options (A, B, C, D) are present, otherwise infer it is 'TITA'.
3.  **Infer Section and Topic:** Based on the question's content and its position in the document, infer its exam section ('VARC', 'DILR', or 'QA') and a specific topic (e.g., 'Geometry', 'Reading Comprehension').
4.  **Identify and Group Passages:** Identify long text blocks that are followed by related questions. Group these into passages and assign a sequential \`passageId\`.
5.  **Locate Figures:** If a question's text references a 'chart', 'graph', 'table', or 'figure', you MUST locate its position on the page. For each identified figure, provide its 0-based \`pageIndex\` and its pixel-based \`boundingBox\` (x1, y1, width, height) relative to the source page image dimensions. Only identify figures that are explicitly referenced.
6.  **Assign Sequential IDs:** Assign a unique, sequential \`qid\` (starting from 1) to every identified question.
7.  **Answer Key Analysis:** Only include an answer key if an official answer key section is explicitly present within the document. Otherwise, the \`answerKey\` must be \`null\`.
8.  **Strict JSON Output:** Your entire output must be a single, valid JSON object conforming to the provided schema. Do not include any explanations, apologies, or text outside of the JSON structure.`;
};

/**
 * Converts each page of a PDF file into a base64 encoded PNG image.
 */
const convertPdfToImages = async (file: File, onProgress: (message: string) => void): Promise<string[]> => {
    const fileReader = new FileReader();
    return new Promise((resolve, reject) => {
        fileReader.onload = async () => {
            try {
                if (!fileReader.result) return reject(new Error("Failed to read file."));

                pdfjsLib.GlobalWorkerOptions.workerSrc = (window as any).pdfjsWorker;
                const typedarray = new Uint8Array(fileReader.result as ArrayBuffer);
                const pdf = await pdfjsLib.getDocument(typedarray).promise;
                
                const imagePromises: Promise<string>[] = [];
                for (let i = 1; i <= pdf.numPages; i++) {
                    onProgress(`Converting page ${i} of ${pdf.numPages} to image...`);
                    const page = await pdf.getPage(i);
                    const viewport = page.getViewport({ scale: 1.5 });
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    if (!context) throw new Error('Could not get canvas context');

                    canvas.height = viewport.height;
                    canvas.width = viewport.width;

                    await page.render({ canvasContext: context, viewport: viewport }).promise;
                    const base64Data = canvas.toDataURL('image/png').split(',')[1];
                    imagePromises.push(Promise.resolve(base64Data));
                }
                const base64Images = await Promise.all(imagePromises);
                resolve(base64Images);
            } catch (error) {
                reject(error);
            }
        };
        fileReader.onerror = reject;
        fileReader.readAsArrayBuffer(file);
    });
};

/**
 * Processes questions with figure references, cropping the figures from page images.
 */
const extractAndCropFigures = async (
    questions: any[], 
    pageImagesBase64: string[],
    onProgress: (message: string) => void
): Promise<any[]> => {
    onProgress("Extracting figures from pages...");
    const processedQuestions = await Promise.all(questions.map(async (q) => {
        if (!q.figureRefs || q.figureRefs.length === 0) {
            return q;
        }

        const croppedFigureRefs = await Promise.all(q.figureRefs.map(async (ref: any) => {
            const { pageIndex, boundingBox, caption } = ref;
            if (pageIndex >= pageImagesBase64.length) {
                console.error(`Invalid page index ${pageIndex} for figure.`);
                return null;
            }

            const pageImageSrc = `data:image/png;base64,${pageImagesBase64[pageIndex]}`;
            const image = new Image();
            image.src = pageImageSrc;
            await new Promise(resolve => image.onload = resolve);
            
            const PADDING = 10;
            const { x1, y1, width, height } = boundingBox;
            const imageWidth = image.width;
            const imageHeight = image.height;
            
            const paddedX1 = Math.max(0, x1 - PADDING);
            const paddedY1 = Math.max(0, y1 - PADDING);
            const paddedWidth = Math.min(imageWidth - paddedX1, width + 2 * PADDING);
            const paddedHeight = Math.min(imageHeight - paddedY1, height + 2 * PADDING);

            const canvas = document.createElement('canvas');
            canvas.width = paddedWidth;
            canvas.height = paddedHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;

            ctx.drawImage(
                image,
                paddedX1, paddedY1, paddedWidth, paddedHeight,
                0, 0, paddedWidth, paddedHeight
            );
            
            return { dataUrl: canvas.toDataURL('image/png'), caption };
        }));

        return { ...q, figureRefs: croppedFigureRefs.filter(Boolean) };
    }));
    return processedQuestions;
};

export const parsePdfWithGemini = async (file: File, onProgress: (message: string) => void): Promise<QuestionSet> => {
  const aiClient = getGenAIClient();
  
  const pageImagesBase64 = await convertPdfToImages(file, onProgress);
  onProgress("All pages converted. Preparing AI request...");

  const textPrompt = buildParsingPrompt();
  const imageParts = pageImagesBase64.map(data => ({
      inlineData: { mimeType: 'image/png', data }
  }));

  const contents = { parts: [{ text: textPrompt }, ...imageParts] };

  onProgress("Sending document to AI for analysis...");
  const response = await aiClient.models.generateContent({
    model: "gemini-2.5-flash",
    contents: contents,
    config: {
      responseMimeType: "application/json",
      responseSchema: responseSchema,
    },
  });

  onProgress("AI analysis complete. Processing results...");
  
  if (!response || !response.text) {
    let reason = "The AI returned an empty or invalid response.";
    const finishReason = response?.candidates?.[0]?.finishReason;
    const safetyRatings = response?.candidates?.[0]?.safetyRatings;

    if (finishReason && finishReason !== 'STOP') {
      reason = `AI processing was blocked. Reason: ${finishReason}.`;
    } else if (safetyRatings && safetyRatings.some(r => r.blocked)) {
        const blockedCategories = safetyRatings
            .filter(r => r.blocked)
            .map(r => r.category)
            .join(', ');
        reason = `AI processing was blocked for safety reasons related to: ${blockedCategories}.`;
    } else if (!response?.candidates?.length || !response.candidates[0].content?.parts?.length) {
        reason = "The AI could not extract any content from the document. It may be a protected, empty, or unreadable PDF.";
    }
    
    throw new Error(reason);
  }

  const jsonText = response.text.trim();
  const parsedData = JSON.parse(jsonText);
  console.log("Parsed data from Gemini:", parsedData);

  const questionsWithFigures = await extractAndCropFigures(parsedData.questions, pageImagesBase64, onProgress);

  onProgress("Finalizing exam...");
  const finalQuestionSet: QuestionSet = {
    meta: {
      title: parsedData.meta.title || file.name,
      year: parsedData.meta.year,
      status: "ready",
      totalQuestions: questionsWithFigures.length,
      totalPassages: parsedData.passages.length,
      marking: {
        mcq: { correct: 3, wrong: -1 },
        tita: { correct: 3, wrong: 0 },
      },
    },
    passages: parsedData.passages.map((p: any) => ({
      ...p,
      pageSpan: [0, 0], 
    })),
    questions: questionsWithFigures,
  };

  console.log("Final constructed QuestionSet:", finalQuestionSet);
  return finalQuestionSet;
};


export const getHintForQuestion = async (question: Question): Promise<string> => {
  const aiClient = getGenAIClient();
  const prompt = `The user is solving the following CAT exam question:
---
Question: "${question.text}"
${
  question.qtype === "MCQ"
    ? `Options: ${question.options.map((o) => `(${o.label}) ${o.text}`).join(", ")}`
    : ""
}
---
Provide a subtle, one-sentence hint to guide the user towards the correct approach. Do not give away the answer. For example, if it's a math problem, suggest a relevant formula or concept. If it's a reading comprehension question, point to a specific part of the passage to re-read. The hint should be encouraging and brief.`;

  const response = await aiClient.models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
  });

  if (!response || !response.text) {
      return "Could not generate a hint at this time.";
  }

  return response.text.trim();
};
