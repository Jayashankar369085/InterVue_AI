import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ArrowLeft, CheckCircle2, XCircle, TrendingUp } from "lucide-react";

export default function ResultsPage() {
  return (
    <main className="flex-1 container max-w-4xl mx-auto px-4 py-12 space-y-8">
      <div className="flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Interview Report</h1>
          <p className="text-muted-foreground">ML Engineer Internship at Automotive Startup</p>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        <Card className="md:col-span-1 bg-black/40 border-white/10 flex flex-col items-center justify-center py-8 text-center">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg text-muted-foreground">Overall Readiness</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-6xl font-black text-primary">78<span className="text-3xl text-primary/50">%</span></div>
          </CardContent>
        </Card>
        
        <Card className="md:col-span-2 bg-black/40 border-white/10">
          <CardHeader>
            <CardTitle>Competencies</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>Technical Knowledge</span>
                <span className="font-medium">81%</span>
              </div>
              <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-blue-500 w-[81%]" />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>Problem Solving</span>
                <span className="font-medium">74%</span>
              </div>
              <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-yellow-500 w-[74%]" />
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>Communication</span>
                <span className="font-medium">86%</span>
              </div>
              <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                <div className="h-full bg-green-500 w-[86%]" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card className="bg-black/40 border-green-500/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-500">
              <CheckCircle2 className="w-5 h-5" />
              Strengths
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 shrink-0"/> Clear explanations of complex topics</li>
              <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 shrink-0"/> Strong fundamentals in Machine Learning</li>
              <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-green-500 mt-1.5 shrink-0"/> Good communication and structuring of answers</li>
            </ul>
          </CardContent>
        </Card>

        <Card className="bg-black/40 border-destructive/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <XCircle className="w-5 h-5" />
              Needs Improvement
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm">
              <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-destructive mt-1.5 shrink-0"/> Model deployment in cloud environments</li>
              <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-destructive mt-1.5 shrink-0"/> Advanced statistical concepts</li>
              <li className="flex gap-2"><div className="w-1.5 h-1.5 rounded-full bg-destructive mt-1.5 shrink-0"/> System design at scale</li>
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-black/40 border-white/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            Recommended Practice
          </CardTitle>
          <CardDescription>Focus on these areas before your real interview.</CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="list-decimal list-inside space-y-2 text-sm text-muted-foreground">
            <li><span className="text-foreground">Cloud deployment strategies</span> — Practice deploying ML models using Docker on AWS/GCP.</li>
            <li><span className="text-foreground">Model evaluation metrics</span> — Deep dive into when to use AUC-ROC vs F1-Score for imbalanced datasets.</li>
            <li><span className="text-foreground">System design fundamentals</span> — Review data ingestion pipelines and serving infrastructure.</li>
          </ol>
        </CardContent>
      </Card>
      
      <div className="flex justify-center pt-4">
        <Link href="/setup">
          <Button size="lg">Practice Again</Button>
        </Link>
      </div>
    </main>
  );
}
