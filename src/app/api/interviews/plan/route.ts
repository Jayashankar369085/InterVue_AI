import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { PLANNER_SYSTEM_PROMPT } from "@/lib/prompts";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { role, experience, style, length, company } = body;

    const apiKey = process.env.LLM_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      // Mock mode fallback if no API key is set
      return NextResponse.json({
        id: "mock-123",
        blueprint: {
          role: role || "Software Engineer",
          domain: "Technology",
          seniority: experience || "Fresher",
          interview_style: style || "Realistic",
          competencies: [
            { name: "Fundamentals", weight: 8, priority: "High" },
            { name: "Problem Solving", weight: 9, priority: "High" },
            { name: "Communication", weight: 7, priority: "Medium" }
          ],
          question_count: length === "quick" ? 5 : length === "deep" ? 15 : 10,
          difficulty: "Medium",
          question_types: ["Conceptual", "Behavioral"]
        }
      });
    }

    const ai = new GoogleGenAI({ apiKey });
    
    const userPrompt = `
      Create an interview blueprint for the following request:
      Role / Request: ${role}
      Experience Level: ${experience}
      Interview Style: ${style}
      Length: ${length}
      Company Context: ${company || "Not specified"}
    `;

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        { role: 'user', parts: [{ text: userPrompt }] }
      ],
      config: {
        systemInstruction: PLANNER_SYSTEM_PROMPT,
        responseMimeType: "application/json",
      }
    });

    const outputText = response.text;
    if (!outputText) {
      throw new Error("No response from LLM");
    }

    const blueprint = JSON.parse(outputText);
    
    // In a real app we'd save this to Supabase and return the real ID.
    // For now we'll just return a random ID.
    const mockId = Math.random().toString(36).substring(7);

    return NextResponse.json({
      id: mockId,
      blueprint
    });
  } catch (error) {
    console.error("Error generating interview plan:", error);
    return NextResponse.json({ error: "Failed to generate interview plan" }, { status: 500 });
  }
}
