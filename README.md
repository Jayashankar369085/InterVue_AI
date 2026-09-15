# InterVue AI

**"Your AI interviewer for any role, any domain."**

InterVue AI is an adaptive, real-time voice interview platform. It goes beyond a simple list of hardcoded questions by dynamically analyzing the candidate's speech, determining their proficiency, and adapting follow-up questions to test their boundaries—just like a real human interviewer.

## Features

- **Voice First**: Built with the AssemblyAI Voice Agent API for ultra-low latency real-time interactions.
- **Adaptive Questioning**: Uses a custom LLM Evaluation Engine to assess the last response and determine if it should ask a follow-up, increase difficulty, or move to a new topic.
- **Any Domain**: Simply say "I'm preparing for an ML Engineer role" and it intelligently builds an interview blueprint on the fly.
- **"Challenge My Answer"**: An intentional feature where the AI probes deep into the candidate's logical assumptions under pressure.
- **Detailed Reports**: Post-interview analytics displaying competency scores, strengths, and weaknesses.

## Architecture

1. **Frontend**: Next.js App Router, Tailwind CSS, shadcn/ui.
2. **Backend**: Next.js Serverless API Routes.
3. **Voice**: AssemblyAI Voice Agent API integration (using short-lived tokens generated on the backend).
4. **LLM Engine**: Google Gemini LLM SDK processing adaptive reasoning.
5. **Database**: Supabase (PostgreSQL) for state management and reports.

## Local Setup

1. **Clone & Install**
   ```bash
   npm install
   ```

2. **Environment Variables**
   Copy `.env.local.example` to `.env.local` and add your keys:
   ```env
   ASSEMBLYAI_API_KEY=your_key_here
   LLM_API_KEY=your_gemini_key_here
   NEXT_PUBLIC_DEMO_MODE=true
   ```

3. **Run Development Server**
   ```bash
   npm run dev
   ```

4. **Open in Browser**
   Navigate to `http://localhost:3000`

## Demo Flow (Hackathon)

1. Navigate to `/`
2. Enter "I'm preparing for an ML Engineer internship at an automotive company."
3. (Optional) Upload a mock resume and JD.
4. Click **Generate Interview Blueprint**.
5. Experience the real-time Voice UI where the AI probes your technical knowledge.
6. Intentionally give a weak answer to see the AI adapt.
7. Click **"Challenge My Answer"** for a difficult scenario.
8. End the interview to view the generated readiness report.
