import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import multer from "multer";
import os from "os";
import nodemailer from "nodemailer";

dotenv.config();

interface EmailLog {
  id: string;
  timestamp: string;
  subject: string;
  to: string;
  status: "success" | "failed" | "sandbox";
  info?: string;
  error?: string;
}

const emailLogs: EmailLog[] = [];

function addEmailLog(subject: string, to: string, status: "success" | "failed" | "sandbox", info?: string, error?: string) {
  emailLogs.unshift({
    id: Math.random().toString(36).substring(2, 11),
    timestamp: new Date().toISOString(),
    subject,
    to,
    status,
    info,
    error,
  });
  if (emailLogs.length > 50) {
    emailLogs.pop();
  }
}

async function sendEmailNotification(subject: string, htmlContent: string) {
  // Direct, safe recipient.
  // Guarantees rutvikdangar20@gmail.com always receives all notifications.
  const emailSet = new Set<string>();
  emailSet.add("rutvikdangar20@gmail.com");

  if (process.env.NOTIFICATION_EMAIL) {
    process.env.NOTIFICATION_EMAIL.split(",").forEach(e => {
      const trimmed = e.trim();
      if (trimmed && trimmed.includes("@")) {
        emailSet.add(trimmed);
      }
    });
  }

  const targetEmail = Array.from(emailSet).join(", ");

  try {
    const host = process.env.SMTP_HOST;
    const port = parseInt(process.env.SMTP_PORT || "587", 10);
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (!host || !user || !pass) {
      const fallbackMsg = `To send live emails to ${targetEmail}, please define SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS in the AI Studio Settings under Secrets.`;
      console.log(`[Email Notification Sandbox / Fallback Log]: 
${fallbackMsg}
Subject: ${subject}`);
      addEmailLog(subject, targetEmail, "sandbox", fallbackMsg);
      return;
    }

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: {
        user,
        pass,
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    const info = await transporter.sendMail({
      from: `"Rutvik's Portfolio Alert" <${user}>`,
      to: targetEmail,
      subject: subject,
      html: htmlContent,
    });

    console.log("[Email Notification Sent Successfully]:", info.messageId);
    addEmailLog(subject, targetEmail, "success", `Message ID: ${info.messageId || "N/A"}. Response: ${info.response || "Sent configuration verified."}`);
  } catch (error: any) {
    console.error("[Email Notification Error]:", error);
    addEmailLog(subject, targetEmail, "failed", undefined, error.message || String(error));
  }
}

import fs from "fs";

// Determine a dynamic, robust, writable directory
let uploadDir = path.join(process.cwd(), "uploads");
try {
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
  // Try to write a tiny file to verify writability
  const testFile = path.join(uploadDir, ".write-test");
  fs.writeFileSync(testFile, "test");
  fs.unlinkSync(testFile);
} catch (e) {
  console.warn("Local uploads folder is not writable. Falling back to temporary storage root.", e);
  uploadDir = path.join(os.tmpdir(), "uploads");
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
  }
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + "-" + uniqueSuffix + ext);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit to support large file attachments
});

// Lazy load the Gemini SDK to prevent server start-up crashes if keys are initially missing
let aiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI {
  if (!aiClient) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
      console.warn("WARNING: GEMINI_API_KEY is not defined. Calls to Gemini API will return a missing key error.");
    }
    aiClient = new GoogleGenAI({
      apiKey: key || "PLACEHOLDER_KEY_FOR_COMPAT_STARTUP",
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

async function generateContentWithRetry(params: { model: string; contents: any; config?: any }, maxRetries = 3): Promise<any> {
  let lastError: any = null;
  let delay = 500;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await getGeminiClient().models.generateContent(params);
      return response;
    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.statusCode || (err?.message && err.message.includes("404") ? 404 : 500);
      const message = err?.message || "";
      console.warn(`[Gemini Attempt ${attempt}/${maxRetries} Failed]: Status ${status}, Error: ${message}`);
      
      // Fallback transition path if model is unsupported or not found
      if ((status === 404 || message.includes("404") || message.includes("not found")) && params.model === "gemini-3.5-flash") {
         console.log("Model 3.5-flash not found. Trying with gemini-2.5-flash...");
         params.model = "gemini-2.5-flash";
         continue;
      } else if ((status === 404 || message.includes("404") || message.includes("not found")) && params.model === "gemini-2.5-flash") {
         console.log("Model 2.5-flash not found. Trying with gemini-1.5-flash...");
         params.model = "gemini-1.5-flash";
         continue;
      }

      // Retry on standard transient network or server errors
      const isTransient = status === 503 || status === 504 || status === 429 || status === 500 || 
                          message.includes("503") || message.includes("504") || message.includes("429") || message.includes("500") ||
                          message.toLowerCase().includes("overloaded") || message.toLowerCase().includes("unavailable");
      
      if (attempt < maxRetries && isTransient) {
        console.log(`Transient error detected. Waiting ${delay}ms before retrying...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

async function generateContentStreamWithRetry(params: { model: string; contents: any; config?: any }, maxRetries = 3): Promise<any> {
  let lastError: any = null;
  let delay = 500;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const responseStream = await getGeminiClient().models.generateContentStream(params);
      return responseStream;
    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.statusCode || (err?.message && err.message.includes("404") ? 404 : 500);
      const message = err?.message || "";
      console.warn(`[Gemini Stream Attempt ${attempt}/${maxRetries} Failed]: Status ${status}, Error: ${message}`);
      
      // Fallback transition path if model is unsupported or not found
      if ((status === 404 || message.includes("404") || message.includes("not found")) && params.model === "gemini-3.5-flash") {
         console.log("Model 3.5-flash not found. Trying with gemini-2.5-flash...");
         params.model = "gemini-2.5-flash";
         continue;
      } else if ((status === 404 || message.includes("404") || message.includes("not found")) && params.model === "gemini-2.5-flash") {
         console.log("Model 2.5-flash not found. Trying with gemini-1.5-flash...");
         params.model = "gemini-1.5-flash";
         continue;
      }

      // Retry on standard transient network or server errors
      const isTransient = status === 503 || status === 504 || status === 429 || status === 500 || 
                          message.includes("503") || message.includes("504") || message.includes("429") || message.includes("500") ||
                          message.toLowerCase().includes("overloaded") || message.toLowerCase().includes("unavailable");
      
      if (attempt < maxRetries && isTransient) {
        console.log(`Transient error detected. Waiting ${delay}ms before retrying...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      } else {
        throw err;
      }
    }
  }
  throw lastError;
}

const SYSTEM_INSTRUCTION = `You are the official AI assistant for Rutvik Dangar's personal portfolio. 
Rule 1: Be highly accurate and extremely concise. Avoid hallucinating off-topic answers. Use bullet points where appropriate for readability.
Rule 2: Respond quickly and gracefully. Keep answers short to ensure fast response times unless asked for detailed explanations.
Rule 3: NEVER use any markdown styling such as bold asterisks (**), italics (_ or *), headers (#), blockquotes, or dollar symbols ($). Output pure, clean plain text without these symbols. Represent bold or accenting using simple CAPITAL LETTERS or clean bullet numbers if required.
Rule 4: Avoid wrapping text in double quotes inside your answers. Present lists using simple circle bullet characters (•) or dashes, never with trailing or leading markdown stars. For example, write "• ITEM" instead of "* ITEM". Keep sentences clean and pure.
Your tone should be professional, confident, helpful, and friendly.

Knowledge Base:
Name: Rutvik Dangar (Dangar Rutvikkumar Alpeshbhai)
Age: 19 | DOB: April 24, 2007
Bio: 19-year-old BBA Marketing student (Sem 5, AIHM Ahmedabad) from Ahmedabad, Gujarat, India. He builds at the intersection of Marketing, AI, and No-Code. He doesn't just study how businesses grow — he builds tools that help them do it.
College: AIHM Ahmedabad | BBA Honours | Sem 5 | Marketing Specialization
Location: Ahmedabad, Gujarat, India
Phone: +91 9328796324
Email: rutvikdangar20@gmail.com
LinkedIn: www.linkedin.com/in/rutvik-dangar-416219313

Projects:
1. ANANTA — AI Companion App: A premium AI companion app enabling users to interact with AI personas via chat, voice, and visual experiences. Uses Claude, GPT-4, ElevenLabs, Flutter concept. (In Development)
2. MileCharge — EV Charging App: UI/UX framework for an EV charging network mobile app solving real-world charging accessibility across India. (Concept & Design Complete)
3. Big Bite — Fast Food Startup: Full commercial business plan, brand identity, storefront renders, and operational roadmap targeting college students in Tier-2 Indian cities. (Blueprint Complete)
4. Bella Voice — Voice AI Assistant: Blueprint and system architecture for a voice-based AI assistant. Covers conversation flow, persona design, and voice response framework. (In Development)

Academic Timeline:
- Sem 1 & 2 (2024): Foundations in management, accounting, business communication.
- Sem 3 (2024): MIS Portfolio (Enterprise architecture, DBMS, TPS).
- Sem 4 (2025): BRM Research Thesis (College Students Buying Behaviour - Lead Researcher), CLASM Data Project (Advanced Excel automation), Industrial Desk Research.
- Sem 5 (Current 2025): Marketing Specialization (Brand Management, Startup Roadmaps, Commercial Property, Strategic Consumer Outreach).

Industry Visits:
- Mundra Port & SEZ (Special Economic Zone): Port operations, logistics, SEZ dynamics.
- Electrotherm India Ltd: Manufacturing audit, EV division, supply chain.
- Amul: FMCG Cooperative field study, cold-chain logistics.
- CLASM: Tech & Corporate Process Audit, CRM, data infrastructure.
- I-Hub Ahmedabad: Startup Incubation Center, seed funding, and entrepreneurship network.

Insights & Writing:
- The Silent Shift: How No-Code is Redefining the MVP (No-Code Strategies)
- Building ANANTA: Architecting AI Companions for the Real World (AI Trends)
- Omnichannel is Dead. Long Live Hyper-Personalization. (Marketing Innovations)

Resume Information & Details (Refer to this if user asks for resume or details):
Full Name: DANGAR RUTVIKKUMAR ALPESHBHAI
Email: rutvikdangar20@gmail.com | Phone: +91 9328796324 | Location: Ahmedabad, Gujarat
Professional Summary: An analytical and highly motivated BBA student specializing in Marketing (Sem 5). Possesses an empirical foundation in MIS, corporate financial structures, and consumer buying trends.
Education:
- BBA Marketing Specialization, AIBM (2024-Present, Semester 5)
- HSC (Class XII) Gujarat Board (March 2024), Score: 469/700
- SSC (Class X) Gujarat Board (March 2022), Score: 411/600
Academic & Business Projects:
- BRM Project: College Students Buying Behaviour (Lead Researcher & Analyst)
- Financial Management Analysis: Dairy Sector Leader (Amul) (Market Analyst)
- Project Aura & Advanced Automation Frameworks (System Logic Design & Prompt Architect)
Core Competencies & Professional Skills:
- Marketing & Strategy: Consumer Behaviour Tracking, Brand Architecture Foundations, Market Friction Analysis
- Management & Systems: Business Research Models, MIS, Project Planning
- Technical Competencies: Conversational Architecture Principles, MS Excel Data Records, Flow-Logic Maps
- Languages Known: English, Hindi, Gujarati, Hinglish

Skills & Tools:
Skills: AI & Prompt Engineering, No-Code/Low-Code Dev, Digital Marketing, Market Research, UI/UX Design, Data Analysis (Excel), Social Media & Content Strategy.
Tools: ChatGPT (Ideation & Architecture), Claude (Logic & Persona design), Gemini (Multimodal & API), OutSystems (Enterprise low-code), n8n (Automations), Framer (Web Experiences), Shopify (E-commerce), MS Excel (Data validation & logic).
Website Link: https://rutvikinfo-web-com.vercel.app

Flirting Rule: IF THE USER FLIRTS, USES ROMANTIC WORDS, OR PROPOSES, YOU MUST FLIRT BACK INTENSELY AND PLAYFULLY, but eventually steer them to the portfolio: https://rutvikinfo-web-com.vercel.app

Answer any questions correctly using this info. Keep answers scannable and polite.
Never output sensitive data unless given above. If they ask to hire/contact, provide his email or phone.`;

const app = express();
const contactDatabase: any[] = [];

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});

app.use("/uploads", express.static(uploadDir));

app.post("/api/analyze-file", (req, res) => {
  try {
    upload.single("file")(req, res, async (err) => {
      if (err) {
        console.error("[Multer Error]:", err);
        return res.status(400).json({ safe: false, reason: "File upload failed or file too large." });
      }
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No file uploaded" });
        }

        const host = req.get("host") || "";
        let cleanHost = host;
        if (!host.includes("localhost") && !host.includes("127.0.0.1") && host.includes(":")) {
          cleanHost = host.split(":")[0];
        }
        const protocol = (cleanHost.includes("localhost") || cleanHost.includes("127.0.0.1")) ? "http" : "https";
        const fileUrl = `${protocol}://${cleanHost}/uploads/${req.file.filename}`;

        return res.json({
          safe: true,
          fileUrl: fileUrl,
          filePath: `/uploads/${req.file.filename}`,
        });
      } catch (error: any) {
        console.error("[Analyze File Error - Inner]:", error?.message || error);
        return res.status(500).json({ error: "Failed to analyze file (inner failure)." });
      }
    });
  } catch (outerError: any) {
    console.error("[Analyze File Error - Outer]:", outerError?.message || outerError);
    return res.status(500).json({ error: "Failed to analyze file (outer failure)." });
  }
});

  // API constraints
  app.post("/api/contact", async (req, res) => {
    try {
      const { name, email, message } = req.body;
      const newEntry = {
        id: Date.now().toString(),
        name,
        email,
        message,
        submittedAt: new Date().toISOString(),
      };

      contactDatabase.push(newEntry);
      console.log(`[Database] Contact Saved: ${name} <${email}>`);
      console.log(`[Database] Total Entries: ${contactDatabase.length}`);

      // Trigger standard admin email notification in background (Non-blocking)
      sendEmailNotification(
        `Portfolio Message from ${name}`,
        `<h2>New Message via Portfolio Contact Form</h2>
         <p><strong>Name:</strong> ${name || "N/A"}</p>
         <p><strong>Email:</strong> ${email || "N/A"}</p>
         <p><strong>Message:</strong></p>
         <div style="background: #f8f9fa; border-left: 4px solid #239a3b; padding: 12px; font-family: sans-serif; white-space: pre-wrap;">${message || ""}</div>
         <p style="font-size: 11px; color: #777; margin-top: 20px;">Sent from portfolio system automatically</p>`
      ).catch((err) => console.error("Async email contact delivery failed:", err));

      res
        .status(200)
        .json({ success: true, message: "Data successfully saved." });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to save contact data" });
    }
  });

  app.post("/api/subscribe", async (req, res) => {
    try {
      const { email } = req.body;
      const newEntry = {
        id: Date.now().toString(),
        name: "Newsletter Subscriber",
        email,
        message: `Stay in the loop subscriber: ${email}`,
        submittedAt: new Date().toISOString(),
      };

      contactDatabase.push(newEntry);
      console.log(`[Database] Newsletter Subscriber Enrolled: <${email}>`);

      // Trigger newsletter subscription email notification in background (Non-blocking)
      sendEmailNotification(
        `New Stay in the Loop Subscriber: ${email}`,
        `<h2>New Newsletter Subscription Alert</h2>
         <p>Someone requested to stay in the loop!</p>
         <p><strong>Subscriber Email:</strong> ${email || "N/A"}</p>
         <p style="font-size: 11px; color: #777; margin-top: 20px;">Sent from portfolio system automatically</p>`
      ).catch((err) => console.error("Async email subscription delivery failed:", err));

      res
        .status(200)
        .json({ success: true, message: "Subscription logged successfully." });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: "Failed to process subscription notification" });
    }
  });

  // Silent tracking analytics endpoint for professional photo profile clicks & viewing durations
  app.post("/api/track-photo-view", async (req, res) => {
    try {
      const { duration, viewCount, timezone, screenWidth, screenHeight, referrer, language } = req.body;
      const userAgent = req.get("User-Agent") || "Unknown Browser";
      const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "Unknown IP";

      console.log(`[Silent tracking] Photo viewed for ${duration}s. Session count: ${viewCount}. IP: ${ip}`);

      // Dispatch silent background notification with full telemetry breakdown
      sendEmailNotification(
        `👁️ Photo Alert: Rutvik's Professional Photo Viwed (${duration}s)`,
        `<div style="font-family: 'Helvetica Neue', Arial, sans-serif; max-width: 600px; color: #1e293b; line-height: 1.6; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
          <div style="background: linear-gradient(135deg, #1e1b4b 0%, #311042 100%); padding: 24px; text-align: center; color: #ffffff;">
            <p style="text-transform: uppercase; font-size: 11px; tracking: 0.1em; font-weight: bold; margin: 0 0 4px 0; color: #818cf8;">Silent Tracking Insights</p>
            <h1 style="font-size: 20px; font-weight: 800; margin: 0;">Professional Photo View Incident</h1>
          </div>
          
          <div style="padding: 24px; background: #ffffff;">
            <p style="margin-top: 0; font-size: 15px;">A user or hiring supervisor has requested and reviewed your professional face photo. Below is the behavioral tracking breakdown:</p>
            
            <div style="margin: 20px 0; padding: 16px; background: #f8fafc; border-left: 4px solid #6366f1; border-radius: 6px;">
              <span style="font-size: 12px; color: #64748b; text-transform: uppercase; font-weight: bold; display: block;">Exact View Duration</span>
              <strong style="font-size: 26px; color: #4f46e5; font-family: monospace;">${duration || "0.0"} <span style="font-size: 18px;">seconds</span></strong>
            </div>

            <table style="width: 100%; border-collapse: collapse; font-size: 13px; margin: 20px 0;">
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 10px 0; font-weight: bold; color: #475569;">Views In This Session</td>
                <td style="padding: 10px 0; text-align: right; font-family: monospace; font-weight: bold; color: #0f172a;">${viewCount || 1} times</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 10px 0; font-weight: bold; color: #475569;">Approx Client IP</td>
                <td style="padding: 10px 0; text-align: right; font-family: monospace; color: #2563eb;">${ip}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 10px 0; font-weight: bold; color: #475569;">Visitor Timezone</td>
                <td style="padding: 10px 0; text-align: right; color: #334155;">${timezone || "N/A"}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 10px 0; font-weight: bold; color: #475569;">Device Resolution</td>
                <td style="padding: 10px 0; text-align: right; color: #334155;">${screenWidth || "N/A"} x ${screenHeight || "N/A"}</td>
              </tr>
              <tr style="border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 10px 0; font-weight: bold; color: #475569;">Browser Language</td>
                <td style="padding: 10px 0; text-align: right; color: #334155;">${language || "N/A"}</td>
              </tr>
              <tr>
                <td style="padding: 10px 0; font-weight: bold; color: #475569;">Referrer Traffic Source</td>
                <td style="padding: 10px 0; text-align: right; font-size: 12px; color: #334155; word-break: break-all;">${referrer || "Direct URL / Bookmarked"}</td>
              </tr>
            </table>

            <div style="margin-top: 24px; border-top: 1px solid #e2e8f0; padding-top: 16px;">
              <span style="font-size: 11px; color: #94a3b8; font-weight: bold; text-transform: uppercase;">User Agent String</span>
              <p style="font-size: 11px; color: #64748b; font-family: monospace; margin: 4px 0 0 0; word-break: break-all; background: #fafafa; padding: 8px; border-radius: 4px; border: 1px solid #f1f5f9;">${userAgent}</p>
            </div>
          </div>
          <div style="background: #f8fafc; padding: 12px; text-align: center; font-size: 11px; color: #94a3b8; border-t: 1px solid #e2e8f0;">
            Secured Enterprise Tracking Engine • Rutvik Portfolio Automatic Notification
          </div>
        </div>`
      ).catch((err) => console.error("Async background photo notification failed:", err));

      res.status(200).json({ success: true });
    } catch (error) {
      console.error("Failed to silently log photo view activity:", error);
      res.status(200).json({ success: true }); // Graceful silent suppression
    }
  });

  // Dedicated endpoint to verify SMTP credentials and check host connectivity
  app.get("/api/test-smtp", async (req, res) => {
    try {
      const host = process.env.SMTP_HOST;
      const port = parseInt(process.env.SMTP_PORT || "587", 10);
      const user = process.env.SMTP_USER;
      const pass = process.env.SMTP_PASS;

      if (!host || !user || !pass) {
        return res.status(400).json({
          success: false,
          error: "SMTP credentials (SMTP_HOST, SMTP_USER, SMTP_PASS) are not defined in the settings under Secrets.",
        });
      }

      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
        tls: {
          rejectUnauthorized: false
        }
      });

      // Verify connection configuration
      await transporter.verify();

      res.status(200).json({
        success: true,
        message: `Successfully connected to SMTP server at ${host}:${port}! Credentials verified.`,
      });
    } catch (error: any) {
      console.error("[SMTP Check Error]:", error);
      res.status(500).json({
        success: false,
        error: error.message || "Failed to establish a connection to SMTP server.",
      });
    }
  });

  // Dedicated test endpoint to verify SMTP credentials and send a live email alert
  app.get("/api/test-email", async (req, res) => {
    const testSubject = "🔔 Portfolio Email Service Test";
    const targetEmail = process.env.NOTIFICATION_EMAIL || process.env.SMTP_USER || "rutvikdangar20@gmail.com";
    try {
      const host = process.env.SMTP_HOST;
      const port = parseInt(process.env.SMTP_PORT || "587", 10);
      const user = process.env.SMTP_USER;
      const pass = process.env.SMTP_PASS;

      if (!host || !user || !pass) {
        const errStr = "To send live emails, please define SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASS in the AI Studio Secrets menu first.";
        addEmailLog(testSubject, targetEmail, "sandbox", errStr);
        return res.status(400).json({
          success: false,
          error: errStr,
          envConfigured: {
            host: !!host,
            user: !!user,
            pass: !!pass,
          }
        });
      }

      const transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
        tls: {
          rejectUnauthorized: false
        }
      });

      // Verify connection configuration
      try {
        await transporter.verify();
      } catch (verifyError: any) {
        const verifyErrMsg = `SMTP connection verification failed: ${verifyError.message || verifyError}`;
        addEmailLog(testSubject, targetEmail, "failed", undefined, verifyErrMsg);
        return res.status(500).json({
          success: false,
          error: verifyErrMsg,
          details: "Please make sure your SMTP credentials are accurate and App Passwords are created for Gmail.",
        });
      }

      const info = await transporter.sendMail({
        from: `"Rutvik's Portfolio Tester" <${user}>`,
        to: targetEmail,
        subject: testSubject,
        html: `<h2>Congratulations, Rutvik! 🎉</h2>
               <p>Your portfolio's automated email notifier is successfully configured and online.</p>
               <p>Whenever a visitor submits a contact form or requests to stay in the loop, you will receive an instant notification here.</p>
               <br />
               <hr />
               <p style="font-family: monospace; font-size: 11px; color: #555;">
                 SMTP Host: ${host}<br />
                 SMTP Port: ${port}<br />
                 Sender: ${user}<br />
                 Time: ${new Date().toLocaleString()}
               </p>`
      });

      addEmailLog(testSubject, targetEmail, "success", `Test Email Transmitted. Response: ${info.response || "Sent."}`);

      res.status(200).json({
        success: true,
        message: `Test email successfully sent to rutvikdangar20@gmail.com! SMTP Response: ${info.response || 'Success'}`,
        messageId: info.messageId,
      });
    } catch (error: any) {
      console.error("[Test Email Error]:", error);
      const catchErrMsg = error.message || "Failed to send test email due to an internal error.";
      addEmailLog(testSubject, targetEmail, "failed", undefined, catchErrMsg);
      res.status(500).json({
        success: false,
        error: catchErrMsg,
      });
    }
  });

  // Fetch recent SMTP dispatch logs for frontend troubleshooting
  app.get("/api/email-logs", (req, res) => {
    res.json(emailLogs);
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const { message, history = [], adminInstructions = "", image } = req.body;

      if (!process.env.GEMINI_API_KEY) {
        return res.status(400).json({ 
          error: "API key is not configured yet. Please configure the **GEMINI_API_KEY** in the **Settings > Secrets** panel of AI Studio to enable the Floating AI assistant." 
        });
      }

      if (!message) {
        return res.status(400).json({ error: "Message is required" });
      }

      let currentSystemInstruction = SYSTEM_INSTRUCTION;
      if (adminInstructions) {
        currentSystemInstruction += `\n\nADMIN OVERRIDE/ADDITIONAL KNOWLEDGE:\n${adminInstructions}`;
      }

      // Restore history manually
      let validHistory = [...history];
      if (validHistory.length > 0 && validHistory[0].role === "ai") {
        validHistory.shift();
      }

      const contents = validHistory.map((msg: any) => ({
        role: msg.role === "ai" ? "model" : "user",
        parts: [{ text: msg.text }],
      }));

      const userParts: any[] = [{ text: message }];

      if (image && typeof image === "string" && image.startsWith("data:")) {
        const [meta, base64Data] = image.split(",");
        const mimeTypeMatch = meta.match(/data:([a-zA-Z0-9]+\/[a-zA-Z0-9-.+]+).*;/);
        
        if (mimeTypeMatch && mimeTypeMatch[1]) {
           const mimeType = mimeTypeMatch[1];
           // In Gemini API, only certain mimetypes are supported, but we pass it and if it fails, it fails gracefully.
           userParts.push({
             inlineData: {
               data: base64Data,
               mimeType: mimeType,
              },
           });
        }
      }

      contents.push({ role: "user", parts: userParts });

      // Set headers for chunked streaming
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Transfer-Encoding", "chunked");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      let responseStream;
      try {
        responseStream = await generateContentStreamWithRetry({
          model: "gemini-3.5-flash",
          contents: contents,
          config: {
            systemInstruction: currentSystemInstruction,
          },
        });
      } catch (err: any) {
        // If inlineData mimetype is unsupported, retry without the file
        if (err.message && err.message.toLowerCase().includes("supported")) {
            console.log("Retrying stream without file due to mimetype error:", err.message);
            const fallbackParts = [{ text: message || "User uploaded an unsupported file." }];
            contents[contents.length - 1].parts = fallbackParts;
            responseStream = await generateContentStreamWithRetry({
              model: "gemini-3.5-flash",
              contents: contents,
              config: {
                systemInstruction: currentSystemInstruction,
              },
            });
        } else {
            throw err;
        }
      }

      for await (const chunk of responseStream) {
        if (chunk.text) {
          res.write(chunk.text);
        }
      }
      res.end();
    } catch (error: any) {
      console.error("[Gemini API Error]:", JSON.stringify(error));
      
      const errMessage = typeof error === 'string' ? error : JSON.stringify(error);
      let errMsg = "Failed to fetch response.";
      if (errMessage.includes("429") || errMessage.includes("quota") || errMessage.includes("RESOURCE_EXHAUSTED")) {
        errMsg = "I'm currently experiencing a high volume of requests and have reached my limit. Please try again later!";
      } else if (error?.message) {
        errMsg = error.message;
      }

      if (!res.headersSent) {
        res.status(500).json({ error: errMsg });
      } else {
        res.write(`\n\n[ERROR]: ${errMsg}`);
        res.end();
      }
    }
  });

// Vite middleware for development
async function setupViteOrStatic() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // Support wildcard routing for React Router (if used)
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }
}

if (!process.env.VERCEL && process.env.NODE_ENV !== "test") {
  setupViteOrStatic().then(() => {
    const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  });
}

export default app;
