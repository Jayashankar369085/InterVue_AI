"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Upload, ArrowRight, Loader2 } from "lucide-react";

function SetupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    
    try {
      const formData = new FormData(e.currentTarget);
      const data = Object.fromEntries(formData.entries());
      
      const res = await fetch("/api/interviews/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      });
      
      if (!res.ok) throw new Error("Failed to generate plan");
      
      const result = await res.json();
      router.push(`/interview/${result.id}`);
    } catch (error) {
      console.error(error);
      alert("Failed to start interview. Please try again.");
      setLoading(false);
    }
  };

  return (
    <Card className="max-w-2xl mx-auto border-white/10 bg-black/40 backdrop-blur-xl">
      <form onSubmit={handleSubmit}>
        <CardHeader>
          <CardTitle className="text-2xl">Configure Your Interview</CardTitle>
          <CardDescription>
            Tell us what you&apos;re preparing for, and we&apos;ll adapt the interview accordingly.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="role">What are you preparing for?</Label>
            <Input 
              id="role" 
              name="role" 
              placeholder="e.g., ML Engineer at an automotive company" 
              defaultValue={initialQuery}
              required 
              className="bg-black/50"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <Label htmlFor="experience">Experience Level</Label>
              <Select name="experience" defaultValue="fresher">
                <SelectTrigger className="bg-black/50">
                  <SelectValue placeholder="Select experience" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fresher">Student / Fresher</SelectItem>
                  <SelectItem value="1-3">1-3 years</SelectItem>
                  <SelectItem value="3-5">3-5 years</SelectItem>
                  <SelectItem value="5+">5+ years</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="style">Interview Style</Label>
              <Select name="style" defaultValue="realistic">
                <SelectTrigger className="bg-black/50">
                  <SelectValue placeholder="Select style" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="practice">Practice (Friendly)</SelectItem>
                  <SelectItem value="realistic">Realistic</SelectItem>
                  <SelectItem value="difficult">Difficult</SelectItem>
                  <SelectItem value="stress">Stress Interview</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="length">Interview Length</Label>
              <Select name="length" defaultValue="standard">
                <SelectTrigger className="bg-black/50">
                  <SelectValue placeholder="Select length" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="quick">Quick (5 questions)</SelectItem>
                  <SelectItem value="standard">Standard (10 questions)</SelectItem>
                  <SelectItem value="deep">Deep (15+ questions)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="company">Company (Optional)</Label>
              <Input 
                id="company" 
                name="company" 
                placeholder="e.g., Google, Tesla" 
                className="bg-black/50"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-white/5 space-y-4">
            <h3 className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">Optional Context</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="border border-dashed border-white/20 rounded-xl p-6 flex flex-col items-center justify-center text-center space-y-2 bg-black/20 hover:bg-white/5 transition-colors cursor-pointer">
                <Upload className="w-6 h-6 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">Upload Resume</p>
                  <p className="text-xs text-muted-foreground">PDF or DOCX</p>
                </div>
              </div>
              <div className="border border-dashed border-white/20 rounded-xl p-6 flex flex-col items-center justify-center text-center space-y-2 bg-black/20 hover:bg-white/5 transition-colors cursor-pointer">
                <Upload className="w-6 h-6 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">Upload Job Description</p>
                  <p className="text-xs text-muted-foreground">PDF or DOCX</p>
                </div>
              </div>
            </div>
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" size="lg" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Preparing Interview...
              </>
            ) : (
              <>
                Generate Interview Blueprint <ArrowRight className="ml-2 w-5 h-5" />
              </>
            )}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

export default function SetupPage() {
  return (
    <main className="flex-1 container max-w-6xl mx-auto px-4 py-12">
      <Suspense fallback={<div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-primary" /></div>}>
        <SetupForm />
      </Suspense>
    </main>
  );
}
