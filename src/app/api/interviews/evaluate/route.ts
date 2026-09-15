import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { EVALUATOR_SYSTEM_PROMPT } from "@/lib/prompts";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { transcript, previousQuestions, blueprint, challenge } = body;

    const apiKey = process.env.LLM_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({
        evaluation: {
          overall_score: 80,
          recommended_action: "ASK_FOLLOW_UP",
          next_question_text: "Mocked fallback next question: Can you tell me more about that?"
        }
      });
    }

    const ai = new GoogleGenAI({ apiKey });
    
    const userPrompt = `
      Interview Blueprint:
      ${JSON.stringify(blueprint)}

      Previous Conversation:
      ${JSON.stringify(previousQuestions)}

      Candidate's Latest Answer:
      "${transcript}"
      
      Did the candidate ask to be challenged? ${challenge ? "YES" : "NO"}
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        { role: 'user', parts: [{ text: userPrompt }] }
      ],
      config: {
        systemInstruction: EVALUATOR_SYSTEM_PROMPT,
        responseMimeType: "application/json",
      }
    });

    const outputText = response.text;
    if (!outputText) {
      throw new Error("No response from LLM");
    }

    const evaluation = JSON.parse(outputText);

    return NextResponse.json({ evaluation });
  } catch (error) {
    console.error("Error evaluating answer:", error);
    return NextResponse.json({ error: "Failed to evaluate answer" }, { status: 500 });
  }
}
